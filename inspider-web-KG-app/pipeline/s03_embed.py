"""
Step 3 - One vector per verb, stored as data/embeddings.npz (float16, L2-normalised).

Three providers:
  openai  - text-embedding-3-large by default. Batched up to EMBED_BATCH_SIZE inputs
            per request, EMBED_CONCURRENCY requests in flight, exponential backoff.
            Each finished batch is checkpointed, so a dropped connection resumes
            from where it stopped rather than paying again.
  local   - sentence-transformers on this machine. No API, lower quality.
  dev     - deterministic pseudo-vectors for smoke-testing the pipeline and UI.
            They carry NO semantic meaning and are stamped as such in provenance.

Vectors are normalised to unit length before storage, so cosine similarity
downstream is a plain dot product.
"""
from __future__ import annotations

import asyncio
import hashlib
import time

import numpy as np
import pandas as pd
from tqdm import tqdm

from .config import Config, Provenance


def _normalise(x: np.ndarray) -> np.ndarray:
    x = x.astype(np.float32)
    norms = np.linalg.norm(x, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    return x / norms


# --- providers ---------------------------------------------------------------

async def embed_openai(cfg: Config, texts: list[str]) -> tuple[np.ndarray, dict]:
    from openai import AsyncOpenAI, RateLimitError, APIStatusError, APIConnectionError

    if not cfg.openai_api_key:
        raise SystemExit(
            "EMBEDDING_PROVIDER=openai but OPENAI_API_KEY is empty. "
            "Put your key in .env, or run with --provider dev for a smoke test."
        )

    client = AsyncOpenAI(api_key=cfg.openai_api_key)
    sem = asyncio.Semaphore(cfg.concurrency)
    n = len(texts)
    batches = [(i, texts[i : i + cfg.batch_size]) for i in range(0, n, cfg.batch_size)]
    usage = {"prompt_tokens": 0, "requests": 0, "retries": 0, "resumed_batches": 0}

    async def one(start: int, batch: list[str]) -> tuple[int, np.ndarray]:
        ckpt = cfg.checkpoint_dir / f"embed_{cfg.embedding_model}_{cfg.embedding_dimensions}_{start:07d}.npy"
        if ckpt.exists():
            usage["resumed_batches"] += 1
            return start, np.load(ckpt)

        async with sem:
            delay = 2.0
            for attempt in range(8):
                try:
                    resp = await client.embeddings.create(
                        model=cfg.embedding_model,
                        input=batch,
                        dimensions=cfg.embedding_dimensions,
                        encoding_format="float",
                    )
                    vecs = np.array([d.embedding for d in resp.data], dtype=np.float32)
                    usage["prompt_tokens"] += getattr(resp.usage, "prompt_tokens", 0) or 0
                    usage["requests"] += 1
                    np.save(ckpt, vecs)
                    return start, vecs
                except (RateLimitError, APIConnectionError) as e:
                    usage["retries"] += 1
                    await asyncio.sleep(delay)
                    delay = min(delay * 2, 60)
                except APIStatusError as e:
                    if e.status_code >= 500:
                        usage["retries"] += 1
                        await asyncio.sleep(delay)
                        delay = min(delay * 2, 60)
                    else:
                        raise
            raise RuntimeError(f"Batch at {start} failed after retries.")

    results: dict[int, np.ndarray] = {}
    tasks = [one(s, b) for s, b in batches]
    for coro in tqdm(asyncio.as_completed(tasks), total=len(tasks), desc="openai embed", unit="batch"):
        start, vecs = await coro
        results[start] = vecs

    out = np.concatenate([results[s] for s, _ in batches], axis=0)
    return out, usage


def embed_local(cfg: Config, texts: list[str]) -> tuple[np.ndarray, dict]:
    try:
        from sentence_transformers import SentenceTransformer
    except ImportError:
        raise SystemExit(
            "EMBEDDING_PROVIDER=local needs sentence-transformers: pip install sentence-transformers"
        )
    model = SentenceTransformer(cfg.local_model)
    vecs = model.encode(texts, batch_size=256, show_progress_bar=True, convert_to_numpy=True)
    return vecs.astype(np.float32), {"model": cfg.local_model, "dimensions": int(vecs.shape[1])}


def embed_dev(cfg: Config, texts: list[str], dims: int = 256) -> tuple[np.ndarray, dict]:
    """
    Deterministic pseudo-embeddings for smoke tests.

    Built from character n-gram hashes so that orthographically similar verbs
    land near each other - enough structure for the UI to look alive, and
    deliberately nothing like real semantics. Never analyse these.
    """
    out = np.zeros((len(texts), dims), dtype=np.float32)
    for i, text in enumerate(texts):
        word = text.split(":")[0].strip().lower()
        padded = f"  {word}  "
        for n in (2, 3):
            for j in range(len(padded) - n + 1):
                gram = padded[j : j + n]
                h = int(hashlib.blake2b(gram.encode(), digest_size=4).hexdigest(), 16)
                out[i, h % dims] += 1.0 if (h >> 31) else -1.0
    return out, {"warning": "DEV pseudo-embeddings - no semantic meaning"}


# --- stage -------------------------------------------------------------------

def run(cfg: Config) -> np.ndarray:
    df = pd.read_parquet(cfg.glossed_parquet)
    texts = df["embed_text"].tolist()
    t0 = time.time()

    if cfg.provider == "openai":
        vecs, usage = asyncio.run(embed_openai(cfg, texts))
        model_name, dims = cfg.embedding_model, cfg.embedding_dimensions
    elif cfg.provider == "local":
        vecs, usage = embed_local(cfg, texts)
        model_name, dims = cfg.local_model, int(vecs.shape[1])
    elif cfg.provider == "dev":
        vecs, usage = embed_dev(cfg, texts)
        model_name, dims = "dev-ngram-hash", int(vecs.shape[1])
    else:
        raise SystemExit(f"Unknown EMBEDDING_PROVIDER {cfg.provider!r}. Use openai, local or dev.")

    if vecs.shape[0] != len(df):
        raise RuntimeError(f"Expected {len(df)} vectors, got {vecs.shape[0]}.")

    vecs = _normalise(vecs)

    np.savez_compressed(
        cfg.embeddings_npz,
        ids=df["id"].to_numpy(dtype=np.int32),
        lemmas=df["lemma"].to_numpy(dtype=object),
        vectors=vecs.astype(np.float16),
        model=np.array(model_name),
        dimensions=np.array(dims),
        normalised=np.array(True),
    )

    elapsed = time.time() - t0
    cost_note = None
    if cfg.provider == "openai":
        # Indicative only; verify against the current price list.
        per_million = 0.13 if "large" in cfg.embedding_model else 0.02
        cost_note = {
            "prompt_tokens": usage["prompt_tokens"],
            "indicative_usd": round(usage["prompt_tokens"] / 1_000_000 * per_million, 4),
            "price_assumed_per_1M_tokens": per_million,
        }

    Provenance.load(cfg).stamp(
        cfg,
        "03_embed",
        provider=cfg.provider,
        model=model_name,
        dimensions=dims,
        vectors=int(vecs.shape[0]),
        seconds=round(elapsed, 1),
        usage=usage,
        cost=cost_note,
        stored_dtype="float16",
        normalised=True,
    )
    print(
        f"[03_embed] {vecs.shape[0]:,} x {dims} via {cfg.provider} ({model_name}) in {elapsed:.0f}s"
        + (f" · ~${cost_note['indicative_usd']}" if cost_note else "")
        + f" -> {cfg.embeddings_npz}"
    )
    return vecs


if __name__ == "__main__":
    run(Config())
