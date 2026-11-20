"""
The Inspider web inside VITIS.

Imported once from inspider-web-KG-app/data into VITIS's own database, so the
deployed backend needs nothing from the other project at runtime. The verb
vectors stay in an .npz next to the database (they are 130 MB and only used
for two things: resolving an unknown keyword, and placing new phenomenon nodes).

Phenomena appended by participants become nodes of type "phenomenon", linked to
their verb with an edge of type "phenomenon" and embedded with the same model
as the web, so the web genuinely grows.
"""
from __future__ import annotations

import json
import shutil
from pathlib import Path

import numpy as np
import pandas as pd
from rapidfuzz import process
from rapidfuzz.distance import DamerauLevenshtein
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..config import config
from ..models import InspiderEdge, InspiderMeta, InspiderNode, Phenomenon
from .ai import embed_texts

VECTORS_FILE = "inspider_vectors.npz"


def vectors_path() -> Path:
    return config.image_dir.parent / VECTORS_FILE


# --- import -----------------------------------------------------------------------

def is_imported(db: Session) -> bool:
    return db.get(InspiderMeta, "import") is not None


def import_web(db: Session, source_dir: Path | None = None, force: bool = False) -> dict:
    src = Path(source_dir or config.inspider_data_dir)
    prov_path = src / "provenance.json"
    if not (src / "nodes.parquet").exists() or not prov_path.exists():
        raise FileNotFoundError(
            f"No built Inspider web at {src}. Build it with inspider-web-KG-app/run.ps1 first, "
            "or point INSPIDER_DATA_DIR at the data folder."
        )
    prov = json.loads(prov_path.read_text(encoding="utf-8"))
    embed = prov.get("stages", {}).get("03_embed", {})
    if embed.get("provider") != "openai":
        raise RuntimeError(
            f"The Inspider web at {src} was built with provider={embed.get('provider')!r}, not real embeddings. "
            "VITIS refuses to import a dev build: its neighbours are meaningless. Rebuild with an OpenAI key."
        )

    if is_imported(db) and not force:
        return {"skipped": True}

    # `force`, or a half-finished import (nodes present, no meta row): start clean.
    if force or db.scalar(select(func.count()).select_from(InspiderNode)):
        db.query(Phenomenon).delete()
        db.query(InspiderEdge).delete()
        db.query(InspiderNode).delete()
        db.query(InspiderMeta).delete()
        db.commit()

    nodes = pd.read_parquet(src / "nodes.parquet")
    edges = pd.read_parquet(src / "edges.parquet")
    clusters = pd.read_parquet(src / "clusters.parquet")
    cname = dict(zip(clusters["cluster_id"], clusters["name"]))

    db.bulk_insert_mappings(InspiderNode, [
        {
            "id": int(r.id), "lemma": r.lemma, "node_type": "verb",
            "gloss": r.gloss if isinstance(r.gloss, str) else None,
            "forms": list(r.forms) if r.forms is not None else [],
            "cluster_id": int(r.cluster_id), "cluster_name": cname.get(int(r.cluster_id)),
            "zipf": float(r.zipf_frequency), "unverified": bool(r.unverified),
            "x": float(r.x), "y": float(r.y), "in_degree": int(r.in_degree), "phenomenon_count": 0,
        }
        for r in nodes.itertuples()
    ])
    db.commit()
    # Commit per chunk: a million edges in one transaction holds SQLite's write
    # lock for longer than busy_timeout, and a login during boot would fail.
    # The meta row is written last, so is_imported() stays false until all of it is in.
    chunk = 100_000
    for i in range(0, len(edges), chunk):
        part = edges.iloc[i : i + chunk]
        db.bulk_insert_mappings(InspiderEdge, [
            {"src": int(r.src), "dst": int(r.dst), "sim": float(r.sim), "rank": int(r.rank), "edge_type": "similarity"}
            for r in part.itertuples()
        ])
        db.commit()

    # vectors: copied next to the database, loaded lazily
    vectors_path().parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(src / "embeddings.npz", vectors_path())

    meta = {
        "source_dir": str(src), "verbs": int(len(nodes)), "edges": int(len(edges)), "clusters": int(len(clusters)),
        "model": embed.get("model"), "dimensions": embed.get("dimensions"), "k": prov["stages"].get("04_knn", {}).get("k"),
        "inspider_provenance": prov,
    }
    db.add(InspiderMeta(key="import", value=meta))
    db.flush()
    _cache.clear()
    return meta


# --- vectors ----------------------------------------------------------------------------

