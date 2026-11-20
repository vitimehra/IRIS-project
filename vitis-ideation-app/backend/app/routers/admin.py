"""Experimenter console API."""
from __future__ import annotations

import csv
import io
import json

from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..config import config
from ..db import get_db
from ..models import (
    AICall, AuditLog, CAEIssue, Concept, Event, Experimenter, Idea, IssueInput, Job, Keyword, Participant,
    ParticipantToken, Phenomenon, Problem, Rating, Render, SessionPhenomenon, StudySession,
)
from ..services import cost, inspider
from ..services import workflow as W
from ..services.auth import audit, condition_order_for, current_experimenter, experimenter_login, new_passcode, next_participant_number, revoke_experimenter

router = APIRouter(prefix="/api/admin", tags=["admin"])


class LoginBody(BaseModel):
    username: str
    password: str


@router.post("/login")
def login(body: LoginBody, db: Session = Depends(get_db)):
    e, token = experimenter_login(db, body.username, body.password)
    db.commit()
    return {"token": token, "user": {"username": e.username, "display_name": e.display_name}}


@router.post("/logout")
def logout(authorization: str | None = Header(default=None), e: Experimenter = Depends(current_experimenter), db: Session = Depends(get_db)):
    revoke_experimenter(db, authorization)
    audit(db, e, "logout")
    db.commit()
    return {"ok": True}


@router.get("/me")
def me(e: Experimenter = Depends(current_experimenter)):
    return {"username": e.username, "display_name": e.display_name}


# --- participants -----------------------------------------------------------------------

class NewParticipant(BaseModel):
    name: str | None = None
    age: int | None = None
    gender: str | None = None
    occupation: str | None = None
    education: str | None = None
    email: str | None = None
    demographics: dict | None = None
    notes: str | None = None
    settings: dict | None = None


def participant_row(db: Session, p: Participant) -> dict:
    s = db.scalar(select(StudySession).where(StudySession.participant_id == p.id).order_by(StudySession.number.desc()))
    return {
        "id": p.id, "number": p.number, "username": p.username, "passcode": p.passcode, "name": p.name, "age": p.age,
        "gender": p.gender, "occupation": p.occupation, "education": p.education, "email": p.email, "demographics": p.demographics,
        "condition_order": p.condition_order, "settings": p.settings, "status": p.status, "notes": p.notes,
        "consented_at": p.consented_at, "created_at": p.created_at, "last_seen_at": p.last_seen_at,
        "session": {"id": s.id, "stage": s.stage, "substage": s.substage, "started_at": s.started_at, "completed_at": s.completed_at} if s else None,
        "counts": {
            "ideas": db.scalar(select(func.count()).select_from(Idea).where(Idea.session_id == s.id)) if s else 0,
            "ratings": db.scalar(select(func.count()).select_from(Rating).where(Rating.session_id == s.id)) if s else 0,
            "ai_calls": db.scalar(select(func.count()).select_from(AICall).where(AICall.session_id == s.id)) if s else 0,
        },
        "cost_usd": cost.session_cost(db, s.id)["total_usd"] if s else 0.0,
    }


@router.get("/participants")
def list_participants(e: Experimenter = Depends(current_experimenter), db: Session = Depends(get_db)):
    rows = db.scalars(select(Participant).order_by(Participant.number)).all()
    return {"participants": [participant_row(db, p) for p in rows]}


@router.post("/participants")
def create_participant(body: NewParticipant, e: Experimenter = Depends(current_experimenter), db: Session = Depends(get_db)):
    number = next_participant_number(db)
    p = Participant(
        number=number, username=f"P{number:02d}", passcode=new_passcode(db), name=body.name, age=body.age, gender=body.gender,
        occupation=body.occupation, education=body.education, email=body.email, demographics=body.demographics,
        condition_order=condition_order_for(number), settings=body.settings, notes=body.notes, created_by=e.id,
    )
    db.add(p)
    db.flush()
    audit(db, e, "participant.create", "participant", p.id, {"username": p.username})
    db.commit()
    return participant_row(db, p)


class UpdateParticipant(BaseModel):
    name: str | None = None
    age: int | None = None
    gender: str | None = None
    occupation: str | None = None
    education: str | None = None
    email: str | None = None
    demographics: dict | None = None
    notes: str | None = None
    settings: dict | None = None
    condition_order: list[str] | None = None
    status: str | None = None


