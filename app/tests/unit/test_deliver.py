import pytest

from app.lambdas.deliver import handler as deliver


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv('ARTIFACTS_BUCKET', 'test-bucket')
    monkeypatch.setenv('SENDER_EMAIL', 'exec@example.com')
    monkeypatch.setenv('SIMULATE_SES', 'true')
    monkeypatch.delenv('SLACK_WEBHOOK_SECRET_ARN', raising=False)


def _narrative():
    return {'slides': [{'title': f'Section {i}', 'bullets': ['Point A']} for i in range(1, 7)], 'citations': []}


def test_deliver_accepts_whitepaper_output(monkeypatch):
    saved = {}
    monkeypatch.setattr(deliver, 'build_artifact_key', lambda p, e, f: f'{p}/{e}/{f}')
    monkeypatch.setattr(deliver, 'write_json_to_s3', lambda b, k, payload: saved.update(payload))
    event = {
        'whitepaper': {'bucket': 'test-bucket', 'key': 'artifacts/whitepapers/x/qbr_whitepaper.docx'},
        'narrative': _narrative(),
        'meta': {'period': '2024-Q2'},
    }
    result = deliver.lambda_handler(event, type('ctx', (), {'aws_request_id': 'exec'})())
    assert result['meta']['emailStatus'] == 'simulated'
    assert saved['Subject'] == '[Draft] QBR Package 2024-Q2'
    assert saved['Pptx']['key'].endswith('.docx')


def test_deliver_requires_a_document():
    with pytest.raises(ValueError, match='Whitepaper'):
        deliver.lambda_handler({'narrative': _narrative()}, None)