_cache: dict = {}


def _looks_like_npz(path: Path) -> bool:
    """Real .npz is a zip. Git LFS pointers start with 'version ' and are a few hundred bytes."""
    try:
        if not path.is_file() or path.stat().st_size < 1024:
            return False
        with path.open("rb") as f:
            return f.read(2) == b"PK"
    except OSError:
        return False


def _vectors() -> tuple[np.ndarray, np.ndarray]:
    """(ids int32[N], vectors float16[N, D]) - kept as float16 to fit comfortably in RAM."""
    if "vec" not in _cache:
        path = vectors_path()
        src = config.inspider_data_dir / "embeddings.npz"
        if not _looks_like_npz(path) and _looks_like_npz(src):
            path = src
        if not _looks_like_npz(path):
            raise FileNotFoundError(f"No embeddings.npz at {vectors_path()} or {src}")
        z = np.load(path, allow_pickle=False)
        _cache["vec"] = (z["ids"].astype(np.int32), z["vectors"].astype(np.float16))
    return _cache["vec"]


def verb_vector(node_id: int) -> np.ndarray | None:
    try:
        ids, vecs = _vectors()
    except Exception:
        return None
    idx = np.searchsorted(ids, node_id)
    if idx < len(ids) and ids[idx] == node_id:
        return vecs[idx].astype(np.float32)
    return None


# --- lookup -------------------------------------------------------------------------------

def node_by_lemma(db: Session, lemma: str) -> InspiderNode | None:
    return db.scalar(select(InspiderNode).where(InspiderNode.lemma == lemma.strip().lower(), InspiderNode.node_type == "verb"))


def resolve_keyword(db: Session, text: str, session_id: int | None = None, stage: str = "keywords") -> dict:
    """
    Maps a proposed keyword to a verb node. Tries, in order: exact lemma, a
    known inflected form, close spelling, then embedding nearest-neighbour.
    Records which method won and how confident it was.
    """
    t = text.strip().lower()
    node = node_by_lemma(db, t)
    if node:
        return {"node": node, "method": "exact", "score": 1.0}

    # forms are stored per node as JSON; scan is fine at 23k rows, cached after first call
    if "forms" not in _cache:
        rows = db.execute(select(InspiderNode.id, InspiderNode.lemma, InspiderNode.forms, InspiderNode.unverified).where(InspiderNode.node_type == "verb")).all()
        form_map = {}
        for nid, lemma, forms, unverified in rows:
            for f in forms or []:
                form_map.setdefault(f, nid)
        _cache["forms"] = form_map
        _cache["lemmas"] = [(nid, lemma) for nid, lemma, _f, unv in rows if not unv]
    if t in _cache["forms"]:
        return {"node": db.get(InspiderNode, _cache["forms"][t]), "method": "form", "score": 0.98}

    choices = [l for _nid, l in _cache["lemmas"]]
    match = process.extractOne(t, choices, scorer=DamerauLevenshtein.normalized_similarity)
    if match and match[1] >= 0.85:
        nid = _cache["lemmas"][match[2]][0]
        return {"node": db.get(InspiderNode, nid), "method": "fuzzy", "score": float(match[1])}

    # embedding: nearest verb in the web to the keyword itself
    try:
        v = embed_texts(db, session_id, stage, [f"{t} (verb)"])[0]
        ids, vecs = _vectors()
        scores = vecs.astype(np.float32) @ v
        best = int(np.argmax(scores))
        node = db.get(InspiderNode, int(ids[best]))
        return {"node": node, "method": "embedding", "score": float(scores[best])}
    except Exception:
        return {"node": None, "method": "none", "score": 0.0}


def _spelling_variant(a: str, b: str) -> bool:
    """`magnetize`/`magnetise`, `illuminate`/`illumine`: the same verb spelled
    differently, not a neighbour worth a searched phenomena call."""
    a, b = a.lower(), b.lower()
    if a == b:
        return True
    for x, y in ((a, b), (b, a)):
        for suf_a, suf_b in (("ize", "ise"), ("yze", "yse"), ("ise", "ize"), ("yse", "yze"), ("our", "or"), ("or", "our"), ("ll", "l"), ("l", "ll")):
            if x.endswith(suf_a) and y.endswith(suf_b) and x[: -len(suf_a)] == y[: -len(suf_b)]:
                return True
    # one edit apart and sharing a long stem (illumine / illuminate share 'illumin')
    if abs(len(a) - len(b)) <= 3 and len(a) >= 6 and len(b) >= 6:
        stem = 0
        for ca, cb in zip(a, b):
            if ca != cb:
                break
            stem += 1
        if stem >= min(len(a), len(b)) - 2:
            return True
    return False