@router.patch("/participants/{pid}")
def update_participant(pid: int, body: UpdateParticipant, e: Experimenter = Depends(current_experimenter), db: Session = Depends(get_db)):
    p = db.get(Participant, pid)
    if not p:
        raise HTTPException(404, "No such participant.")
    changes = {}
    for k, v in body.model_dump(exclude_unset=True).items():
        if k == "condition_order":
            if sorted(v) != ["inspider", "modern", "traditional"] or v[0] != "traditional":
                raise HTTPException(400, "condition_order must contain all three, with traditional first.")
            s = db.scalar(select(StudySession).where(StudySession.participant_id == p.id))
            if s and s.stage not in ("issue", "cae", "problems", "aopc", "traditional"):
                raise HTTPException(409, "Cannot change the order once an automatic condition has run.")
            if s:
                s.condition_order = v
        if k == "status" and v not in ("created", "active", "completed", "withdrawn"):
            raise HTTPException(400, "Bad status.")
        setattr(p, k, v)
        changes[k] = v
    audit(db, e, "participant.update", "participant", p.id, changes)
    db.commit()
    return participant_row(db, p)


@router.post("/participants/{pid}/regenerate-passcode")
def regenerate_passcode(pid: int, e: Experimenter = Depends(current_experimenter), db: Session = Depends(get_db)):
    p = db.get(Participant, pid)
    if not p:
        raise HTTPException(404, "No such participant.")
    p.passcode = new_passcode(db)
    audit(db, e, "participant.passcode", "participant", p.id)
    db.commit()
    return participant_row(db, p)


class DeleteParticipantBody(BaseModel):
    username: str


def _unlink_render(r: Render) -> int:
    if not r.file_path:
        return 0
    root = config.image_dir.resolve()
    path = (config.image_dir / r.file_path).resolve()
    try:
        if path.is_file() and (path == root or root in path.parents):
            path.unlink()
            return 1
    except OSError:
        pass
    return 0


@router.delete("/participants/{pid}")
def delete_participant(pid: int, body: DeleteParticipantBody, e: Experimenter = Depends(current_experimenter), db: Session = Depends(get_db)):
    """Hard-delete the participant and their study data at any status. Phenomena they added to the web stay."""
    p = db.get(Participant, pid)
    if not p:
        raise HTTPException(404, "No such participant.")
    if body.username.strip().upper() != p.username.upper():
        raise HTTPException(400, "Type the participant code exactly to confirm deletion.")
    files = 0
    for s in db.scalars(select(StudySession).where(StudySession.participant_id == p.id)).all():
        for r in db.scalars(select(Render).where(Render.session_id == s.id)).all():
            files += _unlink_render(r)
        for ph in db.scalars(select(Phenomenon).where(Phenomenon.created_by_session == s.id)).all():
            ph.created_by_session = None
        db.delete(s)
    for t in db.scalars(select(ParticipantToken).where(ParticipantToken.participant_id == p.id)).all():
        db.delete(t)
    username, status = p.username, p.status
    db.delete(p)
    audit(db, e, "participant.delete", "participant", pid, {"username": username, "status": status, "render_files_removed": files})
    db.commit()
    return {"deleted": True, "username": username, "status": status}


# --- full participant record ------------------------------------------------------------------------

@router.post("/participants/{pid}/retry-generation")
def retry_generation(pid: int, e: Experimenter = Depends(current_experimenter), db: Session = Depends(get_db)):
    """Re-queue any errored background job (phenomena, concepts, renders) for the participant's session."""
    from ..services import workflow as W

    p = db.get(Participant, pid)
    if not p:
        raise HTTPException(404, "No such participant.")
    s = db.scalar(select(StudySession).where(StudySession.participant_id == p.id).order_by(StudySession.number.desc()))
    if not s:
        raise HTTPException(409, "No session yet.")
    kinds = W.retry_failed_jobs(db, s)
    audit(db, e, "participant.retry_generation", "participant", p.id, {"kinds": kinds})
    db.commit()
    W.kick_jobs(s.id)
    return {"retried": kinds}


@router.post("/participants/{pid}/requeue-renders")
def requeue_renders(pid: int, e: Experimenter = Depends(current_experimenter), db: Session = Depends(get_db)):
    """Regenerate renders that failed inside a finished job, and reopen the render rating stage if the participant was moved past it."""
    p = db.get(Participant, pid)
    if not p:
        raise HTTPException(404, "No such participant.")
    s = db.scalar(select(StudySession).where(StudySession.participant_id == p.id).order_by(StudySession.number.desc()))
    if not s:
        raise HTTPException(409, "No session yet.")
    try:
        out = W.requeue_failed_renders(db, s)
    except W.WorkflowError as err:
        raise HTTPException(err.status, str(err))
    audit(db, e, "participant.requeue_renders", "participant", p.id, out)
    db.commit()
    W.kick_jobs(s.id)
    return out


