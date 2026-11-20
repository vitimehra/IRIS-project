"""
The in-memory web.

Loads the pipeline outputs once at startup and answers every query from RAM:
  nodes        pandas frame (one row per verb) + dict lookups
  adjacency    CSR arrays over the directed k-NN edges, for O(k) neighbour reads
  graph        igraph, undirected, for shortest paths and random walks
  vectors      float32 unit vectors, for analogy and any-pair similarity
  search       rapidfuzz over the lemma list, typo-tolerant

At 23k verbs this is ~150 MB resident; at 100k with 3072-d vectors ~1.5 GB,
which is why the vectors are the only optional part (see `load_vectors`).
"""
from __future__ import annotations

import json
import math
import random
from dataclasses import dataclass
from pathlib import Path

import igraph as ig
import numpy as np
import pandas as pd
from rapidfuzz import process
from rapidfuzz.distance import DamerauLevenshtein


@dataclass
class Meta:
    verbs: int
    edges: int
    clusters: int
    k: int
    provider: str
    model: str
    dimensions: int
    provenance: dict


class WebStore:
    def __init__(self, data_dir: Path, load_vectors: bool = True):
        self.data_dir = Path(data_dir)
        self.nodes = pd.read_parquet(self.data_dir / "nodes.parquet")
        self.edges = pd.read_parquet(self.data_dir / "edges.parquet")
        self.clusters = pd.read_parquet(self.data_dir / "clusters.parquet")
        self.provenance = (
            json.loads((self.data_dir / "provenance.json").read_text(encoding="utf-8"))
            if (self.data_dir / "provenance.json").exists()
            else {}
        )

        self.n = len(self.nodes)
        self.lemmas: list[str] = self.nodes["lemma"].tolist()
        self.id_by_lemma: dict[str, int] = {l: i for i, l in enumerate(self.lemmas)}
        # forms -> lemma id, so searching "rose" or "rising" finds "rise"
        self.id_by_form: dict[str, int] = {}
        for i, forms in enumerate(self.nodes["forms"]):
            for f in forms if forms is not None else []:
                self.id_by_form.setdefault(f, i)

        self._build_csr()
        self._build_graph()
        self.vectors: np.ndarray | None = None
        if load_vectors:
            self.load_vectors()

        self._search_choices = self.lemmas
        self.unverified = self.nodes["unverified"].to_numpy(dtype=bool)
        self.k = int(self.edges["rank"].max()) + 1 if len(self.edges) else 0

    # --- construction --------------------------------------------------------

    def _build_csr(self) -> None:
        e = self.edges.sort_values(["src", "rank"])
        self.csr_dst = e["dst"].to_numpy(dtype=np.int32)
        self.csr_sim = e["sim"].to_numpy(dtype=np.float32)
        counts = np.bincount(e["src"].to_numpy(), minlength=self.n)
        self.csr_ptr = np.zeros(self.n + 1, dtype=np.int64)
        np.cumsum(counts, out=self.csr_ptr[1:])

    def _build_graph(self) -> None:
        g = ig.Graph(
            n=self.n,
            edges=list(zip(self.edges["src"].tolist(), self.edges["dst"].tolist())),
            directed=False,
        )
        g.es["sim"] = self.edges["sim"].astype(float).tolist()
        g.simplify(combine_edges={"sim": "max"})
        # Path cost: dissimilarity. A path through near-synonyms is cheap.
        g.es["cost"] = [max(1e-4, 1.0 - s) for s in g.es["sim"]]
        self.graph = g

    def load_vectors(self) -> None:
        z = np.load(self.data_dir / "embeddings.npz", allow_pickle=True)
        self.vectors = z["vectors"].astype(np.float32)
        self.vector_model = str(z["model"])
        self.vector_dims = int(z["dimensions"])

    # --- meta ---------------------------------------------------------------

    def meta(self) -> Meta:
        embed = self.provenance.get("stages", {}).get("03_embed", {})
        return Meta(
            verbs=self.n,
            edges=int(len(self.edges)),
            clusters=int(len(self.clusters)),
            k=self.k,
            provider=embed.get("provider", "unknown"),
            model=embed.get("model", "unknown"),
            dimensions=int(embed.get("dimensions", 0)),
            provenance=self.provenance,
        )

    # --- lookup --------------------------------------------------------------

    def resolve(self, term: str) -> int | None:
        t = term.strip().lower()
        if t in self.id_by_lemma:
            return self.id_by_lemma[t]
        if t in self.id_by_form:
            return self.id_by_form[t]
        try:
            i = int(t)
            if 0 <= i < self.n:
                return i
        except ValueError:
            pass
        return None

    def node(self, i: int) -> dict:
        r = self.nodes.iloc[i]
        return {
            "id": int(r["id"]),
            "lemma": r["lemma"],
            "gloss": r["gloss"] if isinstance(r["gloss"], str) else None,
            "gloss_source": r["gloss_source"],
            "forms": list(r["forms"]) if r["forms"] is not None else [],
            "sources": list(r["sources"]) if r["sources"] is not None else [],
            "verbnet_classes": list(r["verbnet_classes"]) if r["verbnet_classes"] is not None else [],
            "in_wordnet": bool(r["in_wordnet"]),
            "unverified": bool(r["unverified"]),
            "synset_count": int(r["synset_count"]),
            "zipf_frequency": float(r["zipf_frequency"]),
            "cluster_id": int(r["cluster_id"]),
            "cluster_name": self.cluster_name(int(r["cluster_id"])),
            "in_degree": int(r["in_degree"]),
            "pagerank": float(r["pagerank"]),
            "size": float(r["size"]),
            "x": float(r["x"]),
            "y": float(r["y"]),
        }

    def brief(self, i: int) -> dict:
        r = self.nodes.iloc[i]
        return {
            "id": int(i),
            "lemma": r["lemma"],
            "cluster_id": int(r["cluster_id"]),
            "size": float(r["size"]),
            "unverified": bool(r["unverified"]),
            "x": float(r["x"]),
            "y": float(r["y"]),
        }

    def cluster_name(self, cid: int) -> str:
        row = self.clusters[self.clusters["cluster_id"] == cid]
        return str(row.iloc[0]["name"]) if len(row) else f"cluster {cid}"

    # --- search --------------------------------------------------------------

    def search(self, q: str, limit: int = 12, include_unverified: bool = False) -> list[dict]:
        q = q.strip().lower()
        if not q:
            return []
        out: list[dict] = []
        seen: set[int] = set()

        def push(i: int, score: float, why: str) -> None:
            if i in seen or (not include_unverified and self.unverified[i]):
                return
            seen.add(i)
            out.append({**self.brief(i), "score": round(float(score), 1), "match": why})

        if q in self.id_by_lemma:
            push(self.id_by_lemma[q], 100, "exact")
        if q in self.id_by_form:
            push(self.id_by_form[q], 99, f"form of {self.lemmas[self.id_by_form[q]]}")

        # prefix matches, frequent first
        prefix = [i for i, l in enumerate(self.lemmas) if l.startswith(q)]
        prefix.sort(key=lambda i: -float(self.nodes.iat[i, self.nodes.columns.get_loc("zipf_frequency")]))
        for i in prefix[: limit * 2]:
            push(i, 90, "prefix")
            if len(out) >= limit:
                return out[:limit]

        # Fuzzy, typo tolerant. Damerau-Levenshtein counts a transposition
        # ("rsie" for "rise") as one edit, where token-ratio scorers prefer any
        # longer word that merely contains the letters. Ties break on frequency,
        # so "rise" outranks "rile" for a 4-letter typo.
        zipf_col = self.nodes.columns.get_loc("zipf_frequency")
        cands = process.extract(
            q, self._search_choices, scorer=DamerauLevenshtein.normalized_similarity, limit=limit * 6
        )
        ranked = []
        for lemma, nsim, i in cands:
            if nsim < 0.6:
                continue
            zipf = float(self.nodes.iat[int(i), zipf_col])
            ranked.append((0.85 * nsim * 100 + 0.15 * (min(zipf, 7.0) / 7.0) * 100, int(i)))
        for score, i in sorted(ranked, reverse=True):
            push(i, score, "fuzzy")
            if len(out) >= limit:
                break
        return out[:limit]

    # --- neighbourhood ------------------------------------------------------

    def neighbours(self, i: int, k: int | None = None, min_sim: float = -1.0, include_unverified: bool = False) -> list[dict]:
        s, e = self.csr_ptr[i], self.csr_ptr[i + 1]
        out = []
        for rank, (j, sim) in enumerate(zip(self.csr_dst[s:e], self.csr_sim[s:e])):
            if sim < min_sim:
                break
            if not include_unverified and self.unverified[j]:
                continue
            out.append({**self.brief(int(j)), "sim": float(sim), "rank": rank})
            if k is not None and len(out) >= k:
                break
        return out

    def ego(self, i: int, k: int = 20, depth: int = 1, min_sim: float = -1.0, include_unverified: bool = False) -> dict:
        """Nodes and edges within `depth` hops, each hop limited to top-k."""
        depth = max(1, min(depth, 3))
        nodes: dict[int, dict] = {i: {**self.brief(i), "hop": 0}}
        edges: list[dict] = []
        frontier = [i]
        for hop in range(1, depth + 1):
            # the outer ring is thinner per node, or depth 2 explodes to k^2
            per_node = k if hop == 1 else max(3, k // 4)
            next_frontier = []
            for a in frontier:
                for nb in self.neighbours(a, per_node, min_sim, include_unverified):
                    b = nb["id"]
                    if b not in nodes:
                        nodes[b] = {**self.brief(b), "hop": hop}
                        next_frontier.append(b)
                    edges.append({"source": a, "target": b, "sim": nb["sim"], "rank": nb["rank"]})
            frontier = next_frontier
        # close triangles among the shown nodes so the web has cross-strands
        shown = set(nodes)
        extra = 0
        for a in list(shown):
            s, e = self.csr_ptr[a], self.csr_ptr[a + 1]
            for j, sim in zip(self.csr_dst[s:e], self.csr_sim[s:e]):
                if int(j) in shown and int(j) > a and sim >= min_sim:
                    edges.append({"source": a, "target": int(j), "sim": float(sim), "rank": -1, "cross": True})
                    extra += 1
        # de-duplicate edges (a,b) keeping the max sim
        best: dict[tuple[int, int], dict] = {}
        for ed in edges:
            key = (min(ed["source"], ed["target"]), max(ed["source"], ed["target"]))
            if key not in best or ed["sim"] > best[key]["sim"]:
                best[key] = ed
        return {"center": i, "nodes": list(nodes.values()), "edges": list(best.values())}

    # --- pairs and vectors ----------------------------------------------------

    def similarity(self, a: int, b: int) -> float:
        if self.vectors is None:
            # fall back to the stored edge if there is one
            s, e = self.csr_ptr[a], self.csr_ptr[a + 1]
            for j, sim in zip(self.csr_dst[s:e], self.csr_sim[s:e]):
                if j == b:
                    return float(sim)
            return float("nan")
        return float(np.dot(self.vectors[a], self.vectors[b]))

    def compare(self, a: int, b: int, k: int = 50) -> dict:
        na = {n["id"]: n for n in self.neighbours(a, k, include_unverified=True)}
        nb = {n["id"]: n for n in self.neighbours(b, k, include_unverified=True)}
        shared_ids = set(na) & set(nb)
        union = set(na) | set(nb)
        shared = sorted(
            ({**self.brief(i), "sim_a": na[i]["sim"], "sim_b": nb[i]["sim"]} for i in shared_ids),
            key=lambda r: -(r["sim_a"] + r["sim_b"]),
        )
        return {
            "a": self.node(a),
            "b": self.node(b),
            "similarity": self.similarity(a, b),
            "shared_neighbours": shared,
            "jaccard": (len(shared_ids) / len(union)) if union else 0.0,
            "same_cluster": bool(self.nodes.iat[a, self.nodes.columns.get_loc("cluster_id")] == self.nodes.iat[b, self.nodes.columns.get_loc("cluster_id")]),
        }

    def nearest_to_vector(self, v: np.ndarray, k: int, exclude: set[int], include_unverified: bool) -> list[dict]:
        if self.vectors is None:
            raise RuntimeError("Vectors not loaded.")
        v = v / (np.linalg.norm(v) or 1.0)
        scores = self.vectors @ v
        order = np.argsort(-scores)
        out = []
        for i in order:
            i = int(i)
            if i in exclude or (not include_unverified and self.unverified[i]):
                continue
            out.append({**self.brief(i), "sim": float(scores[i])})
            if len(out) >= k:
                break
        return out

    def analogy(self, positive: list[int], negative: list[int], k: int = 10, include_unverified: bool = False) -> list[dict]:
        if self.vectors is None:
            raise RuntimeError("Vectors not loaded.")
        v = np.zeros(self.vectors.shape[1], dtype=np.float32)
        for i in positive:
            v += self.vectors[i]
        for i in negative:
            v -= self.vectors[i]
        return self.nearest_to_vector(v, k, set(positive) | set(negative), include_unverified)

    # --- traversal ------------------------------------------------------------

    def path(self, a: int, b: int) -> dict:
        paths = self.graph.get_shortest_paths(a, to=b, weights="cost", output="vpath")
        vpath = paths[0] if paths else []
        if not vpath or (len(vpath) == 1 and a != b):
            return {"found": False, "nodes": [], "edges": [], "cost": None}
        nodes = [self.brief(i) for i in vpath]
        edges = []
        cost = 0.0
        for u, w in zip(vpath, vpath[1:]):
            eid = self.graph.get_eid(u, w)
            sim = float(self.graph.es[eid]["sim"])
            edges.append({"source": int(u), "target": int(w), "sim": sim})
            cost += 1.0 - sim
        return {"found": True, "nodes": nodes, "edges": edges, "cost": cost, "hops": len(edges)}

    def walk(self, start: int, steps: int = 6, temperature: float = 1.0, avoid_cluster: bool = False, include_unverified: bool = False, seed: int | None = None) -> dict:
        """
        Serendipity walk. Each step samples a neighbour with probability
        proportional to exp(sim / temperature): low temperature hugs the closest
        strands, high temperature wanders. `avoid_cluster` pushes the walk out of
        the starting verb's own region, which is where the surprising analogies
        live.
        """
        rng = random.Random(seed)
        start_cluster = int(self.nodes.iat[start, self.nodes.columns.get_loc("cluster_id")])
        visited = [start]
        trail_edges = []
        current = start
        for _ in range(steps):
            cands = [n for n in self.neighbours(current, None, include_unverified=include_unverified) if n["id"] not in visited]
            if not cands:
                break
            weights = []
            for c in cands:
                w = math.exp(c["sim"] / max(temperature, 1e-3))
                if avoid_cluster and c["cluster_id"] == start_cluster:
                    w *= 0.15
                weights.append(w)
            nxt = rng.choices(cands, weights=weights, k=1)[0]
            trail_edges.append({"source": current, "target": nxt["id"], "sim": nxt["sim"]})
            visited.append(nxt["id"])
            current = nxt["id"]
        return {
            "nodes": [self.brief(i) for i in visited],
            "edges": trail_edges,
            "start": start,
            "end": current,
            "end_similarity_to_start": self.similarity(start, current) if current != start else 1.0,
        }

    def random_verb(self, include_unverified: bool = False, min_zipf: float = 3.0) -> dict:
        pool = self.nodes[(self.nodes["zipf_frequency"] >= min_zipf)]
        if not include_unverified:
            pool = pool[~pool["unverified"]]
        if len(pool) == 0:
            pool = self.nodes
        return self.node(int(pool.sample(1).iloc[0]["id"]))

    # --- clusters and the map ---------------------------------------------------

    def cluster_list(self) -> list[dict]:
        return [
            {
                "cluster_id": int(r["cluster_id"]),
                "name": r["name"],
                "size": int(r["size"]),
                "top_verbs": list(r["top_verbs"]),
                "cx": float(r["cx"]),
                "cy": float(r["cy"]),
                "name_source": r["name_source"],
            }
            for r in self.clusters.to_dict("records")
        ]

    def cluster_members(self, cid: int, limit: int = 500, include_unverified: bool = False) -> list[dict]:
        m = self.nodes[self.nodes["cluster_id"] == cid]
        if not include_unverified:
            m = m[~m["unverified"]]
        m = m.sort_values("pagerank", ascending=False).head(limit)
        return [self.brief(int(i)) for i in m["id"]]

    def map_points(self, include_unverified: bool = False) -> dict:
        m = self.nodes if include_unverified else self.nodes[~self.nodes["unverified"]]
        return {
            "ids": m["id"].astype(int).tolist(),
            "lemmas": m["lemma"].tolist(),
            "x": [round(float(v), 3) for v in m["x"]],
            "y": [round(float(v), 3) for v in m["y"]],
            "cluster": m["cluster_id"].astype(int).tolist(),
            "size": [round(float(v), 2) for v in m["size"]],
            "zipf": [round(float(v), 2) for v in m["zipf_frequency"]],
        }

    def subgraph(self, ids: list[int]) -> dict:
        shown = set(ids)
        nodes = [self.node(i) for i in ids]
        edges = []
        for a in ids:
            s, e = self.csr_ptr[a], self.csr_ptr[a + 1]
            for j, sim in zip(self.csr_dst[s:e], self.csr_sim[s:e]):
                if int(j) in shown and int(j) > a:
                    edges.append({"source": a, "target": int(j), "sim": float(sim)})
        return {"nodes": nodes, "edges": edges}