def neighbours(db: Session, node_id: int, k: int = 10, include_unverified: bool = False) -> list[dict]:
    centre = db.get(InspiderNode, node_id)
    rows = db.execute(
        select(InspiderEdge.dst, InspiderEdge.sim, InspiderEdge.rank, InspiderNode)
        .join(InspiderNode, InspiderNode.id == InspiderEdge.dst)
        .where(InspiderEdge.src == node_id, InspiderEdge.edge_type == "similarity")
        .order_by(InspiderEdge.rank)
    ).all()
    out = []
    for dst, sim, rank, n in rows:
        if not include_unverified and n.unverified:
            continue
        if centre is not None and _spelling_variant(centre.lemma, n.lemma):
            continue
        out.append({"node_id": int(dst), "lemma": n.lemma, "gloss": n.gloss, "sim": float(sim), "rank": int(rank), "cluster_name": n.cluster_name, "phenomenon_count": n.phenomenon_count})
        if len(out) >= k:
            break
    return out


def ego(db: Session, node_id: int, k: int = 20) -> dict:
    """The web around a verb, with its phenomena, for the console's web view."""
    centre = db.get(InspiderNode, node_id)
    nbrs = neighbours(db, node_id, k, include_unverified=True)
    phen = db.scalars(select(Phenomenon).where(Phenomenon.node_id == node_id)).all()
    return {
        "center": {"node_id": centre.id, "lemma": centre.lemma, "gloss": centre.gloss, "cluster_name": centre.cluster_name},
        "neighbours": nbrs,
        "phenomena": [{"id": p.id, "title": p.title, "domain": p.domain, "source_url": p.source_url, "created_by_session": p.created_by_session} for p in phen],
    }


# --- phenomena -------------------------------------------------------------------------------

def existing_phenomena(db: Session, node_id: int) -> list[Phenomenon]:
    return db.scalars(select(Phenomenon).where(Phenomenon.node_id == node_id).order_by(Phenomenon.id)).all()


def append_phenomena(db: Session, session_id: int, node: InspiderNode, keyword_text: str, items: list[dict]) -> list[Phenomenon]:
    """Adds phenomena as nodes + edges and embeds them. The web grows here."""
    if not items:
        return []
    texts = [f"{p['title']}: {p['description']}" for p in items]
    try:
        vecs = embed_texts(db, session_id, "phenomena", texts)
    except Exception:
        vecs = None  # embedding is best-effort; the phenomenon is still stored

    created = []
    for i, p in enumerate(items):
        ph = Phenomenon(
            node_id=node.id, keyword_text=keyword_text, title=p["title"], description=p["description"],
            domain=p.get("domain"), source_url=p.get("source_url"), source_title=p.get("source_title"),
            embedding=(vecs[i].astype(np.float16).tobytes() if vecs is not None else None),
            created_by_session=session_id,
        )
        db.add(ph)
        db.flush()
        # A phenomenon is also a node in the web, hanging off its verb.
        pn = InspiderNode(lemma=f"phenomenon:{ph.id}", node_type="phenomenon", gloss=ph.title, cluster_id=node.cluster_id, cluster_name=node.cluster_name, x=node.x, y=node.y, unverified=False, phenomenon_count=0)
        db.add(pn)
        db.flush()
        sim = 1.0
        if vecs is not None:
            vv = verb_vector(node.id)
            if vv is not None:
                sim = float(np.dot(vecs[i], vv))
        db.add(InspiderEdge(src=node.id, dst=pn.id, sim=sim, rank=-1, edge_type="phenomenon"))
        created.append(ph)
    node.phenomenon_count = (node.phenomenon_count or 0) + len(created)
    db.flush()
    return created


def web_stats(db: Session) -> dict:
    meta = db.get(InspiderMeta, "import")
    return {
        "imported": meta is not None,
        "import": meta.value if meta else None,
        "verbs": db.scalar(select(func.count()).select_from(InspiderNode).where(InspiderNode.node_type == "verb")),
        "phenomena": db.scalar(select(func.count()).select_from(Phenomenon)),
        "phenomenon_edges": db.scalar(select(func.count()).select_from(InspiderEdge).where(InspiderEdge.edge_type == "phenomenon")),
        "verbs_with_phenomena": db.scalar(select(func.count()).select_from(InspiderNode).where(InspiderNode.phenomenon_count > 0)),
    }
