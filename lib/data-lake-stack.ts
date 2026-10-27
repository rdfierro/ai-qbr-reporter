import { Duration, RemovalPolicy, Stack, StackProps, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as glue from 'aws-cdk-lib/aws-glue';
import * as iam from 'aws-cdk-lib/aws-iam';

export class DataLakeStack extends Stack {
  public readonly rawBucket: s3.Bucket;
  public readonly curatedBucket: s3.Bucket;
  public readonly artifactsBucket: s3.Bucket;
  public readonly kmsKey: kms.Key;
  public readonly glueDatabase: glue.Database;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    this.kmsKey = new kms.Key(this, 'DataLakeKey', {
      enableKeyRotation: true,
      alias: 'alias/ai-qbr-reporter/datalake',
      description: 'KMS CMK for ai-qbr-reporter data lake buckets',
      removalPolicy: RemovalPolicy.RETAIN,
    });

    this.rawBucket = this.createBucket('RawBucket');
    this.curatedBucket = this.createBucket('CuratedBucket');
    this.artifactsBucket = this.createBucket('ArtifactsBucket');

    this.glueDatabase = new glue.Database(this, 'CuratedDatabase', {
      databaseName: 'ai_qbr_curated',
    });

    const glueRole = new iam.Role(this, 'GlueCrawlerRole', {
      assumedBy: new iam.ServicePrincipal('glue.amazonaws.com'),
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSGlueServiceRole')],
    });

    this.curatedBucket.grantRead(glueRole);
    this.kmsKey.grantEncryptDecrypt(glueRole);

    new glue.CfnCrawler(this, 'CuratedCrawler', {
      name: 'ai-qbr-curated-crawler',
      role: glueRole.roleArn,
      databaseName: this.glueDatabase.databaseName,
      targets: {
        s3Targets: [
          {
            path: `s3://${this.curatedBucket.bucketName}/`,
          },
        ],
      },
    });

    new CfnOutput(this, 'RawBucketName', { value: this.rawBucket.bucketName });
    new CfnOutput(this, 'CuratedBucketName', { value: this.curatedBucket.bucketName });
    new CfnOutput(this, 'ArtifactsBucketName', { value: this.artifactsBucket.bucketName });
    new CfnOutput(this, 'DataLakeKmsKeyArn', { value: this.kmsKey.keyArn });
  }

  private createBucket(id: string): s3.Bucket {
    return new s3.Bucket(this, id, {
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: this.kmsKey,
      enforceSSL: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      versioned: true,
      removalPolicy: RemovalPolicy.RETAIN,
      lifecycleRules: [
        {
          enabled: true,
          transitions: [
            {
              storageClass: s3.StorageClass.INTELLIGENT_TIERING,
              transitionAfter: Duration.days(30),
            },
          ],
          noncurrentVersionTransitions: [
            {
              storageClass: s3.StorageClass.GLACIER_INSTANT_RETRIEVAL,
              transitionAfter: Duration.days(60),
            },
          ],
        },
      ],
    });
  }
}
