import { Stack, StackProps, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as athena from 'aws-cdk-lib/aws-athena';
import * as redshift from 'aws-cdk-lib/aws-redshiftserverless';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as ec2 from 'aws-cdk-lib/aws-ec2';

export interface AnalyticsStackProps extends StackProps {
  readonly useRedshift?: boolean;
  readonly artifactsBucket: s3.IBucket;
  readonly kmsKey: kms.IKey;
}

export interface AnalyticsConfiguration {
  readonly useRedshift: boolean;
  readonly athenaWorkgroupParameter?: ssm.StringParameter;
  readonly athenaOutputParameter?: ssm.StringParameter;
  readonly redshiftWorkgroupParameter?: ssm.StringParameter;
  readonly redshiftNamespaceParameter?: ssm.StringParameter;
  readonly redshiftSecret?: secretsmanager.Secret;
}

export class AnalyticsStack extends Stack {
  public readonly configuration: AnalyticsConfiguration;

  constructor(scope: Construct, id: string, props: AnalyticsStackProps) {
    super(scope, id, props);

    const resultPrefix = `s3://${props.artifactsBucket.bucketName}/athena/`;

    props.artifactsBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'AllowAthenaAccess',
        principals: [new iam.ServicePrincipal('athena.amazonaws.com')],
        actions: ['s3:GetObject', 's3:PutObject'],
        resources: [props.artifactsBucket.arnForObjects('athena/*')],
        conditions: {
          StringEquals: {
            'aws:SourceAccount': this.account,
          },
        },
      }),
    );

    props.artifactsBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'AllowAthenaList',
        principals: [new iam.ServicePrincipal('athena.amazonaws.com')],
        actions: ['s3:ListBucket'],
        resources: [props.artifactsBucket.bucketArn],
        conditions: {
          StringLike: {
            's3:prefix': ['athena/*'],
          },
        },
      }),
    );

    if (props.useRedshift) {
      this.configuration = this.createRedshiftResources(props, resultPrefix);
    } else {
      this.configuration = this.createAthenaResources(props, resultPrefix);
    }
  }

  private createAthenaResources(
    props: AnalyticsStackProps,
    resultPrefix: string,
  ): AnalyticsConfiguration {
    const workgroupName = 'ai_qbr_reporting_wg';

    const workgroup = new athena.CfnWorkGroup(this, 'ReportingWorkgroup', {
      name: workgroupName,
      workGroupConfiguration: {
        enforceWorkGroupConfiguration: true,
        publishCloudWatchMetricsEnabled: true,
        resultConfiguration: {
          outputLocation: resultPrefix,
          encryptionConfiguration: {
            encryptionOption: 'SSE_KMS',
            kmsKey: props.kmsKey.keyArn,
          },
        },
      },
      recursiveDeleteOption: true,
      state: 'ENABLED',
    });

    const workgroupParam = new ssm.StringParameter(this, 'AthenaWorkgroupParam', {
      parameterName: '/ai-qbr/analytics/athena/workgroup',
      stringValue: workgroup.name ?? workgroupName,
    });

    const outputParam = new ssm.StringParameter(this, 'AthenaOutputParam', {
      parameterName: '/ai-qbr/analytics/athena/output',
      stringValue: resultPrefix,
    });

    new CfnOutput(this, 'AthenaWorkgroupName', {
      value: workgroup.name ?? workgroupName,
    });

    return {
      useRedshift: false,
      athenaWorkgroupParameter: workgroupParam,
      athenaOutputParameter: outputParam,
    };
  }

  private createRedshiftResources(
    props: AnalyticsStackProps,
    resultPrefix: string,
  ): AnalyticsConfiguration {
    const adminSecret = new secretsmanager.Secret(this, 'RedshiftAdminSecret', {
      description: 'Admin credentials for ai-qbr Redshift Serverless',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'rs_admin' }),
        generateStringKey: 'password',
        excludePunctuation: true,
      },
    });

    const namespace = new redshift.CfnNamespace(this, 'ReportingNamespace', {
      namespaceName: 'ai-qbr-ns',
      adminUsername: adminSecret.secretValueFromJson('username').toString(),
      adminUserPassword: adminSecret.secretValueFromJson('password').toString(),
      kmsKeyId: props.kmsKey.keyArn,
      logExports: ['userlog'],
    });

    const vpc = ec2.Vpc.fromLookup(this, 'RedshiftVpc', { isDefault: true });
    const subnets = vpc.privateSubnets.length > 0 ? vpc.privateSubnets : vpc.publicSubnets;

    const securityGroup = new ec2.SecurityGroup(this, 'RedshiftSecurityGroup', {
      vpc,
      allowAllOutbound: true,
      description: 'Security group for Redshift Serverless workgroup',
    });

    const workgroup = new redshift.CfnWorkgroup(this, 'ReportingWorkgroup', {
      workgroupName: 'ai-qbr-wg',
      baseCapacity: 8,
      namespaceName: namespace.namespaceName ?? 'ai-qbr-ns',
      enhancedVpcRouting: false,
      subnetIds: subnets.map((subnet) => subnet.subnetId),
      securityGroupIds: [securityGroup.securityGroupId],
    });

    const workgroupParam = new ssm.StringParameter(this, 'RedshiftWorkgroupParam', {
      parameterName: '/ai-qbr/analytics/redshift/workgroup',
      stringValue: workgroup.workgroupName ?? 'ai-qbr-wg',
    });

    const namespaceParam = new ssm.StringParameter(this, 'RedshiftNamespaceParam', {
      parameterName: '/ai-qbr/analytics/redshift/namespace',
      stringValue: namespace.namespaceName ?? 'ai-qbr-ns',
    });

    new ssm.StringParameter(this, 'RedshiftOutputPlaceholder', {
      parameterName: '/ai-qbr/analytics/redshift/export-prefix',
      stringValue: resultPrefix,
    });

    new CfnOutput(this, 'RedshiftWorkgroupName', {
      value: workgroup.workgroupName ?? 'ai-qbr-wg',
    });

    return {
      useRedshift: true,
      redshiftWorkgroupParameter: workgroupParam,
      redshiftNamespaceParameter: namespaceParam,
      redshiftSecret: adminSecret,
    };
  }
}
