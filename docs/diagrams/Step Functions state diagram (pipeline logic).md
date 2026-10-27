%% Paste into mermaid.live
stateDiagram-v2
  [*] --> KPI_QUERY
  KPI_QUERY --> CHART_RENDER
  CHART_RENDER --> NARRATIVE
  NARRATIVE --> DOCX_BUILDER
  DOCX_BUILDER --> DELIVER
  DELIVER --> [*]

  state KPI_QUERY {
    [*] --> Running
    Running --> Succeeded
    Running --> Failed
  }
  state CHART_RENDER {
    [*] --> Running
    Running --> Succeeded
    Running --> Failed
  }
  state NARRATIVE {
    [*] --> Running
    Running --> Succeeded
    Running --> Failed
  }
  state DOCX_BUILDER {
    [*] --> Running
    Running --> Succeeded
    Running --> Failed
  }
  state DELIVER {
    [*] --> Running
    Running --> Succeeded
    Running --> Failed
  }

  Failed --> [*]: Catch → DLQ/SNS alert
