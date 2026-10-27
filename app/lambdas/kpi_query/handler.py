import json
import os
import time
from datetime import datetime, timezone
from typing import Any, Dict, List

import boto3
from botocore.exceptions import ClientError

from ..common.logging import get_logger
from ..common.models import KpiPayload, PipelineResult
from ..common.utils import (
    build_artifact_key,
    load_ssm_parameter,
    resolve_execution_id,
    write_json_to_s3,
)

LOG = get_logger(__name__)
ATHENA_CLIENT = boto3.client('athena')
REDSHIFT_DATA = boto3.client('redshift-data')

DEFAULT_QUERY = """
SELECT
  period,
  AVG(pipeline_coverage) AS pipeline,
  AVG(target_coverage) AS target,
  AVG(mql_to_sql) AS mql_to_sql,
  AVG(sql_to_win) AS sql_to_win,
  SUM(arr) AS arr,
  SUM(new_bookings) AS new,
  SUM(churn_amount) AS churn,
  AVG(csat) AS csat,
  SUM(sla_breaches) AS sla_breaches,
  AVG(wau) AS wau,
  AVG(feature_x_usage_pct) AS feature_x_usage_pct
FROM curated.ai_qbr_kpis
WHERE period = '{period}'
GROUP BY period
LIMIT 1;
"""


class QueryTimeoutError(Exception):
    pass


def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    period = event.get('period') or _current_period()
    engine = (event.get('engine') or ('redshift' if _use_redshift() else 'athena')).lower()
    execution_id = resolve_execution_id(event, context)
    queries = event.get('queries') or [DEFAULT_QUERY.format(period=period)]

    LOG.info(
        'Executing KPI query',
        extra={'extra_fields': {'period': period, 'engine': engine, 'executionId': execution_id}},
    )

    if engine == 'redshift':
        result = _run_redshift_query(queries[0], period)
    else:
        result = _run_athena_query(queries[0], period)

    payload = KpiPayload(
        period=period,
        coverage=result['coverage'],
        conversion=result['conversion'],
        revenue=result['revenue'],
        support=result['support'],
        adoption=result['adoption'],
        generated_at=datetime.now(timezone.utc),
    )

    artifact_key = build_artifact_key('artifacts/kpis', execution_id, 'kpis.json')
    bucket = os.environ['ARTIFACTS_BUCKET']
    write_json_to_s3(bucket, artifact_key, json.loads(payload.json()))

    response = PipelineResult(
        s3={'bucket': bucket, 'key': artifact_key, 'content_type': 'application/json'},
        meta={'engine': engine, 'period': period, 'executionId': execution_id},
    )

    LOG.info('KPI query completed', extra={'extra_fields': response.meta})
    return response.dict()


def _current_period() -> str:
    now = datetime.now(timezone.utc)
    quarter = (now.month - 1) // 3 + 1
    return f"{now.year}-Q{quarter}"


def _use_redshift() -> bool:
    return os.getenv('USE_REDSHIFT', 'false').lower() == 'true'


def _run_athena_query(query: str, period: str) -> Dict[str, Any]:
    workgroup_param = os.getenv('ATHENA_WORKGROUP_PARAM')
    output_param = os.getenv('ATHENA_OUTPUT_PARAM')

    if not workgroup_param:
        raise ValueError('ATHENA_WORKGROUP_PARAM not configured')

    workgroup = load_ssm_parameter(workgroup_param)
    output_location = load_ssm_parameter(output_param) if output_param else None

    args = {
        'QueryString': query.replace('{period}', period),
        'WorkGroup': workgroup,
    }
    if output_location:
        args['ResultConfiguration'] = {'OutputLocation': output_location}

    query_execution_id = ATHENA_CLIENT.start_query_execution(**args)['QueryExecutionId']

    status = _wait_for_athena(query_execution_id)
    if status != 'SUCCEEDED':
        raise QueryTimeoutError(f'Athena query failed with status {status}')

    results = ATHENA_CLIENT.get_query_results(QueryExecutionId=query_execution_id)
    return _rows_to_metrics(results['ResultSet']['Rows'])


