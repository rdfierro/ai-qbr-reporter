import json
import logging
import os
import re
from typing import Any, Dict

_EMAIL_PATTERN = re.compile(r"[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+")
_PHONE_PATTERN = re.compile(r"\+?\d[\d\s().-]{7,}\d")


def _mask(value: str) -> str:
    masked = _EMAIL_PATTERN.sub('[redacted-email]', value)
    masked = _PHONE_PATTERN.sub('[redacted-phone]', masked)
    return masked


class JsonFormatter(logging.Formatter):
    """Emit JSON log lines with optional PII masking."""

    def format(self, record: logging.LogRecord) -> str:  # noqa: D401
        payload: Dict[str, Any] = {
            'level': record.levelname,
            'logger': record.name,
            'message': record.getMessage(),
        }
        if record.exc_info:
            payload['exception'] = self.formatException(record.exc_info)
        if hasattr(record, 'extra_fields'):
            payload.update(getattr(record, 'extra_fields'))

        if os.getenv('MASK_PII', 'false').lower() == 'true':
            payload = {k: _mask(str(v)) if isinstance(v, str) else v for k, v in payload.items()}

        return json.dumps(payload)


def get_logger(name: str) -> logging.Logger:
    logger = logging.getLogger(name)
    if logger.handlers:
        return logger

    level = os.getenv('LOG_LEVEL', 'INFO').upper()
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter())
    logger.addHandler(handler)
    logger.setLevel(level)
    logger.propagate = False
    return logger
