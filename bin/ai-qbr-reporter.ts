#!/usr/bin/env node
import 'source-map-support/register';
import * as fs from 'fs';
import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { DataLakeStack } from '../lib/data-lake-stack';
import { AnalyticsStack } from '../lib/analytics-stack';
import { BedrockStack } from '../lib/bedrock-stack';
import { EmailStack } from '../lib/email-stack';
import { AppStack } from '../lib/app-stack';

interface ParametersFile {
  region?: string;
  useRedshift?: boolean;
  bedrockModelId: string;
  artifactsBucketPrefix?: string;
  allowedSenderEmails: string[];
  monthlySchedule?: string;
  quarterlySchedule?: string;
  slackWebhookSecretArn?: string;
}

function loadParameters(): ParametersFile {
  const root = path.join(__dirname, '..');
  const paramPath = path.join(root, 'infra', 'parameters.json');
  const fallbackPath = path.join(root, 'infra', 'parameters.example.json');

  const filePath = fs.existsSync(paramPath) ? paramPath : fallbackPath;
  const data = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(data);
}

const parameters = loadParameters();
const app = new cdk.App();

const region = parameters.region ?? process.env.CDK_DEFAULT_REGION ?? 'us-west-2';
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region,
};

const dataLake = new DataLakeStack(app, 'AiQbrDataLakeStack', { env });

const analytics = new AnalyticsStack(app, 'AiQbrAnalyticsStack', {
  env,
  artifactsBucket: dataLake.artifactsBucket,
  kmsKey: dataLake.kmsKey,
  useRedshift: parameters.useRedshift ?? false,
});

const bedrock = new BedrockStack(app, 'AiQbrBedrockStack', {
  env,
  curatedBucket: dataLake.curatedBucket,
  kmsKey: dataLake.kmsKey,
  bedrockModelId: parameters.bedrockModelId,
});

const senderEmail = parameters.allowedSenderEmails?.[0] ?? 'exec@example.com';

const email = new EmailStack(app, 'AiQbrEmailStack', {
  env,
  senderEmail,
});

new AppStack(app, 'AiQbrAppStack', {
  env,
  rawBucket: dataLake.rawBucket,
  curatedBucket: dataLake.curatedBucket,
  artifactsBucket: dataLake.artifactsBucket,
  kmsKey: dataLake.kmsKey,
  analytics: {
    useRedshift: analytics.configuration.useRedshift,
    athenaWorkgroupParameter: analytics.configuration.athenaWorkgroupParameter,
    athenaOutputParameter: analytics.configuration.athenaOutputParameter,
    redshiftWorkgroupParameter: analytics.configuration.redshiftWorkgroupParameter,
    redshiftNamespaceParameter: analytics.configuration.redshiftNamespaceParameter,
    redshiftSecret: analytics.configuration.redshiftSecret,
  },
  bedrock: {
    modelIdParameter: bedrock.modelIdParameter,
    knowledgeBaseIdParameter: bedrock.knowledgeBaseIdParameter,
    guardrailIdParameter: bedrock.guardrailIdParameter,
    kbDocsPrefix: bedrock.kbDocsPrefix,
  },
  senderEmail,
  emailDlq: email.deliveryDlq,
  allowedSenderEmails: parameters.allowedSenderEmails ?? [senderEmail],
  monthlyScheduleExpression: parameters.monthlySchedule ?? 'cron(0 15 1 * ? *)',
  quarterlyScheduleExpression: parameters.quarterlySchedule ?? 'cron(0 15 1 1,4,7,10 ? *)',
  slackWebhookSecretArn: parameters.slackWebhookSecretArn,
});