@router.get("/participants/{pid}/full")
def participant_full(pid: int, e: Experimenter = Depends(current_experimenter), db: Session = Depends(get_db)):
    p = db.get(Participant, pid)
    if not p:
        raise HTTPException(404, "No such participant.")
    audit(db, e, "participant.view", "participant", p.id)
    db.commit()
    sessions = db.scalars(select(StudySession).where(StudySession.participant_id == p.id).order_by(StudySession.number)).all()
    return {"participant": participant_row(db, p), "sessions": [session_full(db, s) for s in sessions]}


def session_full(db: Session, s: StudySession) -> dict:
    ideas = db.scalars(select(Idea).where(Idea.session_id == s.id).order_by(Idea.condition, Idea.ordinal)).all()
    concepts = db.scalars(select(Concept).where(Concept.session_id == s.id).order_by(Concept.id)).all()
    renders = db.scalars(select(Render).where(Render.session_id == s.id)).all()
    ratings = db.scalars(select(Rating).where(Rating.session_id == s.id)).all()
    kws = db.scalars(select(Keyword).where(Keyword.session_id == s.id).order_by(Keyword.id)).all()
    sph = db.execute(select(SessionPhenomenon, Phenomenon).join(Phenomenon, Phenomenon.id == SessionPhenomenon.phenomenon_id).where(SessionPhenomenon.session_id == s.id)).all()
    rating_by = {(r.target_type, r.target_id): r for r in ratings}
    idea_cond = {i.id: i.condition for i in ideas}
    concept_idea = {c.id: c.idea_id for c in concepts}

    def rating_of(t, i):
        r = rating_by.get((t, i))
        return {"novelty": r.novelty, "usefulness": r.usefulness, "feasibility": r.feasibility, "comment": r.comment, "display_order": r.display_order, "response_ms": r.response_ms} if r else None

    # per-condition summary: the headline result
    summary = {}
    for cond in ("traditional", "modern", "inspider"):
        for t in ("idea", "concept", "render"):
            vals = []
            for r in ratings:
                if r.target_type != t:
                    continue
                cond_of = idea_cond.get(r.target_id) if t == "idea" else idea_cond.get(concept_idea.get(r.target_id))
                if cond_of == cond:
                    vals.append(r)
            if vals:
                summary.setdefault(cond, {})[t] = {
                    "n": len(vals),
                    "novelty": round(sum(r.novelty for r in vals) / len(vals), 2),
                    "usefulness": round(sum(r.usefulness for r in vals) / len(vals), 2),
                    "feasibility": round(sum(r.feasibility for r in vals) / len(vals), 2),
                }

    return {
        "session": {"id": s.id, "number": s.number, "stage": s.stage, "substage": s.substage, "condition_order": s.condition_order, "settings": s.settings, "started_at": s.started_at, "completed_at": s.completed_at, "stage_timings": s.stage_timings, "shuffle_seed": s.shuffle_seed},
        "issue_inputs": [{"id": r.id, "text": r.text, "input_mode": r.input_mode, "duration_ms": r.duration_ms, "created_at": r.created_at} for r in db.scalars(select(IssueInput).where(IssueInput.session_id == s.id))],
        "cae_issues": [{"id": r.id, "ordinal": r.ordinal, "headline": r.headline, "cause": r.cause, "affect": r.affect, "effect": r.effect, "evidence": r.evidence, "ai_version": r.ai_version, "edited": r.edited, "confirmed": r.confirmed} for r in db.scalars(select(CAEIssue).where(CAEIssue.session_id == s.id).order_by(CAEIssue.ordinal))],
        "problems": [{"id": r.id, "ordinal": r.ordinal, "statement": r.statement, "rationale": r.rationale, "selected": r.selected, "action": r.action, "object": r.object, "party": r.party, "context": r.context, "aopc_ai_version": r.aopc_ai_version, "aopc_edited": r.aopc_edited} for r in db.scalars(select(Problem).where(Problem.session_id == s.id).order_by(Problem.ordinal))],
        "keywords": [{"id": k.id, "text": k.text, "source": k.source, "rationale": k.rationale, "resolved_lemma": k.resolved_lemma, "resolution": k.resolution, "resolution_score": k.resolution_score, "parent_keyword_id": k.parent_keyword_id, "similarity_to_parent": k.similarity_to_parent, "selected": k.selected, "final": k.final, "node_id": k.node_id} for k in kws],
        "phenomena": [{"keyword_id": sp.keyword_id, "fresh": sp.fresh, "id": ph.id, "title": ph.title, "description": ph.description, "domain": ph.domain, "source_url": ph.source_url, "source_title": ph.source_title, "created_by_session": ph.created_by_session} for sp, ph in sph],
        "ideas": [{"id": i.id, "condition": i.condition, "ordinal": i.ordinal, "title": i.title, "raw_text": i.raw_text, "principle": i.principle, "phenomenon": i.phenomenon, "inspired_by": i.inspired_by, "rating": rating_of("idea", i.id)} for i in ideas],
        "concepts": [{"id": c.id, "idea_id": c.idea_id, "condition": idea_cond.get(c.idea_id), "title": c.title, "object": c.object, "characteristics": c.characteristics, "how_it_works": c.how_it_works, "rating": rating_of("concept", c.id), "render_rating": rating_of("render", c.id), "renders": [{"id": r.id, "kind": r.kind, "prompt": r.prompt, "status": r.status, "error": r.error, "url": f"/api/images/{r.file_path}" if r.file_path else None, "model": r.model} for r in renders if r.concept_id == c.id]} for c in concepts],
        "summary": summary,
        "cost": cost.session_cost(db, s.id),
        "jobs": {j.kind: {"status": j.status, "progress": j.progress, "total": j.total, "error": j.error} for j in db.scalars(select(Job).where(Job.session_id == s.id))},
        "transcript": [{"id": ev.id, "stage": ev.stage, "actor": ev.actor, "kind": ev.kind, "payload": ev.payload, "created_at": ev.created_at} for ev in db.scalars(select(Event).where(Event.session_id == s.id).order_by(Event.id))],
        "ai_calls": [{"id": c.id, "stage": c.stage, "purpose": c.purpose, "provider": c.provider, "model": c.model, "status": c.status, "error": c.error, "input_tokens": c.input_tokens, "output_tokens": c.output_tokens, "latency_ms": c.latency_ms, "created_at": c.created_at, "request": c.request, "response": c.response} for c in db.scalars(select(AICall).where(AICall.session_id == s.id).order_by(AICall.id))],
    }


