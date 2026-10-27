import { Duration } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as logs from 'aws-cdk-lib/aws-logs';

export interface PipelineStateMachineProps {
  readonly stateMachineName?: string;
  readonly kpiQueryLambda: lambda.IFunction;
  readonly chartRenderLambda: lambda.IFunction;
  readonly narrativeLambda: lambda.IFunction;
  readonly pptxBuilderLambda: lambda.IFunction;
  readonly deliverLambda: lambda.IFunction;
  readonly logGroup?: logs.ILogGroup;
}

export class PipelineStateMachine extends Construct {
  public readonly stateMachine: sfn.StateMachine;
  public readonly failureTopic: sns.Topic;

  constructor(scope: Construct, id: string, props: PipelineStateMachineProps) {
    super(scope, id);

    this.failureTopic = new sns.Topic(this, 'PipelineFailureTopic', {
      displayName: 'AI QBR Reporter Pipeline Failures',
    });

    const errorNotifier = new tasks.SnsPublish(this, 'NotifyFailure', {
      topic: this.failureTopic,
      message: sfn.TaskInput.fromJsonPathAt('$'),
      subject: 'AI QBR Reporter pipeline failure',
    });

    const failState = new sfn.Fail(this, 'PipelineFailed');
    const errorChain = errorNotifier.next(failState);

    const kpiQuery = new tasks.LambdaInvoke(this, 'KPI_QUERY', {
      lambdaFunction: props.kpiQueryLambda,
      payloadResponseOnly: true,
    });

    const chartRender = new tasks.LambdaInvoke(this, 'CHART_RENDER', {
      lambdaFunction: props.chartRenderLambda,
      payloadResponseOnly: true,
      inputPath: '$',
    });

    const narrative = new tasks.LambdaInvoke(this, 'NARRATIVE', {
      lambdaFunction: props.narrativeLambda,
      payloadResponseOnly: true,
    });

    const pptxBuilder = new tasks.LambdaInvoke(this, 'PPTX_BUILDER', {
      lambdaFunction: props.pptxBuilderLambda,
      payloadResponseOnly: true,
    });

    const deliver = new tasks.LambdaInvoke(this, 'DELIVER', {
      lambdaFunction: props.deliverLambda,
      payloadResponseOnly: true,
    });

    const states = [kpiQuery, chartRender, narrative, pptxBuilder, deliver];

    states.forEach((state) => {
      state.addRetry({
        maxAttempts: 2,
        interval: Duration.seconds(10),
        backoffRate: 2,
      });
      state.addCatch(errorChain, {
        resultPath: '$.error',
      });
    });

    const definition = kpiQuery
      .next(chartRender)
      .next(narrative)
      .next(pptxBuilder)
      .next(deliver);

    this.stateMachine = new sfn.StateMachine(this, 'ReporterStateMachine', {
      stateMachineName: props.stateMachineName,
      definition,
      timeout: Duration.minutes(15),
      logs: props.logGroup
        ? {
            destination: props.logGroup,
            level: sfn.LogLevel.ALL,
            includeExecutionData: true,
          }
        : undefined,
    });
  }
}
