"""Configuration, read once from the environment (.env at repo root or backend/)."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

BACKEND_ROOT = Path(__file__).resolve().parent.parent
REPO_ROOT = BACKEND_ROOT.parent
for candidate in (REPO_ROOT / ".env", BACKEND_ROOT / ".env"):
    if candidate.exists():
        load_dotenv(candidate)
        break


def _env(name: str, default: str = "") -> str:
    v = os.environ.get(name, "")
    return v if v.strip() else default


def _bool(name: str, default: bool) -> bool:
    return _env(name, str(default)).strip().lower() in {"1", "true", "yes", "on"}


def _resolve(path_str: str) -> Path:
    p = Path(path_str)
    return p if p.is_absolute() else (REPO_ROOT / p).resolve()


@dataclass
class StudyDefaults:
    ideas_per_condition: int = int(_env("IDEAS_PER_CONDITION", "5"))
    concepts_per_idea: int = int(_env("CONCEPTS_PER_IDEA", "1"))
    keywords_proposed: int = int(_env("KEYWORDS_PROPOSED", "5"))
    neighbours_shown: int = int(_env("NEIGHBOURS_SHOWN", "5"))
    neighbours_max_pick: int = int(_env("NEIGHBOURS_MAX_PICK", "3"))
    phenomena_per_keyword: int = int(_env("PHENOMENA_PER_KEYWORD", "3"))
    # How many verbs survive the diversity selection before phenomena are
    # searched. 0 = as many as ideas_per_condition (one idea per verb).
    keywords_final: int = int(_env("KEYWORDS_FINAL", "0"))
    keyword_swaps_max: int = int(_env("KEYWORD_SWAPS_MAX", "1"))


@dataclass
class Config:
    env: str = _env("APP_ENV", "development")
    ai_provider: str = _env("AI_PROVIDER", "real")  # real | mock

    anthropic_api_key: str = _env("ANTHROPIC_API_KEY")
    # Two Claude tiers. The creative model writes the ideas and concepts that
    # participants rate - the thing the study measures. The fast model does the
    # structuring and retrieval around them (CAE, problems, AOPC, keywords,
    # phenomena search, render prompts), where a strict format matters more
    # than imagination. ANTHROPIC_CREATIVE_PURPOSES moves purposes between tiers.
    anthropic_model: str = _env("ANTHROPIC_MODEL", "claude-opus-5")
    anthropic_model_fast: str = _env("ANTHROPIC_MODEL_FAST", "claude-sonnet-5")
    creative_purposes: frozenset[str] = field(default_factory=lambda: frozenset(
        x.strip() for x in _env("ANTHROPIC_CREATIVE_PURPOSES", "ideas_modern,ideas_inspider,concept").split(",") if x.strip()))
    claude_web_search: bool = _bool("CLAUDE_WEB_SEARCH", True)
    # Each search's results are re-read as input tokens on every following turn
    # of the same call, so this is the single biggest cost lever in the study.
    web_search_max_uses: int = int(_env("CLAUDE_WEB_SEARCH_MAX_USES", "3"))

    openai_api_key: str = _env("OPENAI_API_KEY")
    image_model: str = _env("OPENAI_IMAGE_MODEL", "gpt-image-1")
    # The product shot is what participants judge; the in-use scene is context.
    image_quality: str = _env("OPENAI_IMAGE_QUALITY", "medium")
    image_quality_product: str = _env("OPENAI_IMAGE_QUALITY_PRODUCT", _env("OPENAI_IMAGE_QUALITY", "medium"))
    image_quality_in_use: str = _env("OPENAI_IMAGE_QUALITY_IN_USE", "low")
    # Default for the console's "in-use scene" switch (study_settings.render_in_use).
    render_in_use_default: bool = _bool("RENDER_IN_USE", False)
    embedding_model: str = _env("OPENAI_EMBEDDING_MODEL", "text-embedding-3-large")
    embedding_dimensions: int = int(_env("EMBEDDING_DIMENSIONS", "3072"))

    database_url: str = _env("DATABASE_URL", "sqlite:///./data/vitis.sqlite")
    image_dir: Path = field(default_factory=lambda: _resolve(_env("IMAGE_DIR", "backend/data/images")))
    inspider_data_dir: Path = field(default_factory=lambda: _resolve(_env("INSPIDER_DATA_DIR", "backend/inspider_data")))

    secret_salt: str = _env("SECRET_SALT", "dev-only-insecure-salt")
    cors_origins: list[str] = field(default_factory=lambda: [o.strip() for o in _env("CORS_ORIGINS", "http://localhost:5175").split(",") if o.strip()])
    participant_ttl_hours: int = int(_env("PARTICIPANT_TOKEN_TTL_HOURS", "72"))
    experimenter_ttl_hours: int = int(_env("EXPERIMENTER_TOKEN_TTL_HOURS", "12"))

    study: StudyDefaults = field(default_factory=StudyDefaults)

    # List prices (USD) used by the console's cost meter. Override when they change.
    # Claude: per million input / output tokens. Web search: per 1,000 searches.
    # Images: per 1024x1024 image by quality tier.
    prices: dict = field(default_factory=lambda: {
        "claude-opus": (float(_env("PRICE_OPUS_INPUT_PER_M", "5")), float(_env("PRICE_OPUS_OUTPUT_PER_M", "25"))),
        "claude-sonnet": (float(_env("PRICE_SONNET_INPUT_PER_M", "2")), float(_env("PRICE_SONNET_OUTPUT_PER_M", "10"))),
        "claude-haiku": (float(_env("PRICE_HAIKU_INPUT_PER_M", "1")), float(_env("PRICE_HAIKU_OUTPUT_PER_M", "5"))),
        "web_search_per_1000": float(_env("PRICE_WEB_SEARCH_PER_1000", "10")),
        "image": {"low": float(_env("PRICE_IMAGE_LOW", "0.011")), "medium": float(_env("PRICE_IMAGE_MEDIUM", "0.042")), "high": float(_env("PRICE_IMAGE_HIGH", "0.167"))},
        "embedding_per_m": float(_env("PRICE_EMBEDDING_PER_M", "0.13")),
    })

    def model_for(self, purpose: str) -> str:
        return self.anthropic_model if purpose in self.creative_purposes else self.anthropic_model_fast

    def __post_init__(self) -> None:
        # A relative sqlite path is relative to the backend dir, not the CWD.
        if self.database_url.startswith("sqlite:///./"):
            rel = self.database_url[len("sqlite:///./"):]
            self.database_url = f"sqlite:///{(BACKEND_ROOT / rel).as_posix()}"
        self.image_dir = Path(self.image_dir)
        self.image_dir.mkdir(parents=True, exist_ok=True)
        if self.database_url.startswith("sqlite:///"):
            Path(self.database_url[len("sqlite:///"):]).parent.mkdir(parents=True, exist_ok=True)

    @property
    def mock(self) -> bool:
        return self.ai_provider == "mock"


config = Config()