# --- overview, web, audit, export ---------------------------------------------------------------------------

@router.get("/overview")
def overview(e: Experimenter = Depends(current_experimenter), db: Session = Depends(get_db)):
    parts = db.scalars(select(Participant)).all()
    by_status = {}
    for p in parts:
        by_status[p.status] = by_status.get(p.status, 0) + 1
    tokens_in = db.scalar(select(func.coalesce(func.sum(AICall.input_tokens), 0)))
    tokens_out = db.scalar(select(func.coalesce(func.sum(AICall.output_tokens), 0)))
    spend = cost.summarise(db.scalars(select(AICall)).all())
    # Average over finished participants only, so half-run sessions do not drag it down.
    completed_costs = [
        cost.session_cost(db, sid)["total_usd"]
        for sid in db.scalars(select(StudySession.id).join(Participant, Participant.id == StudySession.participant_id).where(Participant.status == "completed"))
    ]
    return {
        "cost": {"total_usd": spend["total_usd"], "by_stage": spend["by_stage"], "by_model": spend["by_model"],
                 "per_completed_participant_usd": round(sum(completed_costs) / len(completed_costs), 2) if completed_costs else None,
                 "max_completed_participant_usd": round(max(completed_costs), 2) if completed_costs else None},
        "participants": len(parts), "by_status": by_status,
        "ideas": db.scalar(select(func.count()).select_from(Idea)), "ratings": db.scalar(select(func.count()).select_from(Rating)),
        "renders": db.scalar(select(func.count()).select_from(Render).where(Render.status == "ok")),
        "ai_calls": db.scalar(select(func.count()).select_from(AICall)), "tokens": {"input": tokens_in, "output": tokens_out},
        "provider": config.ai_provider, "model": config.anthropic_model, "model_fast": config.anthropic_model_fast,
        "creative_purposes": sorted(config.creative_purposes), "web_search_max_uses": config.web_search_max_uses,
        "image_model": config.image_model, "image_quality": {"product": config.image_quality_product, "in_use": config.image_quality_in_use},
        "study_settings": {"render_in_use": bool(W.study_setting(db, "render_in_use", config.render_in_use_default))},
        "web": inspider.web_stats(db),
    }


