"""
Inspider Web Visualizer - API.

    uvicorn backend.app:app --reload --port 8000

Every endpoint is read-only over the built data. There is no auth: this runs on a
dev machine, bound to localhost, per the brief.
"""
from __future__ import annotations

import csv
import io
import os
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import PlainTextResponse, Response
from pydantic import BaseModel, Field

from .store import WebStore

REPO_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(REPO_ROOT / ".env")

FRONTEND_PORT = os.environ.get("FRONTEND_PORT", "5174")


def _data_dir() -> Path:
    raw = (os.environ.get("DATA_DIR") or "data").strip()
    path = Path(raw)
    return path if path.is_absolute() else REPO_ROOT / path


def _cors_origins() -> list[str]:
    origins = [
        f"http://localhost:{FRONTEND_PORT}",
        f"http://127.0.0.1:{FRONTEND_PORT}",
    ]
    extra = os.environ.get("CORS_ORIGINS", "")
    origins.extend(origin.strip().rstrip("/") for origin in extra.split(",") if origin.strip())
    return origins


DATA_DIR = _data_dir()

store: WebStore | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global store
    if not (DATA_DIR / "nodes.parquet").exists():
        raise SystemExit(
            f"No built data in {DATA_DIR}. Run `python -m pipeline.build` first "
            "(or `run.ps1` / `run.sh`, which does it for you)."
        )
    store = WebStore(DATA_DIR)
    m = store.meta()
    print(f"[inspider] {m.verbs:,} verbs · {m.edges:,} edges · {m.clusters} clusters · {m.provider}/{m.model}")
    if m.provider == "dev":
        print("[inspider] WARNING: dev pseudo-embeddings loaded. Neighbours are NOT meaningful.")
    yield


app = FastAPI(title="Inspider Web Visualizer", version="1.0.0", lifespan=lifespan)
app.add_middleware(GZipMiddleware, minimum_size=2048)
_cors_kwargs = {
    "allow_origins": _cors_origins(),
    "allow_methods": ["*"],
    "allow_headers": ["*"],
}
_cors_regex = (os.environ.get("CORS_ORIGIN_REGEX") or "").strip()
if _cors_regex:
    _cors_kwargs["allow_origin_regex"] = _cors_regex
app.add_middleware(CORSMiddleware, **_cors_kwargs)


def S() -> WebStore:
    if store is None:
        raise HTTPException(503, "Store not loaded.")
    return store


def resolve_or_404(term: str) -> int:
    i = S().resolve(term)
    if i is None:
        raise HTTPException(404, f"No verb matching {term!r}.")
    return i


# --- meta ----------------------------------------------------------------------

@app.get("/api/health")
def health():
    return {"ok": store is not None}


@app.get("/api/meta")
def meta():
    m = S().meta()
    return {
        "verbs": m.verbs,
        "edges": m.edges,
        "clusters": m.clusters,
        "k": m.k,
        "provider": m.provider,
        "model": m.model,
        "dimensions": m.dimensions,
        "dev_embeddings": m.provider == "dev",
        "sim_convention": "cosine similarity, 1 = identical",
        "provenance": m.provenance,
    }


# --- search and lookup --------------------------------------------------------------

@app.get("/api/search")
def search(q: str = Query(..., min_length=1), limit: int = 12, unverified: bool = False):
    return {"results": S().search(q, limit=limit, include_unverified=unverified)}


@app.get("/api/verbs/random")
def random_verb(unverified: bool = False):
    return S().random_verb(include_unverified=unverified)


@app.get("/api/verbs/{term}")
def verb(term: str):
    return S().node(resolve_or_404(term))


@app.get("/api/verbs/{term}/neighbours")
def neighbours(term: str, k: int = 50, min_sim: float = -1.0, unverified: bool = False):
    i = resolve_or_404(term)
    return {"center": S().node(i), "neighbours": S().neighbours(i, k, min_sim, unverified)}


@app.get("/api/ego")
def ego(term: str, k: int = 20, depth: int = 1, min_sim: float = -1.0, unverified: bool = False):
    i = resolve_or_404(term)
    return S().ego(i, k=max(1, min(k, 100)), depth=depth, min_sim=min_sim, include_unverified=unverified)


