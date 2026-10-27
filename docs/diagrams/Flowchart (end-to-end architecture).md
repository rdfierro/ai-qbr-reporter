flowchart LR
  %% --- Styles ---
  classDef api fill:#E6E6E6,stroke:#143250,color:#143250,stroke-width:1.5;
  classDef orch fill:#E6E6E6,stroke:#143250,color:#143250,stroke-width:1.5;
  classDef data fill:#E6E6E6,stroke:#143250,color:#143250,stroke-width:1.5;
  classDef compute fill:#E6E6E6,stroke:#143250,color:#143250,stroke-width:1.5;
  classDef genai fill:#E6E6E6,stroke:#143250,color:#143250,stroke-width:1.5;
  classDef output fill:#E6E6E6,stroke:#143250,color:#143250,stroke-width:1.5;
  classDef guard fill:#FCED1E,stroke:#143250,color:#143250,stroke-width:1.5;

  %% --- Triggers & Orchestration ---
  subgraph T["Triggers & Orchestration"]
    EV["EventBridge<br/>(Schedule/Manual)"]:::orch
    API["API Gateway<br/>(Trigger UI / Slack)"]:::api
    SFN["Step Functions<br/>(Orchestrate pipeline)"]:::orch
    EV --> SFN
    API --> SFN
  end

  %% --- Data Ingestion & Storage ---
  subgraph D["Data Ingestion & Storage"]
    APPF["Salesforce via AppFlow"]:::data
    OTH["Other Sources<br/>(Product Analytics, Support, Finance)"]:::data
    S3R["S3 (Raw)"]:::data
    GLUE["Glue Crawler &<br/>Data Catalog"]:::data
    KB_S3["S3 (Curated docs)<br/>for Knowledge Base"]:::data
    APPF --> S3R
    OTH --> S3R
    S3R --> GLUE
  end

  %% --- Analytics, Generation & Assembly ---
  subgraph A["Analytics, Generation & Assembly"]
    ATH["Athena or<br/>Redshift Serverless"]:::data
    KPI["Lambda: KPI Query"]:::compute
    KB["Bedrock Knowledge Base<br/>(RAG over curated docs)"]:::genai
    NARR["Lambda: Narrative<br/>(Bedrock + Guardrails)"]:::compute
    CHART["Lambda: Chart Render<br/>(PNG via Matplotlib)"]:::compute
    PPTX["Lambda: PPTX Builder<br/>(python-pptx)"]:::compute
    GLUE --> ATH
    S3R -. "SQL reads" .-> ATH
    ATH --> KPI
    KB_S3 -. "indexed by" .-> KB
    KB -. "retrieves" .-> NARR
    KPI --> PPTX
    CHART --> PPTX
    NARR --> PPTX
  end

  %% --- Outputs ---
  subgraph O["Outputs"]
    S3A["S3 Artifacts<br/>(.pptx, PNG)"]:::output
    SES["SES Email Draft"]:::output
    SLK["Slack/Teams Post<br/>(optional)"]:::output
    PPTX --> S3A
    PPTX --> SES
    PPTX --> SLK
  end

  %% --- Optional QuickSight path ---
  QS["QuickSight<br/>(optional snapshot export)"]:::data
  ATH -. "dashboards/queries" .-> QS
  QS -. "PNG snapshot" .-> PPTX

  %% --- Security & controls across lanes ---
  SEC["Security & Controls<br/>• IAM least privilege<br/>• KMS encryption<br/>• VPC endpoints<br/>• Bedrock Guardrails"]:::guard
  SEC -.-> T
  SEC -.-> D
  SEC -.-> A
  SEC -.-> O
