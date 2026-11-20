"""
VITIS - Verb-Inspired Traversal from Issues to Solutions.

    uvicorn app.main:app --reload --port 8010     (from backend/)
"""
from __future__ import annotations

import threading
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse

from .config import config
from .db import Base, engine, ensure_columns, session_scope
from .models import Experimenter  # noqa: F401  (ensures models are registered)
from .routers import admin, study
from .seed import ensure_accounts
from .services import inspider
from .services.auth import current_experimenter, current_participant


def _boot_inspider() -> None:
    """Import the web off the startup path so /api/health can pass on Railway."""
    with session_scope() as db:
        if not inspider.is_imported(db):
            try:
                meta = inspider.import_web(db)
                print(f"[vitis] imported Inspider web: {meta.get('verbs'):,} verbs, {meta.get('edges'):,} edges ({meta.get('model')})")
            except Exception as e:
                print(f"[vitis] WARNING: Inspider web not imported: {e}")
                print("[vitis]          The Inspider condition will fail until INSPIDER_DATA_DIR points at a real build.")
        else:
            st = inspider.web_stats(db)
            print(f"[vitis] Inspider web: {st['verbs']:,} verbs, {st['phenomena']:,} phenomena appended so far")


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(engine)
    ensure_columns()
    ensure_accounts()
    threading.Thread(target=_boot_inspider, name="inspider-import", daemon=True).start()
    print(f"[vitis] provider={config.ai_provider} model={config.anthropic_model} images={config.image_model}")
    if config.mock:
        print("[vitis] WARNING: AI_PROVIDER=mock - canned output. Never run a real participant like this.")
    yield


app = FastAPI(title="VITIS", version="1.0.0", lifespan=lifespan)
app.add_middleware(GZipMiddleware, minimum_size=2048)
app.add_middleware(CORSMiddleware, allow_origins=config.cors_origins, allow_methods=["*"], allow_headers=["*"])
app.include_router(study.router)
app.include_router(admin.router)


@app.get("/api/health")
def health():
    return {"ok": True, "provider": config.ai_provider}


def _image_path(rel: str) -> Path:
    p = (config.image_dir / rel).resolve()
    if config.image_dir.resolve() not in p.parents or not p.exists():
        raise HTTPException(404, "No such image.")
    return p


@app.get("/api/images/{session_id}/{filename}")
def image(session_id: int, filename: str, t: str = ""):
    """
    Renders are participant data. <img> cannot send a bearer header, so the
    token travels as ?t=. Valid for the session's own participant, or for any
    experimenter.
    """
    from sqlalchemy import select
    from .db import SessionLocal, now_iso
    from .models import ExperimenterToken, ParticipantToken, StudySession
    from .services.auth import _hash_token

    if not t:
        raise HTTPException(401, "Token required.")
    with SessionLocal() as db:
        h = _hash_token(t)
        ok = db.scalar(select(ExperimenterToken.id).where(ExperimenterToken.token_hash == h, ExperimenterToken.revoked_at.is_(None), ExperimenterToken.expires_at > now_iso()))
        if not ok:
            pt = db.scalar(select(ParticipantToken).where(ParticipantToken.token_hash == h, ParticipantToken.revoked_at.is_(None), ParticipantToken.expires_at > now_iso()))
            s = db.get(StudySession, session_id)
            ok = pt is not None and s is not None and s.participant_id == pt.participant_id
        if not ok:
            raise HTTPException(403, "Not permitted.")
    return FileResponse(_image_path(f"{session_id}/{filename}"), media_type="image/png")
