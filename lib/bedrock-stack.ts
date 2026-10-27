import { Stack, StackProps, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as bedrock from 'aws-cdk-lib/aws-bedrock';
import * as ssm from 'aws-cdk-lib/aws-ssm';

export interface BedrockStackProps extends StackProps {
  readonly curatedBucket: s3.IBucket;
  readonly kmsKey: kms.IKey;
  readonly bedrockModelId: string;
  readonly kbDocsPrefix?: string;
}

export class BedrockStack extends Stack {
  public readonly knowledgeBase: bedrock.CfnKnowledgeBase;
  public readonly guardrail: bedrock.CfnGuardrail;
  public readonly modelIdParameter: ssm.StringParameter;
  public readonly knowledgeBaseIdParameter: ssm.StringParameter;
  public readonly guardrailIdParameter: ssm.StringParameter;
  public readonly kbDocsPrefix: string;

  constructor(scope: Construct, id: string, props: BedrockStackProps) {
    super(scope, id, props);

    this.kbDocsPrefix = props.kbDocsPrefix ?? 'bedrock/kb-docs/';

    const kbRole = new iam.Role(this, 'KnowledgeBaseRole', {
      roleName: undefined,
      assumedBy: new iam.ServicePrincipal('bedrock.amazonaws.com'),
      inlinePolicies: {
        KBAccessPolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              sid: 'AllowReadCuratedDocs',
              actions: ['s3:GetObject', 's3:ListBucket'],
              resources: [
                props.curatedBucket.bucketArn,
                props.curatedBucket.arnForObjects(`${this.kbDocsPrefix}*`),
              ],
            }),
            new iam.PolicyStatement({
              sid: 'AllowKmsDecrypt',
              actions: ['kms:Decrypt', 'kms:DescribeKey'],
              resources: [props.kmsKey.keyArn],
            }),
          ],
        }),
      },
    });

    const guardrail = new bedrock.CfnGuardrail(this, 'NarrativeGuardrail', {
      name: 'ai-qbr-guardrail',
      description: 'Protect QBR narratives from disallowed or PII content',
      blockedInputMessaging: 'Please provide only KPI-aligned inputs.',
      blockedOutputsMessaging: 'Content removed to comply with policy.',
      sensitiveInformationPolicyConfig: {
        piiEntitiesConfig: [
          { type: 'EMAIL', action: 'REDACT' },
          { type: 'PHONE', action: 'REDACT' },
        ],
      } as any,
      topicPolicyConfig: {
        topicsConfig: [
          {
            type: 'DENY',
            name: 'UnsupportedClaims',
            definition: 'Avoid speculative revenue or pipeline claims not provided in KPIs.',
          },
        ],
      } as any,
      wordPolicyConfig: {
        wordsConfig: [
          {
            text: 'guaranteed win',
            action: 'BLOCK',
          },
        ],
      } as any,
    });

    const knowledgeBase = new bedrock.CfnKnowledgeBase(this, 'NarrativeKnowledgeBase', {
      name: 'ai-qbr-knowledge-base',
      roleArn: kbRole.roleArn,
      knowledgeBaseConfiguration: {
        type: 'VECTOR',
        vectorKnowledgeBaseConfiguration: {
          embeddingModelArn: 'arn:aws:bedrock:us-west-2::foundation-model/amazon.titan-embed-text-v2:0',
        },
      } as any,
      storageConfiguration: {
        type: 'BEDROCK_MANAGED',
        bedrockManagedConfiguration: {
          kmsKeyArn: props.kmsKey.keyArn,
        },
      } as any,
      description: 'Bedrock-managed KB indexing curated QBR collateral',
    });

    new bedrock.CfnDataSource(this, 'NarrativeDataSource', {
      knowledgeBaseId: knowledgeBase.attrKnowledgeBaseId,
      name: 'curated-docs-source',
      dataSourceConfiguration: {
        type: 'S3',
        s3Configuration: {
          bucketArn: props.curatedBucket.bucketArn,
          inclusionPrefixes: [this.kbDocsPrefix],
        },
      } as any,
    });

    this.modelIdParameter = new ssm.StringParameter(this, 'BedrockModelParam', {
      parameterName: '/ai-qbr/bedrock/model-id',
      stringValue: props.bedrockModelId,
    });

    this.knowledgeBaseIdParameter = new ssm.StringParameter(this, 'KnowledgeBaseParam', {
      parameterName: '/ai-qbr/bedrock/knowledge-base-id',
      stringValue: knowledgeBase.attrKnowledgeBaseId,
    });

    this.guardrailIdParameter = new ssm.StringParameter(this, 'GuardrailParam', {
      parameterName: '/ai-qbr/bedrock/guardrail-id',
      stringValue: guardrail.attrGuardrailId,
    });

    this.knowledgeBase = knowledgeBase;
    this.guardrail = guardrail;

    new CfnOutput(this, 'BedrockKnowledgeBaseId', {
      value: knowledgeBase.attrKnowledgeBaseId,
    });

    new CfnOutput(this, 'BedrockGuardrailId', {
      value: guardrail.attrGuardrailId,
    });
  }
}
