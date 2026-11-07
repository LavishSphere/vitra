"""Pydantic models mirroring contracts/CONTRACT.md sections 3-8 (v1)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

Product = Literal["A", "B", "both"]
Source = Literal[
    "pubmed", "ctgov", "fda_event", "fda_label", "fda_notice", "press_release", "news", "transcript"
]
SignalType = Literal[
    "efficacy",
    "safety",
    "regulatory",
    "trial_update",
    "competitor_move",
    "access_pricing",
    "guideline",
    "expert_opinion",
    "none",
]
AspectKey = Literal["efficacy", "safety", "convenience", "access_cost", "evidence_quality"]
Speaker = Literal["researcher", "hcp", "patient", "company", "regulator", "payer", "media"]
Origin = Literal["gold_dev", "predicted", "rule", "private_transcript", "synthetic_demo"]
Method = Literal["rule", "model", "mixed", "gold"]
Authority = Literal["regulator", "registry", "peer_reviewed", "company", "news", "private"]
Level = Literal["high", "medium", "low"]

ASPECTS: tuple[str, ...] = ("efficacy", "safety", "convenience", "access_cost", "evidence_quality")
SPEAKERS: tuple[str, ...] = (
    "researcher",
    "hcp",
    "patient",
    "company",
    "regulator",
    "payer",
    "media",
)
PRODUCTS: tuple[str, ...] = ("A", "B", "both")


class _Model(BaseModel):
    model_config = ConfigDict(frozen=True)


class AspectEvidence(_Model):
    aspect: AspectKey
    polarity: int = Field(ge=-2, le=2)
    speaker: Speaker
    span: str
    span_start: int = Field(ge=0)
    span_end: int = Field(ge=0)


class Confidence(_Model):
    level: Level
    method: Method
    span_verified: bool
    source_authority: Authority
    corroborating_items: int = Field(ge=0)
    notes: list[str] = Field(default_factory=list)


class EvidenceItem(_Model):
    item_id: str
    source: Source
    url: str
    published: str
    iso_week: str
    product: Product
    title: str
    text: str
    signal_type: SignalType
    actionable: Literal["yes", "no"]
    origin: Origin
    aspects: list[AspectEvidence]
    confidence: Confidence


class TrendCell(_Model):
    week: str
    product: Product
    speaker: Speaker | Literal["all"]
    aspect: AspectKey | Literal["all"]
    mean_polarity: float | None
    n_items: int
    n_sources: int
    item_ids: list[str]


class Citation(_Model):
    item_id: str
    aspect: AspectKey
    span: str
    url: str
    # Additive to contract v1: offsets of `span` in the cited item's full text.
    span_start: int
    span_end: int


class InsightCard(_Model):
    id: str
    headline: str
    signal_type: SignalType
    product: Product
    week: str
    actionable: bool
    why_it_matters: str
    citations: list[Citation]
    confidence: Confidence
    fact: str
    observed_sentiment: str
    interpretation: str


class EvidenceGap(_Model):
    product: Product
    speaker: Speaker
    aspect: AspectKey
    window_weeks: int
    n_items_in_window: int
    last_seen_week: str | None


IntakeStageName = Literal["received_locally", "classifying", "validating_quotes", "incorporating"]


class IntakeStage(_Model):
    name: IntakeStageName
    ms: int


class RejectedSpan(_Model):
    aspect: str
    span: str
    reason: str


class IntakeResult(_Model):
    status: Literal["complete", "abstained", "error"]
    stages: list[IntakeStage]
    evidence: EvidenceItem | None
    rejected_spans: list[RejectedSpan]
    error: str | None
    # Additive to contract v1: why the result abstained (null otherwise).
    reason: str | None = None


# ---- request bodies -------------------------------------------------------


class WhatIfRequest(BaseModel):
    excluded_ids: list[str] = Field(default_factory=list, max_length=10_000)
    # Additive filters so the response can stay small; same meaning as /api/trends.
    product: str | None = None
    aspect: str | None = None
    speaker: str | None = None


class WhatIfResponse(_Model):
    trends: list[TrendCell]
    insights: list[InsightCard]


class IntakeRequest(BaseModel):
    text: str
    title: str | None = None
    product: Product | None = None

    def __repr__(self) -> str:  # never let the transcript leak through a repr
        return f"IntakeRequest(len={len(self.text)})"

    __str__ = __repr__


class HealthResponse(_Model):
    status: str
    model_loaded: bool
    model: str | None
    prompt_version: str | None
    n_items: int


class PrivacyCheck(_Model):
    name: str
    ok: bool | None  # None = could not be checked here
    kind: Literal["runtime_check", "by_design"]
    detail: str


class PrivacyStatus(_Model):
    bind_host: str
    llm_url: str
    outbound_allowed: bool
    transcripts_persisted: bool
    checks: list[PrivacyCheck]
