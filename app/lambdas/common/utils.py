import json
import os
from functools import lru_cache
from typing import Any, Dict

import boto3
from botocore.exceptions import ClientError

s3_client = boto3.client('s3')
ssm_client = boto3.client('ssm')
sts_client = boto3.client('sts')


def resolve_execution_id(event: Dict[str, Any], context: Any) -> str:
    return (
        event.get('executionId')
        or event.get('meta', {}).get('executionId')
        or getattr(context, 'aws_request_id', 'manual-run')
    )


@lru_cache(maxsize=1)
def account_id() -> str:
    return sts_client.get_caller_identity()['Account']


def build_artifact_key(prefix: str, execution_id: str, filename: str) -> str:
    acct = account_id()
    return f"{prefix}/{acct}/{execution_id}/{filename}"


def read_json_from_s3(bucket: str, key: str) -> Dict[str, Any]:
    response = s3_client.get_object(Bucket=bucket, Key=key)
    body = response['Body'].read()
    return json.loads(body)


def write_json_to_s3(bucket: str, key: str, payload: Dict[str, Any]) -> None:
    s3_client.put_object(
        Bucket=bucket,
        Key=key,
        Body=json.dumps(payload).encode('utf-8'),
        ContentType='application/json',
        ServerSideEncryption='aws:kms',
        SSEKMSKeyId=os.getenv('KMS_KEY_ARN'),
    )


def write_bytes_to_s3(bucket: str, key: str, data: bytes, content_type: str) -> None:
    s3_client.put_object(
        Bucket=bucket,
        Key=key,
        Body=data,
        ContentType=content_type,
        ServerSideEncryption='aws:kms',
        SSEKMSKeyId=os.getenv('KMS_KEY_ARN'),
    )


def read_bytes_from_s3(bucket: str, key: str) -> bytes:
    response = s3_client.get_object(Bucket=bucket, Key=key)
    return response['Body'].read()


def load_ssm_parameter(name: str) -> str:
    response = ssm_client.get_parameter(Name=name)
    return response['Parameter']['Value']


def safe_get_secret(arn: str) -> str:
    if not arn:
        return ''
    secrets = boto3.client('secretsmanager')
    try:
        response = secrets.get_secret_value(SecretId=arn)
    except ClientError:
        return ''
    return response.get('SecretString') or ''

