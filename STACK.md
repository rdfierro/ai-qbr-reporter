# AI QBR Reporter Stack

The ai-qbr-reporter solution automates executive reporting by combining a secure AWS data pipeline with Bedrock-powered narrative generation.

## Core Platform
- AWS CDK v2 (TypeScript) defines modular stacks for data, analytics, AI, and application orchestration.
- Python 3.11 Lambda functions share a dependency layer for KPI extraction, visualization, AI prompting, deck building, and delivery stages.

## Data & Analytics Fabric
- Amazon S3 data lake buckets (raw, curated, artifacts) encrypted with AWS KMS store inputs, curated KPIs, and generated assets.
- AWS Glue catalog and crawler expose curated datasets; Athena or optional Redshift Serverless workgroup powers KPI queries via configuration toggles.
- AWS Step Functions state machine sequences Lambda stages for KPI query, chart rendering, AI narrative authoring, Whitepaper assembly, and communication.

## AI-Driven Content Production
- Amazon Bedrock knowledge base built on Titan embeddings indexes curated collateral for retrieval-augmented generation.
- Narrative Lambda invokes Bedrock Agent Runtime `retrieve_and_generate` with guardrails to produce JSON narratives grounded in KPI evidence.
- Prompt assets in `app/prompts` steer tone, structure, and required outputs so the AI remains executive-ready and audit-friendly.
- AI-authored insights and charts feed the Whitepaper builder Lambda to stitch a board-ready deck.

## Delivery & Access
- Amazon API Gateway fronts the pipeline with a POST `/run` endpoint while EventBridge schedules monthly and quarterly executions.
- Amazon SES and optional Slack webhooks distribute AI-created narratives, slides, and summaries; an SQS DLQ buffers email failures.

## Operations & Security
- AWS KMS, IAM guardrails, and Bedrock guardrails enforce encryption, least privilege, and responsible AI behavior.
- CloudWatch logging plus an SNS failure topic surface pipeline health; SSM parameters and Secrets Manager manage configuration and secrets.

**AI at the core:** Retrieval-augmented Bedrock flows turn curated KPIs into polished executive narratives and decks, so the human review cycle starts with high-quality AI output instead of a blank page.
