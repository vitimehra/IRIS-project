"""
Step 5 - A 2-D map of the whole web, plus clusters and their names.

  Layout   PCA to 100 dims, then UMAP (cosine) to 2-D. UMAP on the raw 3072-d
           vectors works but is several times slower for no visible gain.
  Clusters Leiden community detection on the k-NN graph itself, so the regions
           on the map are regions of the web, not of the projection.
  Names    Each cluster is named by its most central verbs (PageRank within the
           cluster), e.g. "rise · climb · ascend". Optionally GPT writes a
           two-word label instead.
  Size     zipf frequency -> node radius, so rare and archaic verbs recede.
  Degree   in-degree on the k-NN graph = how many verbs count this one among
           their closest. A hub in the web.

Output: nodes.parquet (everything the app needs per verb) and clusters.parquet.
"""
from __future__ import annotations

import asyncio
import json
import time

import igraph as ig
import leidenalg
import numpy as np
import pandas as pd
from sklearn.decomposition import PCA

from .config import Config, Provenance

PCA_DIMS = 100
UMAP_NEIGHBORS = 30
UMAP_MIN_DIST = 0.08


def build_graph(n: int, edges: pd.DataFrame) -> ig.Graph:
    """Undirected, weighted. Duplicate (a,b)/(b,a) pairs collapse to the max sim."""
    g = ig.Graph(n=n, edges=list(zip(edges["src"].tolist(), edges["dst"].tolist())), directed=False)
    g.es["weight"] = edges["sim"].astype(float).tolist()
    g.simplify(combine_edges={"weight": "max"})
    return g


def umap_layout(vecs: np.ndarray, seed: int = 42) -> np.ndarray:
    import umap

    n, d = vecs.shape
    reduced = vecs
    if d > PCA_DIMS and n > PCA_DIMS:
        reduced = PCA(n_components=PCA_DIMS, random_state=seed).fit_transform(vecs)
    reducer = umap.UMAP(
        n_neighbors=min(UMAP_NEIGHBORS, max(2, n - 1)),
        min_dist=UMAP_MIN_DIST,
        metric="cosine",
        random_state=seed,
        low_memory=True,
    )
    xy = reducer.fit_transform(reduced)
    # Centre and scale to roughly [-100, 100] so the frontend has stable units.
    xy = xy - xy.mean(axis=0)
    scale = np.abs(xy).max() or 1.0
    return (xy / scale * 100.0).astype(np.float32)


def leiden_clusters(g: ig.Graph, resolution: float, seed: int = 42) -> np.ndarray:
    part = leidenalg.find_partition(
        g,
        leidenalg.RBConfigurationVertexPartition,
        weights="weight",
        resolution_parameter=resolution,
        seed=seed,
    )
    return np.array(part.membership, dtype=np.int32)


async def gpt_cluster_names(cfg: Config, samples: dict[int, list[str]]) -> dict[int, str]:
    from openai import AsyncOpenAI

    client = AsyncOpenAI(api_key=cfg.openai_api_key)
    sem = asyncio.Semaphore(cfg.concurrency)
    out: dict[int, str] = {}

    async def one(cid: int, verbs: list[str]) -> None:
        prompt = (
            "These English verbs form one cluster of related actions. Give the cluster a "
            "two-to-four word name describing the kind of phenomenon they share. Return ONLY "
            'JSON like {"name": "..."}.\n\n' + ", ".join(verbs)
        )
        async with sem:
            for attempt in range(3):
                try:
                    resp = await client.chat.completions.create(
                        model=cfg.chat_model,
                        messages=[{"role": "user", "content": prompt}],
                        temperature=0.2,
                        response_format={"type": "json_object"},
                    )
                    name = json.loads(resp.choices[0].message.content or "{}").get("name")
                    if isinstance(name, str) and name.strip():
                        out[cid] = name.strip()
                    return
                except Exception:
                    await asyncio.sleep(2**attempt)

    await asyncio.gather(*(one(c, v) for c, v in samples.items()))
    return out


def run(cfg: Config) -> tuple[pd.DataFrame, pd.DataFrame]:
    verbs = pd.read_parquet(cfg.glossed_parquet)
    edges = pd.read_parquet(cfg.edges_parquet)
    z = np.load(cfg.embeddings_npz, allow_pickle=True)
    vecs = z["vectors"].astype(np.float32)
    n = len(verbs)
    t0 = time.time()

    g = build_graph(n, edges)

    # --- degree and hubness -------------------------------------------------
    in_degree = np.bincount(edges["dst"].to_numpy(), minlength=n).astype(np.int32)
    pagerank = np.array(g.pagerank(weights="weight"), dtype=np.float32)

    # --- clusters -------------------------------------------------------------
    membership = leiden_clusters(g, cfg.cluster_resolution)
    n_clusters = int(membership.max()) + 1

    # --- layout ---------------------------------------------------------------
    xy = umap_layout(vecs)

    # --- cluster naming and summary ------------------------------------------
    cluster_rows = []
    samples: dict[int, list[str]] = {}
    for cid in range(n_clusters):
        members = np.where(membership == cid)[0]
        if len(members) == 0:
            continue
        # central = highest PageRank within the cluster
        order = members[np.argsort(-pagerank[members])]
        top = verbs["lemma"].to_numpy()[order[:5]].tolist()
        samples[cid] = verbs["lemma"].to_numpy()[order[:25]].tolist()
        cluster_rows.append(
            {
                "cluster_id": cid,
                "size": int(len(members)),
                "name": " · ".join(top[:3]),
                "top_verbs": top,
                "cx": float(xy[members, 0].mean()),
                "cy": float(xy[members, 1].mean()),
                "name_source": "central_verbs",
            }
        )
    clusters = pd.DataFrame(cluster_rows).sort_values("size", ascending=False).reset_index(drop=True)

    if cfg.gpt_name_clusters and cfg.openai_api_key:
        names = asyncio.run(gpt_cluster_names(cfg, samples))
        for cid, name in names.items():
            clusters.loc[clusters["cluster_id"] == cid, ["name", "name_source"]] = [name, "gpt"]

    # --- node table -----------------------------------------------------------
    nodes = verbs.copy()
    nodes["x"] = xy[:, 0]
    nodes["y"] = xy[:, 1]
    nodes["cluster_id"] = membership
    nodes["in_degree"] = in_degree
    nodes["pagerank"] = pagerank
    # Radius from frequency: zipf 1-7 -> 1.0-3.0, unknown words smallest.
    zf = nodes["zipf_frequency"].fillna(0).clip(0, 7)
    nodes["size"] = (1.0 + (zf / 7.0) * 2.0).astype(np.float32)

    nodes.to_parquet(cfg.nodes_parquet, index=False)
    clusters.to_parquet(cfg.clusters_parquet, index=False)

    elapsed = time.time() - t0
    Provenance.load(cfg).stamp(
        cfg,
        "05_layout",
        nodes=n,
        clusters=int(len(clusters)),
        largest_cluster=int(clusters["size"].max()) if len(clusters) else 0,
        resolution=cfg.cluster_resolution,
        layout="PCA(100) -> UMAP(2, cosine)",
        clustering="Leiden RBConfiguration on kNN graph, weights = cosine sim",
        gpt_named=bool(cfg.gpt_name_clusters and cfg.openai_api_key),
        seconds=round(elapsed, 1),
    )
    print(f"[05_layout] {n:,} nodes · {len(clusters):,} clusters in {elapsed:.0f}s -> {cfg.nodes_parquet}")
    return nodes, clusters


if __name__ == "__main__":
    run(Config())
