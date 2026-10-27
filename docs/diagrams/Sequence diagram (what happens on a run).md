%% Paste into mermaid.live
sequenceDiagram
  autonumber
  actor User
  participant UI as Frontend (UI/Slack)
  participant API as API Gateway
  participant EV as EventBridge
  participant SFN as Step Functions
  participant KPI as Lambda: KPI Query
  participant ATH as Athena/Redshift
  participant CH as Lambda: Chart Render
  participant NR as Lambda: Narrative (Bedrock)
  participant KB as Bedrock KB
  participant PX as Lambda: DOCX Builder
  participant S3 as S3 (Artifacts)
  participant SES as SES (Email Draft)

  User->>UI: Click "Run Now" (period, audience, goals/risks)
  UI->>API: POST /run { payload }
  API->>SFN: StartExecution

  par Scheduled path
    EV-->>SFN: Cron trigger (optional)
  end

  SFN->>KPI: Invoke with {period, engine}
  KPI->>ATH: Run SQL / views
  ATH-->>KPI: KPI JSON
  KPI-->>SFN: {kpi_s3_key}

  SFN->>CH: Invoke with {kpi_s3_key}
  CH->>S3: Write PNG charts
  CH-->>SFN: {chart_keys[]}

  SFN->>NR: Invoke with {kpi_s3_key, audience, goals, risks}
  NR->>KB: Retrieve context (RAG)
  KB-->>NR: Grounding snippets/citations
  NR-->>SFN: {narrative_s3_key}

  SFN->>PX: Build whitepaper (charts + narrative)
  PX->>S3: Write .docx
  PX-->>SFN: {docx_key}

  SFN->>SES: Draft email with link/attachment
  SES-->>User: (optional) Notification / ready-to-send
