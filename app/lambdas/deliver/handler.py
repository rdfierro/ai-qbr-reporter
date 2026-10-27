import json
import os
import urllib.request
from datetime import datetime, timezone
from typing import Any, Dict, List

import boto3
from botocore.exceptions import ClientError

from ..common.logging import get_logger
from ..common.models import NarrativeResponse
from ..common.utils import (
    build_artifact_key,
    resolve_execution_id,
    safe_get_secret,
    write_json_to_s3,
)

LOG = get_logger(__name__)
SES_CLIENT = boto3.client('ses')
SQS_CLIENT = boto3.client('sqs')


def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    # The builder step returns the document under 'whitepaper'; 'pptx' is the older name.
    pptx_ref = event.get('whitepaper') or event.get('pptx')
    narrative_data = event.get('narrative')
    if not pptx_ref or not narrative_data:
        raise ValueError('Whitepaper and narrative data required for delivery stage')

    narrative = NarrativeResponse(**narrative_data)
    recipients = event.get('recipients') or [os.environ['SENDER_EMAIL']]
    execution_id = resolve_execution_id(event, context)

    subject = f"[Draft] QBR Package {event.get('meta', {}).get('period', '')}".strip()
    summary = _summarize_narrative(narrative)

    email_payload = {
        'Subject': subject,
        'Body': summary,
        'Recipients': recipients,
        'Pptx': pptx_ref,
        'GeneratedAt': datetime.now(timezone.utc).isoformat(),
    }

    status = 'sent'
    if os.getenv('SIMULATE_SES', 'false').lower() == 'true':
        status = 'simulated'
        _persist_email(email_payload, execution_id)
    else:
        try:
            _send_email(recipients, subject, summary, pptx_ref)
        except ClientError as error:
            LOG.error('SES send failed', extra={'extra_fields': {'error': str(error)}})
            status = 'failed'
            _persist_email(email_payload, execution_id)
            _enqueue_failure(email_payload)

    _optionally_notify_slack(summary)

    return {
        'pptx': pptx_ref,
        'narrative': narrative.dict(),
        'meta': {
            'executionId': execution_id,
            'emailStatus': status,
        },
    }


def _send_email(recipients: List[str], subject: str, summary: str, pptx_ref: Dict[str, Any]) -> None:
    ses_payload = {
        'Source': os.environ['SENDER_EMAIL'],
        'Destination': {'ToAddresses': recipients},
        'Message': {
            'Subject': {'Data': subject, 'Charset': 'UTF-8'},
            'Body': {
                'Text': {
                    'Data': f"Summary:\n{summary}\n\nDocument: s3://{pptx_ref['bucket']}/{pptx_ref['key']}",
                    'Charset': 'UTF-8',
                }
            },
        },
    }
    SES_CLIENT.send_email(**ses_payload)


def _summarize_narrative(narrative: NarrativeResponse) -> str:
    highlight_slide = narrative.slides[0]
    bullets = '\n'.join(f"- {bullet}" for bullet in highlight_slide.bullets[:3])
    return f"{highlight_slide.title}\n{bullets}"


def _persist_email(email_payload: Dict[str, Any], execution_id: str) -> None:
    key = build_artifact_key('artifacts/emails', execution_id, 'draft.json')
    write_json_to_s3(os.environ['ARTIFACTS_BUCKET'], key, email_payload)


def _enqueue_failure(payload: Dict[str, Any]) -> None:
    queue_url = os.getenv('EMAIL_DLQ_URL')
    if not queue_url:
        return
    SQS_CLIENT.send_message(QueueUrl=queue_url, MessageBody=json.dumps(payload))


def _optionally_notify_slack(summary: str) -> None:
    secret_arn = os.getenv('SLACK_WEBHOOK_SECRET_ARN')
    if not secret_arn:
        return
    webhook = safe_get_secret(secret_arn)
    if not webhook:
        return
    data = json.dumps({'text': f"AI QBR Reporter summary:\n{summary}"}).encode('utf-8')
    request = urllib.request.Request(webhook, data=data, headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(request, timeout=10) as response:
        if response.status >= 300:
            LOG.warning('Slack webhook responded non-200', extra={'extra_fields': {'status': response.status}})

