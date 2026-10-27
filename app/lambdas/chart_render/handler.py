import io
import os
from datetime import datetime, timezone
from typing import Any, Dict, List

import matplotlib

matplotlib.use('Agg')
import matplotlib.pyplot as plt  # noqa: E402

from ..common.logging import get_logger
from ..common.models import ArtifactRef, KpiPayload
from ..common.utils import build_artifact_key, read_json_from_s3, resolve_execution_id, write_bytes_to_s3

LOG = get_logger(__name__)


def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    kpi_ref = event.get('s3') or {}
    bucket = kpi_ref.get('bucket') or os.environ['ARTIFACTS_BUCKET']
    key = kpi_ref.get('key')
    if not key:
        raise ValueError('KPI artifact key missing')

    data = read_json_from_s3(bucket, key)
    kpi_payload = KpiPayload(**data)

    execution_id = resolve_execution_id(event, context)

    charts: List[ArtifactRef] = []
    charts.append(_render_pipeline_chart(kpi_payload, execution_id))
    charts.append(_render_conversion_chart(kpi_payload, execution_id))
    charts.append(_render_adoption_chart(kpi_payload, execution_id))

    response = {
        'kpis': data,
        'charts': [chart.dict() for chart in charts],
        'meta': {
            'executionId': execution_id,
            'period': kpi_payload.period,
            'generated_at': datetime.now(timezone.utc).isoformat(),
        },
    }

    LOG.info('Charts rendered', extra={'extra_fields': {'executionId': execution_id}})
    return response


def _render_pipeline_chart(kpis: KpiPayload, execution_id: str) -> ArtifactRef:
    fig, ax = plt.subplots(figsize=(5, 3))
    ax.bar(['Pipeline', 'Target'], [kpis.coverage.pipeline, kpis.coverage.target], color=['#1f77b4', '#ff7f0e'])
    ax.set_ylabel('Coverage')
    ax.set_title(f'Pipeline Coverage {kpis.period}')
    ax.grid(axis='y', linestyle='--', alpha=0.3)
    key = build_artifact_key('artifacts/charts', execution_id, 'pipeline_coverage.png')
    _persist_figure(fig, key)
    return ArtifactRef(bucket=os.environ['ARTIFACTS_BUCKET'], key=key, content_type='image/png')


def _render_conversion_chart(kpis: KpiPayload, execution_id: str) -> ArtifactRef:
    fig, ax = plt.subplots(figsize=(5, 3))
    stages = ['MQL?SQL', 'SQL?Win']
    values = [kpis.conversion.mql_to_sql * 100, kpis.conversion.sql_to_win * 100]
    ax.bar(stages, values, color='#2ca02c')
    ax.set_ylim(0, 100)
    ax.set_ylabel('Conversion %')
    ax.set_title('Conversion Funnel')
    for idx, value in enumerate(values):
        ax.text(idx, value + 1, f'{value:.1f}%', ha='center')
    key = build_artifact_key('artifacts/charts', execution_id, 'conversion_funnel.png')
    _persist_figure(fig, key)
    return ArtifactRef(bucket=os.environ['ARTIFACTS_BUCKET'], key=key, content_type='image/png')


def _render_adoption_chart(kpis: KpiPayload, execution_id: str) -> ArtifactRef:
    fig, ax = plt.subplots(figsize=(5, 3))
    ax.plot(['Active Users', 'Feature X Usage'], [kpis.adoption.wau, kpis.adoption.feature_x_usage_pct * 100], marker='o')
    ax.set_title('Product Adoption Snapshot')
    ax.set_ylabel('Value')
    key = build_artifact_key('artifacts/charts', execution_id, 'adoption.png')
    _persist_figure(fig, key)
    return ArtifactRef(bucket=os.environ['ARTIFACTS_BUCKET'], key=key, content_type='image/png')


def _persist_figure(fig: plt.Figure, key: str) -> None:
    buffer = io.BytesIO()
    fig.tight_layout()
    fig.savefig(buffer, format='png')
    plt.close(fig)
    buffer.seek(0)
    write_bytes_to_s3(os.environ['ARTIFACTS_BUCKET'], key, buffer.read(), 'image/png')



