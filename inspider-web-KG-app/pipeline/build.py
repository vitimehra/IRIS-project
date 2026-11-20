"""
Run the whole pipeline, or any stage of it.

    python -m pipeline.build                 # all stages, skipping ones whose output exists
    python -m pipeline.build --force         # rebuild everything
    python -m pipeline.build --from 03       # rebuild from embedding onward
    python -m pipeline.build --only 05       # one stage
    python -m pipeline.build --provider dev --limit 2000   # quick smoke test
    python -m pipeline.build --estimate      # token count and indicative cost, no API calls

Stages are idempotent and each writes its own output file, so "skip if exists"
is safe: delete a file to redo that stage and everything after it.
"""
from __future__ import annotations

import argparse
import sys
import time

from .config import Config

STAGES = [
    ("01", "collect", "s01_collect", "verbs_parquet"),
    ("02", "gloss", "s02_gloss", "glossed_parquet"),
    ("03", "embed", "s03_embed", "embeddings_npz"),
    ("04", "knn", "s04_knn", "edges_parquet"),
    ("05", "layout", "s05_layout", "nodes_parquet"),
    ("06", "index", "s06_index", "duckdb_path"),
]


def estimate(cfg: Config) -> None:
    """Count tokens for the embed stage without calling the API."""
    import pandas as pd

    if not cfg.glossed_parquet.exists():
        print("Run stages 01 and 02 first (they need no API key).")
        return
    df = pd.read_parquet(cfg.glossed_parquet)
    try:
        import tiktoken

        enc = tiktoken.get_encoding("cl100k_base")
        tokens = sum(len(enc.encode(t)) for t in df["embed_text"])
    except ImportError:
        # ~4 characters per token is close enough for a budget.
        tokens = int(sum(len(t) for t in df["embed_text"]) / 4)
    for model, price in (("text-embedding-3-large", 0.13), ("text-embedding-3-small", 0.02)):
        usd = tokens / 1_000_000 * price
        print(f"{model:26} {len(df):>8,} verbs  {tokens:>10,} tokens  ~${usd:.3f}  (batch API ~${usd/2:.3f})")
    print("Prices are indicative per 1M tokens; check the current OpenAI price list.")


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="Build the Inspider Web.")
    p.add_argument("--force", action="store_true", help="rebuild every stage")
    p.add_argument("--from", dest="from_stage", help="rebuild from this stage number onward, e.g. 03")
    p.add_argument("--only", help="run one stage number only")
    p.add_argument("--provider", choices=["openai", "local", "dev"], help="override EMBEDDING_PROVIDER")
    p.add_argument("--limit", type=int, default=0, help="cap verbs for a smoke test")
    p.add_argument("--k", type=int, help="override KNN_K")
    p.add_argument("--estimate", action="store_true", help="print token count and cost, no API calls")
    args = p.parse_args(argv)

    cfg = Config()
    if args.provider:
        cfg.provider = args.provider
    if args.limit:
        cfg.limit = args.limit
    if args.k:
        cfg.knn_k = args.k

    if args.estimate:
        estimate(cfg)
        return 0

    print(f"[build] provider={cfg.provider} model={cfg.embedding_model} dims={cfg.embedding_dimensions} k={cfg.knn_k}"
          + (f" limit={cfg.limit}" if cfg.limit else ""))

    start_from = args.from_stage or "01"
    t0 = time.time()
    forced = args.force
    for num, name, module, output_attr in STAGES:
        if args.only and num != args.only:
            continue
        if num < start_from and not args.only:
            continue
        out = getattr(cfg, output_attr)
        if out.exists() and not forced and not args.only and num < start_from:
            continue
        if out.exists() and not forced and not args.only and not args.from_stage:
            print(f"[build] {num} {name}: {out.name} exists, skipping (use --force)")
            continue
        mod = __import__(f"pipeline.{module}", fromlist=["run"])
        mod.run(cfg)
        # once one stage is redone, everything downstream must be too
        forced = True

    print(f"[build] done in {time.time()-t0:.0f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