class StudySettingsBody(BaseModel):
    render_in_use: bool | None = None


@router.put("/study-settings")
def put_study_settings(body: StudySettingsBody, e: Experimenter = Depends(current_experimenter), db: Session = Depends(get_db)):
    """Study-wide switches. render_in_use applies to participants whose renders
    have not been queued yet (the count is frozen when the job is created)."""
    changed = {}
    if body.render_in_use is not None:
        W.set_study_setting(db, "render_in_use", bool(body.render_in_use))
        changed["render_in_use"] = bool(body.render_in_use)
    audit(db, e, "study_settings.update", "study", None, changed)
    db.commit()
    return {"study_settings": {"render_in_use": bool(W.study_setting(db, "render_in_use", config.render_in_use_default))}}


@router.get("/web/search")
def web_search(q: str, e: Experimenter = Depends(current_experimenter), db: Session = Depends(get_db)):
    res = inspider.resolve_keyword(db, q)
    if not res["node"]:
        raise HTTPException(404, "No verb matches.")
    return {"resolution": res["method"], "score": res["score"], **inspider.ego(db, res["node"].id)}


@router.get("/web/phenomena")
def web_phenomena(limit: int = 200, e: Experimenter = Depends(current_experimenter), db: Session = Depends(get_db)):
    rows = db.execute(select(Phenomenon, Participant.username).outerjoin(StudySession, StudySession.id == Phenomenon.created_by_session).outerjoin(Participant, Participant.id == StudySession.participant_id).order_by(Phenomenon.id.desc()).limit(limit)).all()
    return {"phenomena": [{"id": ph.id, "keyword": ph.keyword_text, "title": ph.title, "description": ph.description, "domain": ph.domain, "source_url": ph.source_url, "created_by": u, "created_at": ph.created_at} for ph, u in rows]}


@router.get("/audit")
def audit_log(limit: int = 100, e: Experimenter = Depends(current_experimenter), db: Session = Depends(get_db)):
    rows = db.scalars(select(AuditLog).order_by(AuditLog.id.desc()).limit(limit)).all()
    return {"entries": [{"id": r.id, "actor": r.actor, "action": r.action, "target_type": r.target_type, "target_id": r.target_id, "details": r.details, "created_at": r.created_at} for r in rows]}


@router.get("/export.json")
def export_json(e: Experimenter = Depends(current_experimenter), db: Session = Depends(get_db)):
    audit(db, e, "export.json")
    db.commit()
    out = []
    for p in db.scalars(select(Participant).order_by(Participant.number)):
        sessions = db.scalars(select(StudySession).where(StudySession.participant_id == p.id)).all()
        out.append({"participant": participant_row(db, p), "sessions": [session_full(db, s) for s in sessions]})
    return {"exported_at": __import__("datetime").datetime.utcnow().isoformat(), "provider": config.ai_provider, "participants": out}


@router.get("/export/ratings.csv")
def export_ratings_csv(e: Experimenter = Depends(current_experimenter), db: Session = Depends(get_db)):
    """One row per rating, with the condition resolved - the analysis table."""
    audit(db, e, "export.ratings_csv")
    db.commit()
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["participant", "session", "condition_order", "target_type", "target_id", "condition", "title", "display_order", "novelty", "usefulness", "feasibility", "comment", "response_ms", "created_at"])
    for p in db.scalars(select(Participant).order_by(Participant.number)):
        for s in db.scalars(select(StudySession).where(StudySession.participant_id == p.id)):
            idea_cond = {i.id: (i.condition, i.title) for i in db.scalars(select(Idea).where(Idea.session_id == s.id))}
            concept_map = {c.id: (c.idea_id, c.title) for c in db.scalars(select(Concept).where(Concept.session_id == s.id))}
            for r in db.scalars(select(Rating).where(Rating.session_id == s.id).order_by(Rating.target_type, Rating.display_order)):
                if r.target_type == "idea":
                    cond, title = idea_cond.get(r.target_id, (None, None))
                else:
                    idea_id, title = concept_map.get(r.target_id, (None, None))
                    cond = idea_cond.get(idea_id, (None,))[0]
                w.writerow([p.username, s.number, "|".join(s.condition_order), r.target_type, r.target_id, cond, title, r.display_order, r.novelty, r.usefulness, r.feasibility, r.comment or "", r.response_ms or "", r.created_at])
    return PlainTextResponse(buf.getvalue(), media_type="text/csv", headers={"Content-Disposition": "attachment; filename=vitis-ratings.csv"})
