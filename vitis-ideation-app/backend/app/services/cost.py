"""
Cost meter. Every ai_calls row carries what it needs to be priced after the
fact - model, token counts, number of web searches, image quality - so the
console can show a participant's real spend instead of an estimate.

Prices are list prices from config.prices (overridable in .env). Mock calls
cost nothing. Unknown models fall back to the Sonnet rate and are flagged.
"""
from __future__ import annotations

from collections import defaultdict

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import config
from ..models import AICall

STAGE_LABELS = {
    "cae_extract": "issue structuring", "problems_identify": "issue structuring", "aopc": "issue structuring",
    "traditional_structure": "traditional ideas", "ideas_modern": "modern ideas",
    "keywords": "inspider ideas", "phenomena": "phenomena search", "ideas_inspider": "inspider ideas",
    "concept": "concepts", "render_prompts": "renders", "render": "renders", "embed": "phenomena search",
}


def _claude_rates(model: str) -> tuple[float, float]:
    m = (model or "").lower()
    for key in ("claude-opus", "claude-sonnet", "claude-haiku"):
        if m.startswith(key):
            return config.prices[key]
    return config.prices["claude-sonnet"]


def cost_of_call(c: AICall) -> float:
    """USD for one logged call, from what was recorded at the time."""
    if c.provider == "mock":
        return 0.0
    if c.provider == "anthropic":
        rate_in, rate_out = _claude_rates(c.model)
        usd = (c.input_tokens or 0) / 1e6 * rate_in + (c.output_tokens or 0) / 1e6 * rate_out
        resp = c.response or {}
        searches = resp.get("search_count")
        if searches is None:
            searches = len(resp.get("searches") or [])
        usd += searches / 1000 * config.prices["web_search_per_1000"]
        return usd
    if c.provider == "openai":
        if c.purpose == "render":
            if c.status != "ok":
                return 0.0  # failed generations are not billed
            quality = (c.request or {}).get("quality", config.image_quality)
            return config.prices["image"].get(quality, config.prices["image"]["medium"])
        if c.purpose == "embed":
            return (c.input_tokens or 0) / 1e6 * config.prices["embedding_per_m"]
    return 0.0


def session_cost(db: Session, session_id: int) -> dict:
    """Total and a breakdown by study stage and by model, for one session."""
    calls = db.scalars(select(AICall).where(AICall.session_id == session_id)).all()
    return summarise(calls)


def summarise(calls: list[AICall]) -> dict:
    total = 0.0
    by_stage: dict[str, dict] = defaultdict(lambda: {"usd": 0.0, "calls": 0, "input_tokens": 0, "output_tokens": 0, "searches": 0})
    by_model: dict[str, dict] = defaultdict(lambda: {"usd": 0.0, "calls": 0})
    for c in calls:
        usd = cost_of_call(c)
        total += usd
        label = STAGE_LABELS.get(c.purpose, c.purpose)
        b = by_stage[label]
        b["usd"] += usd
        b["calls"] += 1
        b["input_tokens"] += c.input_tokens or 0
        b["output_tokens"] += c.output_tokens or 0
        resp = c.response or {}
        b["searches"] += resp.get("search_count") if resp.get("search_count") is not None else len(resp.get("searches") or [])
        m = by_model[c.model]
        m["usd"] += usd
        m["calls"] += 1
    return {
        "total_usd": round(total, 4),
        "by_stage": {k: {**v, "usd": round(v["usd"], 4)} for k, v in by_stage.items()},
        "by_model": {k: {**v, "usd": round(v["usd"], 4)} for k, v in by_model.items()},
        "prices": {"claude": {k: config.prices[k] for k in ("claude-opus", "claude-sonnet")}, "web_search_per_1000": config.prices["web_search_per_1000"], "image": config.prices["image"]},
    }
