from datetime import datetime

import pytest

from app.lambdas.kpi_query import handler as kpi_handler


@pytest.fixture(autouse=True)
def _env(monkeypatch, tmp_path):
    monkeypatch.setenv('ARTIFACTS_BUCKET', 'test-bucket')
    monkeypatch.setenv('KMS_KEY_ARN', 'arn:aws:kms:us-west-2:123456789012:key/test')
    monkeypatch.setenv('ATHENA_WORKGROUP_PARAM', 'param/workgroup')
    monkeypatch.setenv('ATHENA_OUTPUT_PARAM', 'param/output')
    monkeypatch.setenv('USE_REDSHIFT', 'false')

    monkeypatch.setattr(
        'app.lambdas.kpi_query.handler.build_artifact_key',
        lambda prefix, execution_id, filename: f'{prefix}/{execution_id}/{filename}',
    )

    captured = {}

    def fake_write(bucket, key, payload):
        captured['bucket'] = bucket
        captured['key'] = key
        captured['payload'] = payload

    def fake_load(param):
        mapping = {'param/workgroup': 'wg', 'param/output': 's3://bucket/out/'}
        return mapping[param]

    def fake_query(query, period):
        return {
            'coverage': {'pipeline': 2.1, 'target': 3.0},
            'conversion': {'mql_to_sql': 0.4, 'sql_to_win': 0.2},
            'revenue': {'arr': 1000000, 'new': 250000, 'churn': 50000},
            'support': {'csat': 4.5, 'sla_breaches': 1},
            'adoption': {'wau': 12000, 'feature_x_usage_pct': 0.55},
        }

    monkeypatch.setattr('app.lambdas.kpi_query.handler.write_json_to_s3', fake_write)
    monkeypatch.setattr('app.lambdas.kpi_query.handler.load_ssm_parameter', fake_load)
    monkeypatch.setattr('app.lambdas.kpi_query.handler._run_athena_query', fake_query)

    yield captured


def test_kpi_query_generates_valid_payload(_env):
    result = kpi_handler.lambda_handler({'period': '2024-Q2'}, type('ctx', (), {'aws_request_id': 'abc'})())
    assert result['s3']['bucket'] == 'test-bucket'
    payload = _env['payload']
    assert payload['period'] == '2024-Q2'
    assert 'generated_at' in payload
    generated = datetime.fromisoformat(payload['generated_at'])
    assert generated.tzinfo is not None
