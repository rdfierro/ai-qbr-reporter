import json
import os
from pathlib import Path
from typing import Any, Dict

import boto3
from botocore.exceptions import ClientError

from ..common.logging import get_logger
from ..common.models import KpiPayload, NarrativeInput, NarrativeResponse
from ..common.utils import load_ssm_parameter, resolve_execution_id

LOG = get_logger(__name__)
AGENT_CLIENT = boto3.client('bedrock-agent-runtime')

PROMPTS_DIR = Path(__file__).resolve().parents[2] / 'prompts'
SYSTEM_PROMPT_PATH = PROMPTS_DIR / 'system_prompt.txt'
USER_TEMPLATE_PATH = PROMPTS_DIR / 'user_template.json'


def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    kpi_data = event.get('kpis')
    if not kpi_data:
        raise ValueError('KPI payload missing for narrative stage')

    audience = event.get('audience', 'Executive Leadership')
    goals = event.get('goals', [])
    risks = event.get('risks', [])

    kpi_model = KpiPayload(**kpi_data)

    narrative_input = NarrativeInput(
        kpis=kpi_model.dict(),
        audience=audience,
        goals=goals,
        risks=risks,
        period=kpi_model.period,
    )

    execution_id = resolve_execution_id(event, context)

    system_prompt = SYSTEM_PROMPT_PATH.read_text(encoding='utf-8')
    user_template = json.loads(USER_TEMPLATE_PATH.read_text(encoding='utf-8'))

    payload = json.loads(narrative_input.json())
    payload['system_prompt'] = system_prompt
    user_payload = {**user_template, **payload}

    model_id = load_ssm_parameter(os.environ['BEDROCK_MODEL_PARAM'])
    kb_id = load_ssm_parameter(os.environ['BEDROCK_KB_PARAM'])
    guardrail_id = load_ssm_parameter(os.environ['BEDROCK_GUARDRAIL_PARAM'])

    model_arn = f"arn:aws:bedrock:{os.environ.get('AWS_REGION', 'us-west-2')}::foundation-model/{model_id}"

    try:
        response = AGENT_CLIENT.retrieve_and_generate(
            input={'text': json.dumps(user_payload)},
            retrieveAndGenerateConfiguration={
                'type': 'KNOWLEDGE_BASE',
                'knowledgeBaseConfiguration': {
                    'knowledgeBaseId': kb_id,
                    'modelArn': model_arn,
                },
            },
            sessionConfiguration={
                'guardrailConfiguration': {
                    'guardrailIdentifier': guardrail_id,
                    'guardrailVersion': '1',
                }
            },
        )
    except ClientError as err:
        LOG.error('Bedrock invocation failed', extra={'extra_fields': {'error': str(err)}})
        raise

    narrative = _parse_response(response)
    validated = NarrativeResponse(**narrative)

    result = {
        'kpis': kpi_data,
        'charts': event.get('charts', []),
        'narrative': validated.dict(),
        'meta': {
            'executionId': execution_id,
            'audience': audience,
            'knowledgeBaseId': kb_id,
        },
    }

    LOG.info('Narrative generated', extra={'extra_fields': {'executionId': execution_id}})
    return result


def _parse_response(response: Dict[str, Any]) -> Dict[str, Any]:
    output = response.get('output', {})
    text = output.get('text')
    if not text:
        raise ValueError('Bedrock response did not include narrative text')

    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ValueError('Model response is not valid JSON') from exc

    parsed.setdefault('citations', response.get('citations', []))
    return parsed