def _wait_for_athena(query_execution_id: str) -> str:
    for _ in range(30):
        response = ATHENA_CLIENT.get_query_execution(QueryExecutionId=query_execution_id)
        status = response['QueryExecution']['Status']['State']
        if status in {'SUCCEEDED', 'FAILED', 'CANCELLED'}:
            return status
        time.sleep(2)
    return 'TIMEOUT'


def _rows_to_metrics(rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    if len(rows) < 2:
        raise ValueError('No KPI data returned')
    headers = [col['VarCharValue'] for col in rows[0]['Data']]
    values = [col.get('VarCharValue', '') for col in rows[1]['Data']]
    data = dict(zip(headers, values))

    return {
        'coverage': {
            'pipeline': float(data.get('pipeline', 0) or 0),
            'target': float(data.get('target', 0) or 0),
        },
        'conversion': {
            'mql_to_sql': float(data.get('mql_to_sql', 0) or 0),
            'sql_to_win': float(data.get('sql_to_win', 0) or 0),
        },
        'revenue': {
            'arr': int(float(data.get('arr', 0) or 0)),
            'new': int(float(data.get('new', 0) or 0)),
            'churn': int(float(data.get('churn', 0) or 0)),
        },
        'support': {
            'csat': float(data.get('csat', 0) or 0),
            'sla_breaches': int(float(data.get('sla_breaches', 0) or 0)),
        },
        'adoption': {
            'wau': int(float(data.get('wau', 0) or 0)),
            'feature_x_usage_pct': float(data.get('feature_x_usage_pct', 0) or 0),
        },
    }


def _run_redshift_query(query: str, period: str) -> Dict[str, Any]:
    workgroup_param = os.getenv('REDSHIFT_WORKGROUP_PARAM')
    namespace_param = os.getenv('REDSHIFT_NAMESPACE_PARAM')
    secret_arn = os.getenv('REDSHIFT_SECRET_ARN')

    if not all([workgroup_param, namespace_param, secret_arn]):
        raise ValueError('Redshift parameters not configured')

    workgroup = load_ssm_parameter(workgroup_param)

    statement = REDSHIFT_DATA.execute_statement(
        WorkgroupName=workgroup,
        Database=os.getenv('REDSHIFT_DATABASE', 'dev'),
        SecretArn=secret_arn,
        Sql=query.replace('{period}', period),
        WithEvent=True,
    )

    statement_id = statement['Id']
    status = _wait_for_redshift(statement_id)
    if status != 'FINISHED':
        raise QueryTimeoutError(f'Redshift statement did not finish: {status}')

    result = REDSHIFT_DATA.get_statement_result(Id=statement_id)
    if not result.get('Records'):
        raise ValueError('No KPI data returned from Redshift')

    headers = [col['name'] for col in result['ColumnMetadata']]
    values = [
        cell.get('stringValue')
        or cell.get('doubleValue')
        or cell.get('longValue')
        or 0
        for cell in result['Records'][0]
    ]
    data = dict(zip(headers, values))

    return {
        'coverage': {
            'pipeline': float(data.get('pipeline', 0) or 0),
            'target': float(data.get('target', 0) or 0),
        },
        'conversion': {
            'mql_to_sql': float(data.get('mql_to_sql', 0) or 0),
            'sql_to_win': float(data.get('sql_to_win', 0) or 0),
        },
        'revenue': {
            'arr': int(data.get('arr', 0) or 0),
            'new': int(data.get('new', 0) or 0),
            'churn': int(data.get('churn', 0) or 0),
        },
        'support': {
            'csat': float(data.get('csat', 0) or 0),
            'sla_breaches': int(data.get('sla_breaches', 0) or 0),
        },
        'adoption': {
            'wau': int(data.get('wau', 0) or 0),
            'feature_x_usage_pct': float(data.get('feature_x_usage_pct', 0) or 0),
        },
    }


def _wait_for_redshift(statement_id: str) -> str:
    for _ in range(30):
        response = REDSHIFT_DATA.describe_statement(Id=statement_id)
        status = response['Status']
        if status in {'FAILED', 'FINISHED', 'ABORTED'}:
            if status == 'FAILED':
                message = response.get('Error')
                raise ClientError({'Error': {'Message': message}}, 'ExecuteStatement')
            return status
        time.sleep(2)
    return 'TIMEOUT'


