from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field, validator


class CoverageMetrics(BaseModel):
    pipeline: float = Field(..., ge=0)
    target: float = Field(..., ge=0)


class ConversionMetrics(BaseModel):
    mql_to_sql: float = Field(..., ge=0, le=1)
    sql_to_win: float = Field(..., ge=0, le=1)


class RevenueMetrics(BaseModel):
    arr: int = Field(..., ge=0)
    new: int = Field(..., ge=0)
    churn: int = Field(..., ge=0)


class SupportMetrics(BaseModel):
    csat: float = Field(..., ge=0, le=5)
    sla_breaches: int = Field(..., ge=0)


class AdoptionMetrics(BaseModel):
    wau: int = Field(..., ge=0)
    feature_x_usage_pct: float = Field(..., ge=0, le=1)


class KpiPayload(BaseModel):
    period: str
    coverage: CoverageMetrics
    conversion: ConversionMetrics
    revenue: RevenueMetrics
    support: SupportMetrics
    adoption: AdoptionMetrics
    generated_at: datetime


class ArtifactRef(BaseModel):
    bucket: str
    key: str
    content_type: Optional[str]


class NarrativeSlide(BaseModel):
    title: str
    bullets: List[str] = Field(..., min_items=1, max_items=4)

    @validator('bullets')
    def validate_bullets(cls, value: List[str]) -> List[str]:
        if any(len(bullet) > 240 for bullet in value):
            raise ValueError('bullet text too long')
        return value


class NarrativeResponse(BaseModel):
    slides: List[NarrativeSlide] = Field(..., min_length=6, max_length=10)
    citations: List[dict] = Field(default_factory=list)


class NarrativeInput(BaseModel):
    kpis: KpiPayload
    audience: str
    goals: List[str]
    risks: List[str]
    period: str


class PipelineResult(BaseModel):
    s3: ArtifactRef
    meta: dict
