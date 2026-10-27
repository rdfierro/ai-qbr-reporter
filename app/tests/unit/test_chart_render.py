import json
from pathlib import Path

import pytest

from app.lambdas.chart_render import handler as chart_handler

FIXTURES = Path(__file__).resolve().parents[1] / 'fixtures'


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv('ARTIFACTS_BUCKET', 'test-bucket')
    monkeypatch.setenv('KMS_KEY_ARN', 'arn:aws:kms:us-west-2:123:key/test')
    monkeypatch.setattr(
        'app.lambdas.chart_render.handler.build_artifact_key',
        lambda prefix, execution_id, filename: f'{prefix}/{execution_id}/{filename}',
    )


def test_chart_render_generates_pngs(monkeypatch):
    captured = []

    def fake_read(_bucket, _key):
        data = json.loads((FIXTURES / 'sample_kpis.json').read_text())
        return data

    def fake_write(bucket, key, data, content_type):
        captured.append({'bucket': bucket, 'key': key, 'data': data, 'content_type': content_type})

    monkeypatch.setattr('app.lambdas.chart_render.handler.read_json_from_s3', fake_read)
    monkeypatch.setattr('app.lambdas.chart_render.handler.write_bytes_to_s3', fake_write)

    result = chart_handler.lambda_handler({'s3': {'bucket': 'irrelevant', 'key': 'kpis.json'}}, type('ctx', (), {'aws_request_id': 'abc'})())

    assert len(result['charts']) == 3
    assert len(captured) == 3
    for item in captured:
        assert item['content_type'] == 'image/png'
        assert item['data'].startswith(b'\x89PNG')
