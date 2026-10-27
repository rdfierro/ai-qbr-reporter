import { Duration, Stack, StackProps, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as stepfunctions from 'aws-cdk-lib/aws-stepfunctions';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { PipelineStateMachine } from './pipeline-state-machine';

export interface AnalyticsBindings {
  readonly useRedshift: boolean;
  readonly athenaWorkgroupParameter?: ssm.IStringParameter;
  readonly athenaOutputParameter?: ssm.IStringParameter;
  readonly redshiftWorkgroupParameter?: ssm.IStringParameter;
  readonly redshiftNamespaceParameter?: ssm.IStringParameter;
  readonly redshiftSecret?: secretsmanager.ISecret;
}

export interface BedrockBindings {
  readonly modelIdParameter: ssm.IStringParameter;
  readonly knowledgeBaseIdParameter: ssm.IStringParameter;
  readonly guardrailIdParameter: ssm.IStringParameter;
  readonly kbDocsPrefix: string;
}

export interface AppStackProps extends StackProps {
  readonly rawBucket: s3.IBucket;
  readonly curatedBucket: s3.IBucket;
  readonly artifactsBucket: s3.IBucket;
  readonly kmsKey: kms.IKey;
  readonly analytics: AnalyticsBindings;
  readonly bedrock: BedrockBindings;
  readonly senderEmail: string;
  readonly emailDlq: sqs.IQueue;
  readonly allowedSenderEmails: string[];
  readonly monthlyScheduleExpression: string;
  readonly quarterlyScheduleExpression: string;
  readonly slackWebhookSecretArn?: string;
}

export class AppStack extends Stack {
  public readonly stateMachine: stepfunctions.StateMachine;
  public readonly apiUrl: string;

  constructor(scope: Construct, id: string, props: AppStackProps) {
    super(scope, id, props);

    const pythonLayer = new lambda.LayerVersion(this, 'PythonDependencies', {
      compatibleRuntimes: [lambda.Runtime.PYTHON_3_11],
      description: 'Shared Python libraries for ai-qbr-reporter',
      code: lambda.Code.fromAsset('layers/python311', {
        bundling: {
          image: lambda.Runtime.PYTHON_3_11.bundlingImage,
          command: [
            'bash',
            '-c',
            'python -m pip install -r requirements.txt -t /asset-output/python && cp requirements.txt /asset-output/python/requirements.txt',
          ],
        },
      }),
    });

    const baseLambdaEnv = {
      ARTIFACTS_BUCKET: props.artifactsBucket.bucketName,
      CURATED_BUCKET: props.curatedBucket.bucketName,
      RAW_BUCKET: props.rawBucket.bucketName,
      KMS_KEY_ARN: props.kmsKey.keyArn,
      LOG_LEVEL: 'INFO',
      MASK_PII: 'true',
    };

    const kpiQueryFunction = this.createLambda('KpiQueryFn', 'app/lambdas/kpi_query', {
      ...baseLambdaEnv,
      USE_REDSHIFT: String(!!props.analytics.useRedshift),
      ATHENA_WORKGROUP_PARAM: props.analytics.athenaWorkgroupParameter?.parameterName ?? '',
      ATHENA_OUTPUT_PARAM: props.analytics.athenaOutputParameter?.parameterName ?? '',
      REDSHIFT_WORKGROUP_PARAM: props.analytics.redshiftWorkgroupParameter?.parameterName ?? '',
      REDSHIFT_NAMESPACE_PARAM: props.analytics.redshiftNamespaceParameter?.parameterName ?? '',
      REDSHIFT_SECRET_ARN: props.analytics.redshiftSecret?.secretArn ?? '',
    }, pythonLayer);

    const chartRenderFunction = this.createLambda('ChartRenderFn', 'app/lambdas/chart_render', baseLambdaEnv, pythonLayer);

    const narrativeFunction = this.createLambda('NarrativeFn', 'app/lambdas/narrative', {
      ...baseLambdaEnv,
      BEDROCK_MODEL_PARAM: props.bedrock.modelIdParameter.parameterName,
      BEDROCK_KB_PARAM: props.bedrock.knowledgeBaseIdParameter.parameterName,
      BEDROCK_GUARDRAIL_PARAM: props.bedrock.guardrailIdParameter.parameterName,
    }, pythonLayer);

    const pptxBuilderFunction = this.createLambda('PptxBuilderFn', 'app/lambdas/pptx_builder', baseLambdaEnv, pythonLayer);

    const deliverFunction = this.createLambda('DeliverFn', 'app/lambdas/deliver', {
      ...baseLambdaEnv,
      SENDER_EMAIL: props.senderEmail,
      ALLOWED_SENDERS: props.allowedSenderEmails.join(','),
      SLACK_WEBHOOK_SECRET_ARN: props.slackWebhookSecretArn ?? '',
      EMAIL_DLQ_URL: props.emailDlq.queueUrl,
    }, pythonLayer);

    props.artifactsBucket.grantReadWrite(kpiQueryFunction);
    props.artifactsBucket.grantReadWrite(chartRenderFunction);
    props.artifactsBucket.grantReadWrite(pptxBuilderFunction);
    props.artifactsBucket.grantRead(deliverFunction);
    props.artifactsBucket.grantRead(narrativeFunction);

    props.curatedBucket.grantRead(kpiQueryFunction);
    props.curatedBucket.grantRead(narrativeFunction);

    props.kmsKey.grantEncryptDecrypt(kpiQueryFunction);
    props.kmsKey.grantEncryptDecrypt(chartRenderFunction);
    props.kmsKey.grantEncryptDecrypt(pptxBuilderFunction);
    props.kmsKey.grantEncryptDecrypt(deliverFunction);

    props.analytics.athenaWorkgroupParameter?.grantRead(kpiQueryFunction);
    props.analytics.athenaOutputParameter?.grantRead(kpiQueryFunction);
    props.analytics.redshiftWorkgroupParameter?.grantRead(kpiQueryFunction);
    props.analytics.redshiftNamespaceParameter?.grantRead(kpiQueryFunction);
    props.analytics.redshiftSecret?.grantRead(kpiQueryFunction);

    props.bedrock.modelIdParameter.grantRead(narrativeFunction);
    props.bedrock.knowledgeBaseIdParameter.grantRead(narrativeFunction);
    props.bedrock.guardrailIdParameter.grantRead(narrativeFunction);

    const athenaWorkgroupName = props.analytics.athenaWorkgroupParameter?.stringValue;
    if (athenaWorkgroupName) {
      kpiQueryFunction.addToRolePolicy(
        new iam.PolicyStatement({
          actions: ['athena:StartQueryExecution', 'athena:GetQueryExecution', 'athena:GetQueryResults'],
          resources: [
            `arn:aws:athena:${this.region}:${this.account}:workgroup/${athenaWorkgroupName}`,
          ],
        }),
      );
      kpiQueryFunction.addToRolePolicy(
        new iam.PolicyStatement({
          actions: ['glue:GetDatabase', 'glue:GetTable', 'glue:GetTables'],
          resources: ['*'],
        }),
      );
    }

    if (props.analytics.useRedshift && props.analytics.redshiftWorkgroupParameter) {
      kpiQueryFunction.addToRolePolicy(
        new iam.PolicyStatement({
          actions: [
            'redshift-data:ExecuteStatement',
            'redshift-data:GetStatementResult',
            'redshift-data:DescribeStatement',
          ],
          resources: ['*'],
        }),
      );
    }

    const bedrockPolicy = new iam.PolicyStatement({
      actions: [
        'bedrock:InvokeModel',
        'bedrock:InvokeModelWithResponseStream',
        'bedrock:Retrieve',
        'bedrock:RetrieveAndGenerate',
      ],
      resources: ['*'],
    });
    narrativeFunction.addToRolePolicy(bedrockPolicy);

    const sesIdentityArn = `arn:aws:ses:${this.region}:${this.account}:identity/${props.senderEmail}`;
    const sesPolicy = new iam.PolicyStatement({
      actions: ['ses:SendEmail', 'ses:SendRawEmail'],
      resources: [sesIdentityArn],
      conditions: {
        StringLikeIfExists: {
          'ses:FromAddress': props.allowedSenderEmails,
        },
      },
    });
    deliverFunction.addToRolePolicy(sesPolicy);
    props.emailDlq.grantSendMessages(deliverFunction);

    if (props.slackWebhookSecretArn) {
      deliverFunction.addToRolePolicy(
        new iam.PolicyStatement({
          actions: ['secretsmanager:GetSecretValue'],
          resources: [props.slackWebhookSecretArn],
        }),
      );
    }

    const logGroup = new logs.LogGroup(this, 'PipelineLogs', {
      retention: logs.RetentionDays.ONE_MONTH,
    });

    const pipeline = new PipelineStateMachine(this, 'QbrPipeline', {
      stateMachineName: 'ai-qbr-reporter',
      kpiQueryLambda: kpiQueryFunction,
      chartRenderLambda: chartRenderFunction,
      narrativeLambda: narrativeFunction,
      pptxBuilderLambda: pptxBuilderFunction,
      deliverLambda: deliverFunction,
      logGroup,
    });

    this.stateMachine = pipeline.stateMachine;

    const monthlyRule = new events.Rule(this, 'MonthlySchedule', {
      schedule: events.Schedule.expression(props.monthlyScheduleExpression),
    });
    monthlyRule.addTarget(new targets.SfnStateMachine(this.stateMachine));

    const quarterlyRule = new events.Rule(this, 'QuarterlySchedule', {
      schedule: events.Schedule.expression(props.quarterlyScheduleExpression),
    });
    quarterlyRule.addTarget(new targets.SfnStateMachine(this.stateMachine));

    const apiRole = new iam.Role(this, 'ApiInvokeRole', {
      assumedBy: new iam.ServicePrincipal('apigateway.amazonaws.com'),
    });
    apiRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['states:StartExecution'],
        resources: [this.stateMachine.stateMachineArn],
      }),
    );

    const api = new apigateway.RestApi(this, 'PipelineApi', {
      restApiName: 'ai-qbr-reporter-api',
      deployOptions: {
        tracingEnabled: true,
        stageName: 'prod',
        metricsEnabled: true,
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        dataTraceEnabled: false,
      },
    });

    const runResource = api.root.addResource('run');
    const startExecutionIntegration = new apigateway.AwsIntegration({
      service: 'states',
      action: 'StartExecution',
      integrationHttpMethod: 'POST',
      options: {
        credentialsRole: apiRole,
        requestTemplates: {
          'application/json': `{"input": "$util.escapeJavaScript($input.body)", "stateMachineArn": "${this.stateMachine.stateMachineArn}"}`,
        },
        integrationResponses: [
          {
            statusCode: '202',
            responseTemplates: {
              'application/json': '{"status":"accepted"}',
            },
          },
        ],
      },
    });

    runResource.addMethod('POST', startExecutionIntegration, {
      methodResponses: [{ statusCode: '202' }],
    });

    this.apiUrl = api.url;

    new CfnOutput(this, 'PipelineApiUrl', {
      value: api.url ?? 'unknown',
    });
  }

  private createLambda(
    id: string,
    assetPath: string,
    environment: { [key: string]: string },
    layer: lambda.ILayerVersion,
  ): lambda.Function {
    return new lambda.Function(this, id, {
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: 'handler.lambda_handler',
      code: lambda.Code.fromAsset(assetPath),
      timeout: Duration.minutes(3),
      memorySize: 1024,
      tracing: lambda.Tracing.ACTIVE,
      logRetention: logs.RetentionDays.ONE_MONTH,
      environment,
      layers: [layer],
    });
  }
}
