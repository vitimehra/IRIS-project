"""
Step 4 - The web itself: each verb's top-k most similar verbs, as a weighted edge list.

A full N x N similarity matrix is 10^10 entries at one lakh verbs - 20 GB at
float16 - so it is never materialised. Instead, FAISS computes the exact top-k
neighbours by inner product on the unit-normalised vectors, which is exactly
cosine similarity. Any pair not in the top-k can still be scored on demand from
the stored embeddings.

Output: data/edges.parquet with columns
  src (int32), dst (int32), sim (float32, cosine similarity, 1 = identical), rank (int16)

The graph is stored directed (src's k-th neighbour is dst). The app treats it as
undirected for traversal; the direction is kept because "b is a's 3rd neighbour"
and "a is b's 40th" are both true and both informative.
"""
from __future__ import annotations

import time

import faiss
import numpy as np
import pandas as pd

from .config import Config, Provenance


def load_vectors(cfg: Config) -> tuple[np.ndarray, np.ndarray]:
    z = np.load(cfg.embeddings_npz, allow_pickle=True)
    return z["ids"].astype(np.int32), z["vectors"].astype(np.float32)


def run(cfg: Config) -> pd.DataFrame:
    ids, vecs = load_vectors(cfg)
    n, d = vecs.shape
    k = min(cfg.knn_k, n - 1)
    t0 = time.time()

    # Exact search. At 100k x 3072 this is a few minutes on CPU; at 20k it is seconds.
    faiss.normalize_L2(vecs)
    index = faiss.IndexFlatIP(d)
    index.add(vecs)

    sims = np.empty((n, k + 1), dtype=np.float32)
    nbrs = np.empty((n, k + 1), dtype=np.int64)
    chunk = 4096
    for start in range(0, n, chunk):
        s, i = index.search(vecs[start : start + chunk], k + 1)
        sims[start : start + chunk] = s
        nbrs[start : start + chunk] = i

    # Drop self-matches (rank 0 is nearly always the query itself; guard anyway).
    rows = []
    src_col, dst_col, sim_col, rank_col = [], [], [], []
    for i in range(n):
        rank = 0
        for j, s in zip(nbrs[i], sims[i]):
            if j == i or j < 0:
                continue
            src_col.append(i)
            dst_col.append(int(j))
            sim_col.append(float(s))
            rank_col.append(rank)
            rank += 1
            if rank >= k:
                break

    edges = pd.DataFrame(
        {
            "src": np.array(src_col, dtype=np.int32),
            "dst": np.array(dst_col, dtype=np.int32),
            "sim": np.clip(np.array(sim_col, dtype=np.float32), -1.0, 1.0),
            "rank": np.array(rank_col, dtype=np.int16),
        }
    )
    edges.to_parquet(cfg.edges_parquet, index=False)

    # Keep the index too: it makes ad-hoc "nearest to this arbitrary vector"
    # queries instant without rebuilding.
    faiss.write_index(index, str(cfg.faiss_index))

    elapsed = time.time() - t0
    Provenance.load(cfg).stamp(
        cfg,
        "04_knn",
        k=k,
        edges=len(edges),
        seconds=round(elapsed, 1),
        method="faiss IndexFlatIP exact, unit vectors (= cosine)",
        sim_convention="cosine similarity, 1 = identical",
        sim_stats={
            "mean": float(edges["sim"].mean()),
            "p10": float(edges["sim"].quantile(0.10)),
            "p50": float(edges["sim"].quantile(0.50)),
            "p90": float(edges["sim"].quantile(0.90)),
            "rank1_mean": float(edges[edges["rank"] == 0]["sim"].mean()),
        },
    )
    print(f"[04_knn] {len(edges):,} edges (k={k}) in {elapsed:.0f}s -> {cfg.edges_parquet}")
    return edges


if __name__ == "__main__":
    run(Config())
