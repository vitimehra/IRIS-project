"""Participant-facing API. Everything is scoped to the logged-in participant's session."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from ..content.consent import CONSENT, CONSENT_VERSION
from ..db import get_db, is_lock_error, now_iso
from ..models import CAEIssue, Concept, Idea, Keyword, Participant, Problem, Render, StudySession
from ..services import workflow as W
from ..services.auth import current_participant, participant_login
from ..services.workflow import WorkflowError

router = APIRouter(prefix="/api", tags=["study"])


def handle(fn):
    try:
        return fn()
    except WorkflowError as e:
        raise HTTPException(e.status, str(e))
    except OperationalError as e:
        if is_lock_error(e):
            raise HTTPException(409, "The database was busy saving results. Please retry.") from e
        raise


# --- auth ------------------------------------------------------------------------------------

class LoginBody(BaseModel):
    username: str
    passcode: str


@router.post("/participant/login")
def login(body: LoginBody, db: Session = Depends(get_db)):
    p, token = participant_login(db, body.username, body.passcode)
    db.commit()
    return {"token": token, "participant": public_participant(p)}


def public_participant(p: Participant) -> dict:
    return {"id": p.id, "username": p.username, "name": p.name, "consented": p.consented_at is not None, "status": p.status}


@router.get("/consent")
def consent():
    return {"version": CONSENT_VERSION, **CONSENT}


class ConsentBody(BaseModel):
    agreed: dict[str, bool]


@router.post("/participant/consent")
def give_consent(body: ConsentBody, p: Participant = Depends(current_participant), db: Session = Depends(get_db)):
    missing = [i["key"] for i in CONSENT["items"] if not body.agreed.get(i["key"])]
    if missing:
        raise HTTPException(400, f"Please agree to every item: {', '.join(missing)}")
    p.consented_at, p.consent_version = now_iso(), CONSENT_VERSION
    db.commit()
    return {"ok": True}


# --- session state -------------------------------------------------------------------------------

def _session(db: Session, p: Participant) -> StudySession:
    if not p.consented_at:
        raise HTTPException(403, "Consent first.")
    s = W.get_or_create_session(db, p)
    db.commit()
    return s


def state_payload(db: Session, s: StudySession) -> dict:
    """Everything the frontend needs to render the current stage."""
    db.refresh(s)
    # Any stage with a background job re-kicks its worker on every read, which
    # is how a job resumes after a server restart.
    if s.stage.startswith("rate_") or s.stage == "done" or s.substage == "phenomena":
        W.kick_jobs(s.id)
    out = {
        "session_id": s.id, "stage": s.stage, "substage": s.substage, "condition": s.current_condition(),
        "condition_order": s.condition_order, "settings": s.settings, "stages": W.STAGES,
    }
    if s.stage in ("cae",):
        out["issues"] = [cae(r) for r in db.scalars(select(CAEIssue).where(CAEIssue.session_id == s.id).order_by(CAEIssue.ordinal))]
    if s.stage in ("problems",):
        out["problems"] = [{"id": r.id, "ordinal": r.ordinal, "statement": r.statement, "rationale": r.rationale} for r in db.scalars(select(Problem).where(Problem.session_id == s.id).order_by(Problem.ordinal))]
    if s.stage not in ("issue", "cae", "problems"):
        try:
            prob = W.selected_problem(db, s)
            out["problem"] = problem(prob)
        except WorkflowError:
            pass
    if s.stage == "traditional":
        out["ideas_required"] = W.setting(s, "ideas_per_condition")
    if s.current_condition() == "inspider":
        if s.substage == "keywords":
            out["keywords"] = [keyword(k) for k in db.scalars(select(Keyword).where(Keyword.session_id == s.id, Keyword.source.in_(["ai", "user"])).order_by(Keyword.ordinal, Keyword.id))]
        if s.substage == "neighbours":
            out["neighbour_options"] = W.neighbour_options(db, s)
            out["max_pick"] = W.setting(s, "neighbours_max_pick")
        if s.substage == "select":
            out["selection"] = W.selection_view(db, s)
        if s.substage == "phenomena":
            out["phenomena"] = W.phenomena_view(db, s)
    if s.stage.startswith("rate_"):
        out["deck"] = W.rating_deck(db, s)
        out["jobs"] = W.job_status(db, s)
    if s.stage == "done":
        out["jobs"] = W.job_status(db, s)
    return out


def cae(r: CAEIssue) -> dict:
    return {"id": r.id, "ordinal": r.ordinal, "headline": r.headline, "cause": r.cause, "affect": r.affect, "effect": r.effect, "evidence": r.evidence, "confirmed": r.confirmed}


def problem(p: Problem) -> dict:
    return {"id": p.id, "statement": p.statement, "rationale": p.rationale, "action": p.action, "object": p.object, "party": p.party, "context": p.context, "restated": (p.aopc_ai_version or {}).get("restated"), "confirmed": p.aopc_confirmed}


def keyword(k: Keyword) -> dict:
    return {"id": k.id, "text": k.text, "source": k.source, "rationale": k.rationale, "resolved_lemma": k.resolved_lemma, "resolution": k.resolution, "resolution_score": k.resolution_score, "node_id": k.node_id, "selected": k.selected}


@router.get("/study/state")
def state(p: Participant = Depends(current_participant), db: Session = Depends(get_db)):
    s = _session(db, p)
    return handle(lambda: state_payload(db, s))


@router.get("/study/history")
def study_history(p: Participant = Depends(current_participant), db: Session = Depends(get_db)):
    """Read-only view of the steps already completed (for the Back navigation)."""
    s = _session(db, p)
    return handle(lambda: W.history(db, s))


# --- stage actions -----------------------------------------------------------------------------------

class IssueBody(BaseModel):
    text: str
    input_mode: str = "typed"
    duration_ms: int | None = None


@router.post("/study/issue")
def issue(body: IssueBody, p: Participant = Depends(current_participant), db: Session = Depends(get_db)):
    s = _session(db, p)
    handle(lambda: W.submit_issue(db, s, body.text, body.input_mode, body.duration_ms))
    db.commit()
    return state_payload(db, s)


class CAEEdits(BaseModel):
    issues: list[dict]


@router.post("/study/cae/confirm")
def cae_confirm(body: CAEEdits, p: Participant = Depends(current_participant), db: Session = Depends(get_db)):
    s = _session(db, p)
    handle(lambda: W.confirm_cae(db, s, body.issues))
    db.commit()
    return state_payload(db, s)


class SelectBody(BaseModel):
    problem_id: int


@router.post("/study/problems/select")
def problems_select(body: SelectBody, p: Participant = Depends(current_participant), db: Session = Depends(get_db)):
    s = _session(db, p)
    handle(lambda: W.select_problem(db, s, body.problem_id))
    db.commit()
    return state_payload(db, s)


class AOPCBody(BaseModel):
    action: str | None = None
    object: str | None = None
    party: str | None = None
    context: str | None = None


@router.post("/study/aopc/confirm")
def aopc_confirm(body: AOPCBody, p: Participant = Depends(current_participant), db: Session = Depends(get_db)):
    s = _session(db, p)
    handle(lambda: W.confirm_aopc(db, s, body.model_dump()))
    db.commit()
    return state_payload(db, s)


class TraditionalBody(BaseModel):
    ideas: list[str]


@router.post("/study/traditional")
def traditional(body: TraditionalBody, p: Participant = Depends(current_participant), db: Session = Depends(get_db)):
    s = _session(db, p)
    handle(lambda: W.submit_traditional(db, s, body.ideas))
    db.commit()
    W.kick_jobs(s.id)
    return state_payload(db, s)


# --- inspider steps ---------------------------------------------------------------------------------------

@router.post("/study/inspider/keywords/propose")
def keywords_propose(p: Participant = Depends(current_participant), db: Session = Depends(get_db)):
    s = _session(db, p)
    handle(lambda: W.propose_keywords(db, s))
    db.commit()
    return state_payload(db, s)


class KeywordBody(BaseModel):
    text: str


@router.post("/study/inspider/keywords/add")
def keywords_add(body: KeywordBody, p: Participant = Depends(current_participant), db: Session = Depends(get_db)):
    s = _session(db, p)
    handle(lambda: W.add_keyword(db, s, body.text))
    db.commit()
    return state_payload(db, s)


class KeywordsConfirm(BaseModel):
    keyword_ids: list[int]


@router.post("/study/inspider/keywords/confirm")
def keywords_confirm(body: KeywordsConfirm, p: Participant = Depends(current_participant), db: Session = Depends(get_db)):
    s = _session(db, p)
    handle(lambda: W.confirm_keywords(db, s, body.keyword_ids))
    db.commit()
    return state_payload(db, s)


class NeighboursConfirm(BaseModel):
    picks: list[dict] = Field(default_factory=list)


@router.post("/study/inspider/neighbours/confirm")
def neighbours_confirm(body: NeighboursConfirm, p: Participant = Depends(current_participant), db: Session = Depends(get_db)):
    s = _session(db, p)
    handle(lambda: W.confirm_neighbours(db, s, body.picks))
    db.commit()
    return state_payload(db, s)


class SwapBody(BaseModel):
    out_id: int
    in_id: int


@router.post("/study/inspider/select/swap")
def select_swap(body: SwapBody, p: Participant = Depends(current_participant), db: Session = Depends(get_db)):
    s = _session(db, p)
    handle(lambda: W.swap_keyword(db, s, body.out_id, body.in_id))
    db.commit()
    return state_payload(db, s)


@router.post("/study/inspider/select/confirm")
def select_confirm(p: Participant = Depends(current_participant), db: Session = Depends(get_db)):
    s = _session(db, p)
    handle(lambda: W.confirm_selection(db, s))
    db.commit()
    return state_payload(db, s)


@router.post("/study/inspider/phenomena/run")
def phenomena_run(p: Participant = Depends(current_participant), db: Session = Depends(get_db)):
    s = _session(db, p)
    handle(lambda: W.run_phenomena(db, s))
    db.commit()
    W.kick_jobs(s.id)  # after commit, so the worker can see the job row
    return state_payload(db, s)


@router.post("/study/inspider/phenomena/confirm")
def phenomena_confirm(p: Participant = Depends(current_participant), db: Session = Depends(get_db)):
    s = _session(db, p)
    handle(lambda: W.confirm_phenomena(db, s))
    db.commit()
    W.kick_jobs(s.id)
    return state_payload(db, s)


# --- rating --------------------------------------------------------------------------------------------------

class RatingBody(BaseModel):
    target_type: str
    target_id: int
    novelty: int
    usefulness: int
    feasibility: int
    comment: str | None = None
    display_order: int = 0
    response_ms: int | None = None


@router.post("/study/rate")
def rate(body: RatingBody, p: Participant = Depends(current_participant), db: Session = Depends(get_db)):
    s = _session(db, p)
    handle(lambda: W.submit_rating(db, s, body.target_type, body.target_id, body.novelty, body.usefulness, body.feasibility, body.comment, body.display_order, body.response_ms))
    db.commit()
    return {"ok": True}


@router.post("/study/rate/complete")
def rate_complete(p: Participant = Depends(current_participant), db: Session = Depends(get_db)):
    s = _session(db, p)
    handle(lambda: W.complete_rating_stage(db, s))
    db.commit()
    return state_payload(db, s)
