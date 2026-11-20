"""
Pipeline configuration, read once from the environment (.env at repo root).

Every stage writes a provenance stamp next to its output, so two builds made
with different models, dimensions or k are never confused in analysis.
"""
from __future__ import annotations

import json
import os
import platform
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(REPO_ROOT / ".env")

PIPELINE_VERSION = "1.0.0"


def _env(name: str, default: str) -> str:
    value = os.environ.get(name, "")
    return value if value.strip() else default


def _env_bool(name: str, default: bool = False) -> bool:
    return _env(name, str(default)).strip().lower() in {"1", "true", "yes", "on"}


@dataclass
class Config:
    data_dir: Path = REPO_ROOT / _env("DATA_DIR", "data")

    # embeddings
    provider: str = _env("EMBEDDING_PROVIDER", "openai")
    openai_api_key: str = _env("OPENAI_API_KEY", "")
    embedding_model: str = _env("OPENAI_EMBEDDING_MODEL", "text-embedding-3-large")
    embedding_dimensions: int = int(_env("EMBEDDING_DIMENSIONS", "3072"))
    local_model: str = _env("LOCAL_EMBEDDING_MODEL", "all-MiniLM-L6-v2")
    chat_model: str = _env("OPENAI_CHAT_MODEL", "gpt-4o-mini")
    batch_size: int = int(_env("EMBED_BATCH_SIZE", "1024"))
    concurrency: int = int(_env("EMBED_CONCURRENCY", "8"))
    gpt_gloss_missing: bool = _env_bool("GPT_GLOSS_MISSING", False)
    gpt_name_clusters: bool = _env_bool("GPT_NAME_CLUSTERS", False)

    # graph
    knn_k: int = int(_env("KNN_K", "50"))
    cluster_resolution: float = float(_env("CLUSTER_RESOLUTION", "1.0"))

    # optional cap for smoke tests (0 = no cap)
    limit: int = 0

    def __post_init__(self) -> None:
        self.data_dir = Path(self.data_dir)
        for sub in ("raw", "checkpoints"):
            (self.data_dir / sub).mkdir(parents=True, exist_ok=True)

    # --- canonical file locations ------------------------------------------
    @property
    def raw_dir(self) -> Path:
        return self.data_dir / "raw"

    @property
    def checkpoint_dir(self) -> Path:
        return self.data_dir / "checkpoints"

    @property
    def verbs_parquet(self) -> Path:
        return self.data_dir / "verbs.parquet"

    @property
    def glossed_parquet(self) -> Path:
        return self.data_dir / "verbs_glossed.parquet"

    @property
    def embeddings_npz(self) -> Path:
        return self.data_dir / "embeddings.npz"

    @property
    def edges_parquet(self) -> Path:
        return self.data_dir / "edges.parquet"

    @property
    def nodes_parquet(self) -> Path:
        return self.data_dir / "nodes.parquet"

    @property
    def clusters_parquet(self) -> Path:
        return self.data_dir / "clusters.parquet"

    @property
    def duckdb_path(self) -> Path:
        return self.data_dir / "inspider.duckdb"

    @property
    def faiss_index(self) -> Path:
        return self.data_dir / "faiss.index"

    @property
    def provenance_json(self) -> Path:
        return self.data_dir / "provenance.json"

    def public(self) -> dict:
        """Config without the secret, for stamping into provenance."""
        d = asdict(self)
        d.pop("openai_api_key", None)
        d["data_dir"] = str(self.data_dir)
        return d


@dataclass
class Provenance:
    """One stamp per stage, accumulated in data/provenance.json."""

    pipeline_version: str = PIPELINE_VERSION
    stages: dict = field(default_factory=dict)

    @classmethod
    def load(cls, cfg: Config) -> "Provenance":
        if cfg.provenance_json.exists():
            raw = json.loads(cfg.provenance_json.read_text(encoding="utf-8"))
            return cls(pipeline_version=raw.get("pipeline_version", PIPELINE_VERSION), stages=raw.get("stages", {}))
        return cls()

    def stamp(self, cfg: Config, stage: str, **details) -> None:
        self.stages[stage] = {
            "completed_at": datetime.now(timezone.utc).isoformat(),
            "python": platform.python_version(),
            "platform": platform.platform(),
            **details,
        }
        cfg.provenance_json.write_text(
            json.dumps({"pipeline_version": self.pipeline_version, "config": cfg.public(), "stages": self.stages}, indent=2),
            encoding="utf-8",
        )
