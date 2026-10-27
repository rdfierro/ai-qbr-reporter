import io
import json
from pathlib import Path

import pytest
from docx import Document

from app.lambdas.whitepaper_builder import handler as wp_handler

FIXTURES = Path(__file__).resolve().parents[1] / 'fixtures'
MINI_PNG = (
    b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde'
    b'\x00\x00\x00\x0bIDAT\x08\xd7c``\x00\x00\x00\x04\x00\x01\x0b\x0e\x1d\xb3\x00\x00\x00\x00IEND\xaeB`\x82'
)


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv('ARTIFACTS_BUCKET', 'test-bucket')
    monkeypatch.setenv('KMS_KEY_ARN', 'arn:aws:kms:us-west-2:123456789012:key/test')
    monkeypatch.setattr(
        wp_handler, 'build_artifact_key',
        lambda prefix, execution_id, filename: f'{prefix}/{execution_id}/{filename}',
    )


def test_whitepaper_builder_outputs_docx(monkeypatch):
    sample_kpis = json.loads((FIXTURES / 'sample_kpis.json').read_text())
    captured = {}

    def fake_write(bucket, key, data, content_type):
        captured.update(bucket=bucket, key=key, data=data, content_type=content_type)

    monkeypatch.setattr(wp_handler, 'read_bytes_from_s3', lambda bucket, key: MINI_PNG, raising=False)
    monkeypatch.setattr(wp_handler, 'write_bytes_to_s3', fake_write)

    narrative = {
        'slides': [{'title': f'Section {i}', 'bullets': ['Point A', 'Point B']} for i in range(1, 7)],
        'citations': [],
    }
    event = {
        'kpis': sample_kpis,
        'charts': [{'bucket': 'test-bucket', 'key': f'chart-{i}.png'} for i in range(3)],
        'narrative': narrative,
        'meta': {},
    }

    result = wp_handler.lambda_handler(event, type('ctx', (), {'aws_request_id': 'exec'})())

    assert captured['bucket'] == 'test-bucket'
    assert captured['content_type'].endswith('wordprocessingml.document')
    doc = Document(io.BytesIO(captured['data']))
    text = '\n'.join(p.text for p in doc.paragraphs)
    for i in range(1, 7):
        assert f'Section {i}' in text
    assert result['whitepaper']['key'].endswith('qbr_whitepaper.docx')
