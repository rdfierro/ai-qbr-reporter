import json
from pathlib import Path

import pytest

from app.lambdas.narrative import handler as narrative_handler

FIXTURES = Path(__file__).resolve().parents[1] / 'fixtures'


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv('BEDROCK_MODEL_PARAM', 'param/model')
    monkeypatch.setenv('BEDROCK_KB_PARAM', 'param/kb')
    monkeypatch.setenv('BEDROCK_GUARDRAIL_PARAM', 'param/gr')
    monkeypatch.setenv('AWS_REGION', 'us-west-2')


def test_narrative_generates_slide_payload(monkeypatch):
    sample_kpis = json.loads((FIXTURES / 'sample_kpis.json').read_text())

    def fake_param(name):
        return {
            'param/model': 'anthropic.claude-3-sonnet-20240229-v1:0',
            'param/kb': 'kb-123',
            'param/gr': 'gr-123',
        }[name]

    slides = [
        {
            'title': f'Slide {idx}',
            'bullets': ['Point 1', 'Point 2', 'Point 3'],
        }
        for idx in range(1, 7)
    ]

    response_payload = {
        'slides': slides,
        'citations': [{'doc': 'sample'}],
    }

    class FakeAgent:
        @staticmethod
        def retrieve_and_generate(**_kwargs):
            return {'output': {'text': json.dumps(response_payload)}, 'citations': response_payload['citations']}

    monkeypatch.setattr('app.lambdas.narrative.handler.load_ssm_parameter', fake_param)
    monkeypatch.setattr('app.lambdas.narrative.handler.AGENT_CLIENT', FakeAgent())

    event = {
        'kpis': sample_kpis,
        'audience': 'VP Product',
        'goals': ['Grow ARR'],
        'risks': ['Churn'],
        'charts': [],
        'meta': {},
    }

    result = narrative_handler.lambda_handler(event, type('ctx', (), {'aws_request_id': 'exec'})())

    assert 6 <= len(result['narrative']['slides']) <= 10
    for slide in result['narrative']['slides']:
        assert len(slide['bullets']) <= 4
    assert result['narrative']['citations']