# --- pairs and vectors -------------------------------------------------------------

@app.get("/api/compare")
def compare(a: str, b: str, k: int = 50):
    return S().compare(resolve_or_404(a), resolve_or_404(b), k=k)


@app.get("/api/similarity")
def similarity(a: str, b: str):
    ia, ib = resolve_or_404(a), resolve_or_404(b)
    return {"a": S().lemmas[ia], "b": S().lemmas[ib], "similarity": S().similarity(ia, ib)}


class AnalogyBody(BaseModel):
    positive: list[str] = Field(default_factory=list)
    negative: list[str] = Field(default_factory=list)
    k: int = 10
    unverified: bool = False


@app.post("/api/analogy")
def analogy(body: AnalogyBody):
    if not body.positive:
        raise HTTPException(400, "At least one positive verb is required.")
    pos = [resolve_or_404(t) for t in body.positive]
    neg = [resolve_or_404(t) for t in body.negative]
    try:
        return {
            "positive": [S().lemmas[i] for i in pos],
            "negative": [S().lemmas[i] for i in neg],
            "results": S().analogy(pos, neg, k=body.k, include_unverified=body.unverified),
        }
    except RuntimeError as e:
        raise HTTPException(503, str(e))


# --- traversal ----------------------------------------------------------------------

@app.get("/api/path")
def path(a: str = Query(..., alias="from"), b: str = Query(..., alias="to")):
    return S().path(resolve_or_404(a), resolve_or_404(b))


@app.get("/api/walk")
def walk(start: str, steps: int = 6, temperature: float = 0.5, avoid_cluster: bool = True, unverified: bool = False, seed: int | None = None):
    return S().walk(
        resolve_or_404(start),
        steps=max(1, min(steps, 30)),
        temperature=max(0.05, min(temperature, 5.0)),
        avoid_cluster=avoid_cluster,
        include_unverified=unverified,
        seed=seed,
    )


# --- clusters and the map --------------------------------------------------------------

@app.get("/api/clusters")
def clusters():
    return {"clusters": S().cluster_list()}


@app.get("/api/clusters/{cid}")
def cluster(cid: int, limit: int = 300, unverified: bool = False):
    rows = [c for c in S().cluster_list() if c["cluster_id"] == cid]
    if not rows:
        raise HTTPException(404, "No such cluster.")
    return {**rows[0], "members": S().cluster_members(cid, limit=limit, include_unverified=unverified)}


@app.get("/api/map")
def map_points(unverified: bool = False):
    return S().map_points(include_unverified=unverified)


# --- export ---------------------------------------------------------------------------

@app.get("/api/export/subgraph")
def export_subgraph(ids: str, format: str = "json"):
    try:
        id_list = [int(x) for x in ids.split(",") if x.strip()]
    except ValueError:
        raise HTTPException(400, "ids must be comma-separated integers.")
    id_list = [i for i in id_list if 0 <= i < S().n]
    if not id_list:
        raise HTTPException(400, "No valid ids.")
    sg = S().subgraph(id_list)

    if format == "json":
        return sg

    if format == "csv":
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["source", "source_lemma", "target", "target_lemma", "similarity"])
        lem = S().lemmas
        for e in sg["edges"]:
            w.writerow([e["source"], lem[e["source"]], e["target"], lem[e["target"]], f"{e['sim']:.4f}"])
        return PlainTextResponse(buf.getvalue(), media_type="text/csv",
                                 headers={"Content-Disposition": "attachment; filename=inspider-subgraph.csv"})

    if format == "graphml":
        import networkx as nx

        g = nx.Graph()
        for n in sg["nodes"]:
            g.add_node(n["id"], label=n["lemma"], cluster=n["cluster_id"], gloss=n["gloss"] or "")
        for e in sg["edges"]:
            g.add_edge(e["source"], e["target"], weight=e["sim"])
        buf = io.BytesIO()
        nx.write_graphml(g, buf)
        return Response(buf.getvalue(), media_type="application/xml",
                        headers={"Content-Disposition": "attachment; filename=inspider-subgraph.graphml"})

    raise HTTPException(400, "format must be json, csv or graphml.")
