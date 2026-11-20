"""
The study, stage by stage.

Each function here advances one session by one step, writes what happened to
the transcript (`events`), and moves the session's `stage`. The router is thin;
this is where the study's logic lives.

Stage order (models.STAGES):
  issue -> cae -> problems -> aopc -> traditional -> auto_1 -> auto_2
        -> rate_ideas -> rate_concepts -> rate_renders -> done

Traditional always comes first, so the participant's own ideas are never
contaminated by the AI's. auto_1 / auto_2 are modern and inspider in the
counterbalanced order fixed when the participant was created.
"""
from __future__ import annotations

import json
import random
import threading

import numpy as np
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..config import config
from ..content import prompts as P
from ..db import now_iso, retry_locked, session_scope
from ..models import (
    STAGES, INSPIDER_STEPS, AICall, CAEIssue, Concept, Event, Idea, IssueInput, Job, Keyword, Participant,
    Phenomenon, Problem, Rating, Render, SessionPhenomenon, StudySession, StudySetting,
)
from . import inspider
from .ai import AIError, claude_json, generate_image


class WorkflowError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def log(db: Session, s: StudySession, actor: str, kind: str, payload: dict | None = None) -> None:
    db.add(Event(session_id=s.id, stage=s.stage, actor=actor, kind=kind, payload=payload))


def require_stage(s: StudySession, *stages: str) -> None:
    if s.stage not in stages:
        raise WorkflowError(f"This action belongs to stage {' or '.join(stages)}; the session is at {s.stage}.", 409)


def advance(db: Session, s: StudySession, to: str | None = None) -> None:
    timings = dict(s.stage_timings or {})
    timings.setdefault(s.stage, {})["left"] = now_iso()
    s.stage = to or STAGES[STAGES.index(s.stage) + 1]
    s.substage = None
    timings.setdefault(s.stage, {})["entered"] = now_iso()
    s.stage_timings = timings
    log(db, s, "system", "stage_entered", {"stage": s.stage})
    if s.stage == "done":
        s.completed_at = now_iso()
        s.participant.status = "completed"


def setting(s: StudySession, key: str) -> int:
    return int((s.settings or {}).get(key, getattr(config.study, key)))


def study_setting(db: Session, key: str, default):
    row = db.get(StudySetting, key)
    return default if row is None or row.value is None else row.value.get("v", default)


def set_study_setting(db: Session, key: str, value) -> None:
    row = db.get(StudySetting, key)
    if row is None:
        db.add(StudySetting(key=key, value={"v": value}))
    else:
        row.value = {"v": value}


def render_in_use(db: Session, s: StudySession) -> bool:
    """Per-participant override in settings, else the console switch, else .env."""
    v = (s.settings or {}).get("render_in_use")
    if v is not None:
        return bool(v)
    return bool(study_setting(db, "render_in_use", config.render_in_use_default))


# --- session bootstrap ----------------------------------------------------------

def get_or_create_session(db: Session, participant: Participant) -> StudySession:
    s = db.scalar(select(StudySession).where(StudySession.participant_id == participant.id).order_by(StudySession.number.desc()))
    if s and s.stage != "done":
        return s
    if s and s.stage == "done":
        return s
    s = StudySession(
        participant_id=participant.id, number=1, stage="issue",
        condition_order=participant.condition_order, shuffle_seed=random.randint(1, 10**9),
        settings={**{k: getattr(config.study, k) for k in vars(config.study)}, **(participant.settings or {})},
        stage_timings={"issue": {"entered": now_iso()}},
    )
    db.add(s)
    db.flush()
    participant.status = "active"
    log(db, s, "system", "session_started", {"condition_order": s.condition_order})
    return s


# --- 1. issue -----------------------------------------------------------------------

def submit_issue(db: Session, s: StudySession, text: str, input_mode: str, duration_ms: int | None) -> list[CAEIssue]:
    require_stage(s, "issue")
    text = text.strip()
    if len(text) < 20:
        raise WorkflowError("Please describe the issue in a few sentences - at least a couple of lines.")
    db.add(IssueInput(session_id=s.id, text=text, input_mode=input_mode, duration_ms=duration_ms))
    log(db, s, "user", "issue_text", {"text": text, "input_mode": input_mode})

    retry_locked(db.commit)  # release the write lock while Claude works
    out = claude_json(db, s.id, "cae", "cae_extract", P.CAE_EXTRACT.format(issue_text=text))
    issues = []
    for i, it in enumerate(out.get("issues", [])[:6]):
        row = CAEIssue(session_id=s.id, ordinal=i + 1, headline=it.get("headline", ""), cause=it.get("cause", ""), affect=it.get("affect", ""), effect=it.get("effect", ""), evidence=it.get("evidence"), ai_version=it)
        db.add(row)
        issues.append(row)
    if not issues:
        raise WorkflowError("The AI could not find a user issue in that text. Try describing a specific moment.", 502)
    db.flush()
    log(db, s, "ai", "cae_generated", {"issues": [it for it in out.get("issues", [])]})
    advance(db, s, "cae")
    return issues


# --- 2. cae ------------------------------------------------------------------------------

def confirm_cae(db: Session, s: StudySession, edits: list[dict]) -> list[Problem]:
    require_stage(s, "cae")
    rows = {r.id: r for r in db.scalars(select(CAEIssue).where(CAEIssue.session_id == s.id))}
    kept = []
    for e in edits:
        r = rows.get(int(e["id"]))
        if not r:
            continue
        if e.get("remove"):
            db.delete(r)
            continue
        for f in ("headline", "cause", "affect", "effect"):
            if f in e and e[f] is not None and e[f] != getattr(r, f):
                setattr(r, f, str(e[f]).strip())
                r.edited = True
        r.confirmed = True
        kept.append(r)
    if not kept:
        raise WorkflowError("Keep at least one issue.")
    db.flush()
    log(db, s, "user", "cae_confirmed", {"issues": [{"id": r.id, "headline": r.headline, "cause": r.cause, "affect": r.affect, "effect": r.effect, "edited": r.edited} for r in kept]})

    issues_json = json.dumps([{"ordinal": r.ordinal, "headline": r.headline, "cause": r.cause, "affect": r.affect, "effect": r.effect} for r in kept], indent=1)
    retry_locked(db.commit)  # release the write lock while Claude works
    out = claude_json(db, s.id, "problems", "problems_identify", P.PROBLEMS_IDENTIFY.format(issues_json=issues_json))
    problems = []
    for i, p in enumerate(out.get("problems", [])[:6]):
        row = Problem(session_id=s.id, ordinal=i + 1, statement=p.get("statement", ""), rationale=p.get("rationale"), source_issue_ids=[r.id for r in kept if r.ordinal in (p.get("source_issue_ordinals") or [])])
        db.add(row)
        problems.append(row)
    if not problems:
        raise WorkflowError("The AI could not derive a problem. Please go back and refine the issues.", 502)
    db.flush()
    log(db, s, "ai", "problems_generated", {"problems": out.get("problems", [])})
    advance(db, s, "problems")
    return problems


# --- 3. problems ----------------------------------------------------------------------------

def select_problem(db: Session, s: StudySession, problem_id: int) -> Problem:
    require_stage(s, "problems")
    prob = db.get(Problem, problem_id)
    if not prob or prob.session_id != s.id:
        raise WorkflowError("No such problem.", 404)
    for p in db.scalars(select(Problem).where(Problem.session_id == s.id)):
        p.selected = p.id == prob.id
    log(db, s, "user", "problem_selected", {"problem_id": prob.id, "statement": prob.statement})

    issues = db.scalars(select(CAEIssue).where(CAEIssue.session_id == s.id, CAEIssue.confirmed == True)).all()  # noqa: E712
    issues_json = json.dumps([{"headline": r.headline, "cause": r.cause, "affect": r.affect, "effect": r.effect} for r in issues if r.id in (prob.source_issue_ids or [])] or [{"headline": r.headline, "cause": r.cause, "affect": r.affect, "effect": r.effect} for r in issues], indent=1)
    retry_locked(db.commit)  # release the write lock while Claude works
    out = claude_json(db, s.id, "aopc", "aopc", P.AOPC_STRUCTURE.format(statement=prob.statement, rationale=prob.rationale or "", issues_json=issues_json))
    prob.action, prob.object, prob.party, prob.context = (out.get(k, "") for k in ("action", "object", "party", "context"))
    prob.aopc_ai_version = out
    db.flush()
    log(db, s, "ai", "aopc_generated", out)
    advance(db, s, "aopc")
    return prob


# --- 4. aopc ----------------------------------------------------------------------------------

def confirm_aopc(db: Session, s: StudySession, edits: dict) -> Problem:
    require_stage(s, "aopc")
    prob = selected_problem(db, s)
    for f in ("action", "object", "party", "context"):
        if f in edits and edits[f] is not None and edits[f].strip() != (getattr(prob, f) or ""):
            setattr(prob, f, edits[f].strip())
            prob.aopc_edited = True
    prob.aopc_confirmed = True
    log(db, s, "user", "aopc_confirmed", {"action": prob.action, "object": prob.object, "party": prob.party, "context": prob.context, "edited": prob.aopc_edited})
    advance(db, s, "traditional")
    return prob


def selected_problem(db: Session, s: StudySession) -> Problem:
    prob = db.scalar(select(Problem).where(Problem.session_id == s.id, Problem.selected == True))  # noqa: E712
    if not prob:
        raise WorkflowError("No problem selected yet.", 409)
    return prob


def _aopc_kwargs(prob: Problem) -> dict:
    restated = (prob.aopc_ai_version or {}).get("restated") or prob.statement
    return {"action": prob.action, "object": prob.object, "party": prob.party, "context": prob.context, "restated": restated}


# --- 5. traditional ------------------------------------------------------------------------------

def submit_traditional(db: Session, s: StudySession, texts: list[str]) -> list[Idea]:
    require_stage(s, "traditional")
    n = setting(s, "ideas_per_condition")
    texts = [t.strip() for t in texts if t and t.strip()]
    if len(texts) < n:
        raise WorkflowError(f"Please write {n} ideas.")
    if any(len(t) < 20 for t in texts):
        raise WorkflowError("Type a minimum of 20 characters in each idea to proceed.")
    texts = texts[:n]
    prob = selected_problem(db, s)
    log(db, s, "user", "traditional_ideas", {"ideas": texts})

    retry_locked(db.commit)  # release the write lock while Claude works
    out = claude_json(db, s.id, "traditional", "traditional_structure", P.TRADITIONAL_STRUCTURE.format(**_aopc_kwargs(prob), ideas_json=json.dumps([{"ordinal": i + 1, "text": t} for i, t in enumerate(texts)], indent=1)))
    structured = {int(i.get("ordinal", k + 1)): i for k, i in enumerate(out.get("ideas", []))}
    ideas = []
    for i, t in enumerate(texts):
        st = structured.get(i + 1, {})
        row = Idea(session_id=s.id, condition="traditional", ordinal=i + 1, title=st.get("title") or f"Idea {i + 1}", raw_text=t,
                   principle=st.get("principle") or t, phenomenon=st.get("phenomenon") or t,
                   inspired_by={"principle_inferred": st.get("principle_inferred"), "phenomenon_inferred": st.get("phenomenon_inferred")})
        db.add(row)
        ideas.append(row)
    db.flush()
    log(db, s, "ai", "traditional_structured", out)
    advance(db, s, "auto_1")
    _maybe_run_auto(db, s)
    return ideas


# --- 6. automatic conditions ------------------------------------------------------------------------

def _maybe_run_auto(db: Session, s: StudySession) -> None:
    """
    Called whenever an automatic stage is entered. Modern needs no participant
    input, so it runs immediately and advances; Inspider stops at its first
    step and waits for the participant. Loops so that modern -> inspider and
    inspider -> modern both land correctly.
    """
    while s.stage in ("auto_1", "auto_2"):
        cond = s.current_condition()
        if cond == "modern":
            run_modern(db, s)
            advance(db, s)
        elif cond == "inspider":
            s.substage = "keywords"
            return
        else:
            return
    if s.stage == "rate_ideas":
        start_generation_jobs(db, s)


def run_modern(db: Session, s: StudySession) -> list[Idea]:
    prob = selected_problem(db, s)
    n = setting(s, "ideas_per_condition")
    retry_locked(db.commit)  # release the write lock while Claude works
    out = claude_json(db, s.id, "modern", "ideas_modern", P.IDEAS_MODERN.format(n=n, **_aopc_kwargs(prob)))
    ideas = []
    for i, it in enumerate(out.get("ideas", [])[:n]):
        row = Idea(session_id=s.id, condition="modern", ordinal=i + 1, title=it.get("title") or f"Idea {i + 1}", principle=it.get("principle", ""), phenomenon=it.get("phenomenon", ""))
        db.add(row)
        ideas.append(row)
    db.flush()
    log(db, s, "ai", "modern_ideas", out)
    return ideas


# --- inspider: keywords ------------------------------------------------------------------------------

def _sync(db: Session, s: StudySession) -> None:
    """Re-read the row. Concurrent Inspider requests otherwise act on a stale substage."""
    db.refresh(s)


def _inspider_past(s: StudySession, step: str) -> bool:
    if s.current_condition() != "inspider" or not s.substage:
        return False
    try:
        return INSPIDER_STEPS.index(s.substage) > INSPIDER_STEPS.index(step)
    except ValueError:
        return False


def _require_inspider(db: Session, s: StudySession, step: str) -> None:
    _sync(db, s)
    if s.current_condition() != "inspider" or s.substage != step:
        raise WorkflowError(f"This action belongs to the Inspider step '{step}'; the session is at {s.stage}/{s.substage}.", 409)


def _root_keywords(db: Session, s: StudySession) -> list[Keyword]:
    return db.scalars(select(Keyword).where(Keyword.session_id == s.id, Keyword.source.in_(["ai", "user"])).order_by(Keyword.ordinal, Keyword.id)).all()


def propose_keywords(db: Session, s: StudySession) -> list[Keyword]:
    _sync(db, s)
    if s.current_condition() != "inspider":
        raise WorkflowError(f"This action belongs to the Inspider step 'keywords'; the session is at {s.stage}/{s.substage}.", 409)
    if s.substage != "keywords":
        return _root_keywords(db, s)
    existing = db.scalars(select(Keyword).where(Keyword.session_id == s.id, Keyword.source == "ai")).all()
    if existing:
        return existing
    prob = selected_problem(db, s)
    n = setting(s, "keywords_proposed")
    retry_locked(db.commit)  # release the write lock while Claude works
    out = claude_json(db, s.id, "keywords", "keywords", P.KEYWORDS_PROPOSE.format(n=n, **_aopc_kwargs(prob)))
    _sync(db, s)
    if s.substage != "keywords":
        return _root_keywords(db, s)
    rows = []
    for i, k in enumerate(out.get("keywords", [])[:n]):
        rows.append(_add_keyword(db, s, k.get("verb", ""), "ai", k.get("rationale"), ordinal=i))
    db.flush()
    log(db, s, "ai", "keywords_proposed", {"keywords": [{"id": r.id, "text": r.text, "resolved": r.resolved_lemma, "method": r.resolution} for r in rows]})
    return rows


def _add_keyword(db: Session, s: StudySession, text: str, source: str, rationale: str | None = None, ordinal: int = 0, parent: Keyword | None = None, sim: float | None = None, node_id: int | None = None) -> Keyword:
    text = text.strip().lower()
    if node_id is not None:
        node = db.get(inspider.InspiderNode, node_id)
        res = {"node": node, "method": "exact", "score": 1.0}
    else:
        res = inspider.resolve_keyword(db, text, s.id)
    row = Keyword(session_id=s.id, text=text, source=source, rationale=rationale, ordinal=ordinal, parent_keyword_id=parent.id if parent else None,
                  node_id=res["node"].id if res["node"] else None, resolved_lemma=res["node"].lemma if res["node"] else None,
                  resolution=res["method"], resolution_score=res["score"], similarity_to_parent=sim, selected=True)
    db.add(row)
    db.flush()
    return row


def add_keyword(db: Session, s: StudySession, text: str) -> Keyword:
    _require_inspider(db, s, "keywords")
    if not text.strip():
        raise WorkflowError("Type a verb.")
    row = _add_keyword(db, s, text, "user", ordinal=99)
    log(db, s, "user", "keyword_added", {"id": row.id, "text": row.text, "resolved": row.resolved_lemma, "method": row.resolution})
    return row


def confirm_keywords(db: Session, s: StudySession, selected_ids: list[int]) -> list[Keyword]:
    _sync(db, s)
    if s.current_condition() != "inspider":
        raise WorkflowError(f"This action belongs to the Inspider step 'keywords'; the session is at {s.stage}/{s.substage}.", 409)
    if _inspider_past(s, "keywords"):
        return [r for r in _root_keywords(db, s) if r.selected]
    _require_inspider(db, s, "keywords")
    rows = db.scalars(select(Keyword).where(Keyword.session_id == s.id, Keyword.source.in_(["ai", "user"]))).all()
    kept = []
    for r in rows:
        r.selected = r.id in selected_ids and r.node_id is not None
        if r.selected:
            kept.append(r)
    if not kept:
        raise WorkflowError("Keep at least one keyword that maps to a verb in the web.")
    log(db, s, "user", "keywords_confirmed", {"keyword_ids": [r.id for r in kept], "verbs": [r.resolved_lemma for r in kept]})
    s.substage = "neighbours"
    return kept


# --- inspider: neighbours -----------------------------------------------------------------------------

def neighbour_options(db: Session, s: StudySession) -> list[dict]:
    _require_inspider(db, s, "neighbours")
    k = setting(s, "neighbours_shown")
    out = []
    for kw in db.scalars(select(Keyword).where(Keyword.session_id == s.id, Keyword.source.in_(["ai", "user"]), Keyword.selected == True)):  # noqa: E712
        nbrs = inspider.neighbours(db, kw.node_id, k) if kw.node_id else []
        out.append({"keyword": {"id": kw.id, "text": kw.text, "lemma": kw.resolved_lemma, "rationale": kw.rationale, "gloss": db.get(inspider.InspiderNode, kw.node_id).gloss if kw.node_id else None}, "neighbours": nbrs})
    return out


def confirm_neighbours(db: Session, s: StudySession, picks: list[dict]) -> list[Keyword]:
    """picks: [{keyword_id, node_ids: [...]}]"""
    _sync(db, s)
    if s.current_condition() != "inspider":
        raise WorkflowError(f"This action belongs to the Inspider step 'neighbours'; the session is at {s.stage}/{s.substage}.", 409)
    if _inspider_past(s, "neighbours"):
        return db.scalars(select(Keyword).where(Keyword.session_id == s.id, Keyword.source == "neighbour")).all()
    _require_inspider(db, s, "neighbours")
    maxpick = setting(s, "neighbours_max_pick")
    parents = {kw.id: kw for kw in db.scalars(select(Keyword).where(Keyword.session_id == s.id, Keyword.selected == True))}  # noqa: E712
    created = []
    for pick in picks:
        parent = parents.get(int(pick.get("keyword_id", -1)))
        if not parent:
            continue
        nbrs = {n["node_id"]: n for n in inspider.neighbours(db, parent.node_id, 100, include_unverified=True)}
        for nid in list(dict.fromkeys(int(x) for x in pick.get("node_ids", [])))[:maxpick]:
            n = nbrs.get(nid)
            if not n:
                continue
            created.append(_add_keyword(db, s, n["lemma"], "neighbour", parent=parent, sim=n["sim"], node_id=nid))
    log(db, s, "user", "neighbours_confirmed", {"picked": [{"id": r.id, "lemma": r.resolved_lemma, "parent": r.parent_keyword_id, "sim": r.similarity_to_parent} for r in created]})
    s.substage = "select"
    select_keywords(db, s)
    return created


# --- inspider: selection --------------------------------------------------------------------------------
#
# The pool after neighbour picking (proposed + picked neighbours) is larger than
# the number of ideas wanted. Searching phenomena for all of it costs a searched
# call per verb and leaves the model to pick freely among 30-50 phenomena, with
# no guarantee the ideas spread across verbs. Instead the pool is cut to the K
# most mutually distant verbs (K = ideas per condition), phenomena are searched
# for those only, and each idea is later tied to one verb.

def _keywords_final_count(s: StudySession) -> int:
    k = setting(s, "keywords_final")
    return k if k > 0 else setting(s, "ideas_per_condition")


def _pool(db: Session, s: StudySession) -> list[Keyword]:
    return db.scalars(select(Keyword).where(Keyword.session_id == s.id, Keyword.selected == True, Keyword.node_id.isnot(None)).order_by(Keyword.id)).all()  # noqa: E712


def _farthest_point(vectors: dict[int, np.ndarray], k: int) -> tuple[list[int], dict[int, float]]:
    """Greedy max-min: start with the verb farthest from the pool's centroid, then
    repeatedly add the verb whose nearest chosen verb is farthest. Cosine distance.
    Returns the chosen ids in order and each id's distance to its nearest chosen verb.

    `vectors` is keyed by keyword row id, which is not a numpy index — all matrix
    work uses 0..n-1 positions and maps back to ids at the end.
    """
    ids = list(vectors)
    if not ids:
        return [], {}
    M = np.stack([np.asarray(vectors[i], dtype=np.float32) / (np.linalg.norm(vectors[i]) + 1e-9) for i in ids])
    centroid = M.mean(axis=0)
    centroid /= np.linalg.norm(centroid) + 1e-9
    first = int(np.argmin(M @ centroid))
    chosen_pos = [first]
    nearest = 1.0 - (M @ M[first])  # distance of every verb to the chosen set
    nearest[first] = 0.0
    while len(chosen_pos) < min(k, len(ids)):
        cand = [i for i in range(len(ids)) if i not in chosen_pos]
        nxt = max(cand, key=lambda i: (float(nearest[i]), -i))
        chosen_pos.append(nxt)
        d = 1.0 - (M @ M[nxt])
        nearest = np.minimum(nearest, d)
        nearest[nxt] = 0.0
    report: dict[int, float] = {}
    C = M[chosen_pos]
    chosen_set = set(chosen_pos)
    for pos, kid in enumerate(ids):
        sims = C @ M[pos]
        if pos in chosen_set:
            sims = np.delete(sims, chosen_pos.index(pos))
        report[kid] = float(1.0 - np.max(sims)) if np.size(sims) else 1.0
    return [ids[i] for i in chosen_pos], report


def select_keywords(db: Session, s: StudySession) -> None:
    """Mark the K most mutually distant verbs of the pool as final. Deterministic."""
    pool = _pool(db, s)
    k = _keywords_final_count(s)
    for kw in pool:
        kw.final = False
    if len(pool) <= k:
        for kw in pool:
            kw.final = True
        log(db, s, "system", "keywords_selected", {"kept": [kw.id for kw in pool], "dropped": [], "k": k, "method": "all"})
        return
    vectors = {}
    for kw in pool:
        v = inspider.verb_vector(kw.node_id)
        if v is not None:
            vectors[kw.id] = v
    try:
        chosen, dist = _farthest_point(vectors, k)
    except Exception:
        chosen, dist = list(vectors.keys())[:k], {}
    # verbs without a vector (should not happen for web verbs) only fill gaps
    for kw in pool:
        if len(chosen) >= k:
            break
        if kw.id not in chosen:
            chosen.append(kw.id)
    by_id = {kw.id: kw for kw in pool}
    for kid in chosen:
        by_id[kid].final = True
    db.flush()
    log(db, s, "system", "keywords_selected", {
        "k": k, "method": "farthest_point_cosine",
        "kept": [{"id": kid, "lemma": by_id[kid].resolved_lemma, "source": by_id[kid].source, "nearest_kept_distance": round(dist.get(kid, 1.0), 3)} for kid in chosen],
        "dropped": [{"id": kw.id, "lemma": kw.resolved_lemma, "source": kw.source, "nearest_kept_distance": round(dist.get(kw.id, 1.0), 3)} for kw in pool if not kw.final],
    })


def selection_view(db: Session, s: StudySession) -> dict:
    pool = _pool(db, s)
    by_id = {kw.id: kw for kw in pool}
    last = db.scalar(select(Event).where(Event.session_id == s.id, Event.kind == "keywords_selected").order_by(Event.id.desc()))
    dist = {}
    if last and last.payload:
        for x in (last.payload.get("kept") or []) + (last.payload.get("dropped") or []):
            if isinstance(x, dict):
                dist[x["id"]] = x.get("nearest_kept_distance")
    swaps = db.scalar(select(func.count()).select_from(Event).where(Event.session_id == s.id, Event.kind == "keyword_swapped")) or 0

    def row(kw: Keyword) -> dict:
        node = db.get(inspider.InspiderNode, kw.node_id)
        parent = by_id.get(kw.parent_keyword_id) if kw.parent_keyword_id else None
        return {
            "id": kw.id, "lemma": kw.resolved_lemma, "gloss": node.gloss if node else None, "source": kw.source,
            "rationale": kw.rationale, "parent_lemma": parent.resolved_lemma if parent else None,
            "similarity_to_parent": kw.similarity_to_parent, "nearest_kept_distance": dist.get(kw.id),
            "phenomenon_count": node.phenomenon_count if node else 0,
        }

    return {
        "k": _keywords_final_count(s),
        "kept": [row(kw) for kw in pool if kw.final],
        "dropped": [row(kw) for kw in pool if not kw.final],
        "swaps_left": max(0, setting(s, "keyword_swaps_max") - swaps),
    }


def swap_keyword(db: Session, s: StudySession, out_id: int, in_id: int) -> dict:
    _require_inspider(db, s, "select")
    view = selection_view(db, s)
    if view["swaps_left"] <= 0:
        raise WorkflowError("No swaps left.", 409)
    out_kw = db.get(Keyword, out_id)
    in_kw = db.get(Keyword, in_id)
    if not out_kw or not in_kw or out_kw.session_id != s.id or in_kw.session_id != s.id or not out_kw.final or in_kw.final or not in_kw.selected:
        raise WorkflowError("Swap one kept verb for one dropped verb.")
    out_kw.final, in_kw.final = False, True
    log(db, s, "user", "keyword_swapped", {"out": {"id": out_kw.id, "lemma": out_kw.resolved_lemma}, "in": {"id": in_kw.id, "lemma": in_kw.resolved_lemma}})
    return selection_view(db, s)


def confirm_selection(db: Session, s: StudySession) -> None:
    _sync(db, s)
    if s.current_condition() != "inspider":
        raise WorkflowError(f"This action belongs to the Inspider step 'select'; the session is at {s.stage}/{s.substage}.", 409)
    if _inspider_past(s, "select"):
        return
    _require_inspider(db, s, "select")
    kept = [kw for kw in _pool(db, s) if kw.final]
    if not kept:
        raise WorkflowError("Keep at least one verb.")
    log(db, s, "user", "selection_confirmed", {"kept": [kw.resolved_lemma for kw in kept]})
    s.substage = "phenomena"


# --- inspider: phenomena -------------------------------------------------------------------------------
#
# This stage is a background job, for three reasons that all bit in practice:
#   1. One web-searched Claude call takes ~45 s. Nine keywords in one HTTP
#      request is ~7 minutes, which Railway's proxy and every browser abandon.
#   2. Holding the request's SQLite transaction across those calls blocked the
#      participant's own polling with "database is locked".
#   3. React re-mounts fired the request twice, so it has to be idempotent.
# The worker searches keywords three at a time, each result written in its own
# short transaction, and the participant polls progress.

PHENOMENA_CONCURRENCY = 3


def run_phenomena(db: Session, s: StudySession) -> dict:
    """Queue the search (idempotent) and return the current view + job status."""
    _sync(db, s)
    if s.current_condition() != "inspider":
        raise WorkflowError(f"This action belongs to the Inspider step 'phenomena'; the session is at {s.stage}/{s.substage}.", 409)
    if _inspider_past(s, "phenomena"):
        return phenomena_view(db, s)
    _require_inspider(db, s, "phenomena")

    job = db.scalar(select(Job).where(Job.session_id == s.id, Job.kind == "phenomena"))
    keywords = db.scalars(select(Keyword).where(Keyword.session_id == s.id, Keyword.final == True, Keyword.node_id.isnot(None))).all()  # noqa: E712
    if not keywords:
        raise WorkflowError("No keywords resolved to a verb in the web. Go back and choose different keywords.", 409)

    if job is None:
        job = Job(session_id=s.id, kind="phenomena", total=len(keywords))
        db.add(job)
        log(db, s, "system", "phenomena_queued", {"keywords": [k.resolved_lemma for k in keywords]})
    elif job.status == "error":
        # A retry from the participant: search only what is still missing.
        job.status, job.error, job.progress = "queued", None, 0
        done = {kid for (kid,) in db.execute(select(SessionPhenomenon.keyword_id).where(SessionPhenomenon.session_id == s.id, SessionPhenomenon.fresh == True)).all()}  # noqa: E712
        job.progress = len({k.id for k in keywords} & done)
        log(db, s, "system", "phenomena_retry", {"remaining": job.total - job.progress})
    db.flush()
    return phenomena_view(db, s)


def _phenomena_worker(session_id: int) -> None:
    """Search each selected keyword, three at a time, writing each result in its own transaction."""
    from concurrent.futures import ThreadPoolExecutor, as_completed

    with session_scope() as db:
        s = db.get(StudySession, session_id)
        job = db.scalar(select(Job).where(Job.session_id == session_id, Job.kind == "phenomena"))
        if not job or job.status == "done":
            return
        job.status, job.started_at, job.error = "running", now_iso(), None
        prob = selected_problem(db, s)
        n = setting(s, "phenomena_per_keyword")
        restated = _aopc_kwargs(prob)["restated"]
        already_fresh = {kid for (kid,) in db.execute(select(SessionPhenomenon.keyword_id).where(SessionPhenomenon.session_id == session_id, SessionPhenomenon.fresh == True)).all()}  # noqa: E712
        already_any = {kid for (kid,) in db.execute(select(SessionPhenomenon.keyword_id).where(SessionPhenomenon.session_id == session_id)).all()}
        tasks = []
        for kw in db.scalars(select(Keyword).where(Keyword.session_id == session_id, Keyword.final == True, Keyword.node_id.isnot(None))).all():  # noqa: E712
            node = db.get(inspider.InspiderNode, kw.node_id)
            existing = inspider.existing_phenomena(db, node.id)
            # Inherited phenomena are attached immediately, before any search.
            if kw.id not in already_any:
                for ph in existing:
                    db.add(SessionPhenomenon(session_id=session_id, keyword_id=kw.id, phenomenon_id=ph.id, fresh=False))
            if kw.id in already_fresh:
                continue
            tasks.append({
                "keyword_id": kw.id, "keyword_text": kw.text, "node_id": node.id, "lemma": node.lemma,
                "gloss": node.gloss or "", "existing_titles": [p.title for p in existing],
            })
    # transaction closed: nothing is held while Claude works

    def search_one(t: dict) -> tuple[dict, list[dict], str | None]:
        existing_json = json.dumps([{"title": x} for x in t["existing_titles"]]) if t["existing_titles"] else "[]"
        last_err = None
        for use_search in (True, False):
            prompt = (P.PHENOMENA_SEARCH if use_search else P.PHENOMENA_GENERATE).format(
                n=n, verb=t["lemma"], gloss=t["gloss"], restated=restated, existing_json=existing_json
            )
            try:
                # Output tokens count every search turn, not just the final JSON;
                # a ceiling that is too low kills a call after its searches are paid for.
                out = claude_json(None, session_id, "phenomena", "phenomena", prompt, web_search=use_search, max_tokens=8000)
                items = [p for p in out.get("phenomena", []) if p.get("title") and p.get("description")][:n]
                if items:
                    for p in items:
                        p["searched"] = use_search
                    return t, items, None
                last_err = "empty result"
            except AIError as e:
                last_err = str(e)
        return t, [], last_err

    summary, failures = [], []
    with ThreadPoolExecutor(max_workers=PHENOMENA_CONCURRENCY) as pool:
        futures = [pool.submit(search_one, t) for t in tasks]
        for fut in as_completed(futures):
            t, items, err = fut.result()
            with session_scope() as db:
                s = db.get(StudySession, session_id)
                job = db.scalar(select(Job).where(Job.session_id == session_id, Job.kind == "phenomena"))
                node = db.get(inspider.InspiderNode, t["node_id"])
                fresh = []
                if items:
                    try:
                        fresh = inspider.append_phenomena(db, session_id, node, t["keyword_text"], items)
                    except Exception as e:
                        err = f"append failed: {e}"
                for ph in fresh:
                    db.add(SessionPhenomenon(session_id=session_id, keyword_id=t["keyword_id"], phenomenon_id=ph.id, fresh=True))
                if err and not fresh:
                    failures.append({"keyword": t["lemma"], "error": err})
                    log(db, s, "system", "phenomena_error", {"keyword": t["lemma"], "error": err})
                summary.append({"keyword": t["lemma"], "inherited": len(t["existing_titles"]), "fresh": len(fresh), "searched": bool(items and items[0].get("searched"))})
                job.progress = min(job.total, job.progress + 1)

    with session_scope() as db:
        s = db.get(StudySession, session_id)
        job = db.scalar(select(Job).where(Job.session_id == session_id, Job.kind == "phenomena"))
        total_found = db.scalar(select(SessionPhenomenon.id).where(SessionPhenomenon.session_id == session_id).limit(1)) is not None
        job.finished_at = now_iso()
        if not total_found:
            job.status = "error"
            job.error = "No phenomena could be found for any keyword. " + "; ".join(f"{f['keyword']}: {f['error']}" for f in failures)[:800]
        else:
            job.status = "done"
            if failures:
                job.error = f"{len(failures)} keyword(s) returned nothing: " + ", ".join(f["keyword"] for f in failures)
        log(db, s, "ai", "phenomena_generated", {"summary": summary, "failures": failures})


def phenomena_view(db: Session, s: StudySession) -> dict:
    rows = db.execute(select(SessionPhenomenon, Phenomenon, Keyword).join(Phenomenon, Phenomenon.id == SessionPhenomenon.phenomenon_id).join(Keyword, Keyword.id == SessionPhenomenon.keyword_id).where(SessionPhenomenon.session_id == s.id).order_by(Keyword.id, Phenomenon.id)).all()
    by_kw: dict[int, dict] = {}
    for sp, ph, kw in rows:
        g = by_kw.setdefault(kw.id, {"keyword": {"id": kw.id, "lemma": kw.resolved_lemma, "source": kw.source, "parent": kw.parent_keyword_id}, "phenomena": []})
        g["phenomena"].append({"id": ph.id, "title": ph.title, "description": ph.description, "domain": ph.domain, "source_url": ph.source_url, "source_title": ph.source_title, "fresh": sp.fresh})
    job = db.scalar(select(Job).where(Job.session_id == s.id, Job.kind == "phenomena"))
    return {
        "groups": list(by_kw.values()),
        "job": {"status": job.status, "progress": job.progress, "total": job.total, "error": job.error} if job else None,
    }


def confirm_phenomena(db: Session, s: StudySession) -> list[Idea]:
    _sync(db, s)
    if s.current_condition() != "inspider":
        raise WorkflowError(f"This action belongs to the Inspider step 'phenomena'; the session is at {s.stage}/{s.substage}.", 409)
    if _inspider_past(s, "phenomena"):
        return db.scalars(select(Idea).where(Idea.session_id == s.id, Idea.condition == "inspider")).all()
    _require_inspider(db, s, "phenomena")
    view = phenomena_view(db, s)
    if view["job"] and view["job"]["status"] in ("queued", "running"):
        raise WorkflowError("The phenomena search is still running.", 409)
    groups = [g for g in view["groups"] if g["phenomena"]]
    if not groups:
        raise WorkflowError("No phenomena were found. Go back and choose different keywords.", 409)
    log(db, s, "user", "phenomena_reviewed", {"count": sum(len(g["phenomena"]) for g in groups)})
    prob = selected_problem(db, s)
    n = setting(s, "ideas_per_condition")
    # One idea per verb: idea k must transfer a mechanism from verb k's
    # phenomena. If fewer verbs found anything than ideas are wanted, the
    # remaining ideas may draw on any verb but must still differ.
    verbs_json = json.dumps([
        {"verb": g["keyword"]["lemma"], "idea_ordinal": i + 1 if i < n else None,
         "phenomena": [{"id": p["id"], "title": p["title"], "description": p["description"], "domain": p["domain"]} for p in g["phenomena"]]}
        for i, g in enumerate(groups)
    ], indent=1)
    # Release the write lock before the model call: nothing may hold SQLite
    # while Claude thinks, or the participant's own polling blocks.
    retry_locked(db.commit)
    out = claude_json(db, s.id, "inspider", "ideas_inspider", P.IDEAS_INSPIDER.format(n=n, n_verbs=len(groups), **_aopc_kwargs(prob), verbs_json=verbs_json), max_tokens=6000)
    _sync(db, s)
    if s.substage != "phenomena":  # a concurrent request already advanced
        return db.scalars(select(Idea).where(Idea.session_id == s.id, Idea.condition == "inspider")).all()
    ideas = []
    for i, it in enumerate(out.get("ideas", [])[:n]):
        row = Idea(session_id=s.id, condition="inspider", ordinal=i + 1, title=it.get("title") or f"Idea {i + 1}", principle=it.get("principle", ""), phenomenon=it.get("phenomenon", ""), inspired_by={"phenomenon_ids": it.get("inspired_by", []), "verb": it.get("verb"), "transfer": it.get("transfer")})
        db.add(row)
        ideas.append(row)
    db.flush()
    log(db, s, "ai", "inspider_ideas", out)
    advance(db, s)
    _maybe_run_auto(db, s)
    return ideas


# --- background generation ------------------------------------------------------------------------

def start_generation_jobs(db: Session, s: StudySession) -> None:
    """Queues the jobs. The worker is kicked by the router AFTER commit (see kick_jobs)."""
    if db.scalar(select(Job).where(Job.session_id == s.id, Job.kind == "concepts")):
        return
    total = len(db.scalars(select(Idea.id).where(Idea.session_id == s.id)).all())
    kinds = 2 if render_in_use(db, s) else 1
    db.add(Job(session_id=s.id, kind="concepts", total=total * setting(s, "concepts_per_idea")))
    db.add(Job(session_id=s.id, kind="renders", total=total * setting(s, "concepts_per_idea") * kinds))
    db.flush()
    log(db, s, "system", "generation_queued", {"ideas": total, "render_in_use": kinds == 2})


_workers: dict[int, threading.Thread] = {}
_workers_lock = threading.Lock()


def retry_failed_jobs(db: Session, s: StudySession) -> list[str]:
    """Experimenter action: put errored jobs back in the queue. Finished work is kept; only what is missing is redone."""
    kinds = []
    for j in db.scalars(select(Job).where(Job.session_id == s.id, Job.status == "error")):
        j.status, j.error, j.finished_at = "queued", None, None
        if j.kind == "phenomena":
            done = {kid for (kid,) in db.execute(select(SessionPhenomenon.keyword_id).where(SessionPhenomenon.session_id == s.id, SessionPhenomenon.fresh == True)).all()}  # noqa: E712
            j.progress = len(done)
        elif j.kind == "concepts":
            j.progress = len(db.scalars(select(Concept.id).where(Concept.session_id == s.id)).all())
        elif j.kind == "renders":
            j.progress = len(db.scalars(select(Render.id).where(Render.session_id == s.id, Render.status == "ok")).all())
        kinds.append(j.kind)
    if kinds:
        log(db, s, "system", "jobs_retried", {"kinds": kinds})
    return kinds


def requeue_failed_renders(db: Session, s: StudySession) -> dict:
    """
 Experimenter action for renders that failed inside a job that still finished.
 The render worker records a failed image as renders.status = 'error' and
 carries on, so the job ends 'done'. retry_failed_jobs only sees jobs whose
 own status is 'error', and the rating deck silently leaves failed renders
 out - a participant can then be moved past the render deck having rated
 fewer products than concepts (or none at all).
 This puts the failed renders back in the queue. If the participant has
 already been moved past the render deck, that stage is reopened so the
 regenerated renders can be rated. Nothing already rated is touched.
 """
    job = db.scalar(select(Job).where(Job.session_id == s.id, Job.kind == "renders"))
    if not job:
        raise WorkflowError("This session has not reached render generation yet.", 409)
    if job.status in ("queued", "running"):
        raise WorkflowError("Renders are still being generated for this session.", 409)
    renders = db.scalars(select(Render).where(Render.session_id == s.id)).all()
    failed = [r for r in renders if r.status != "ok"]
    ok = len(renders) - len(failed)
    never_attempted = max(0, job.total - len(renders))
    if not failed and not never_attempted:
        return {"requeued": 0, "never_attempted": 0, "reopened_render_stage": False}
    for r in failed:
        r.status, r.error = "pending", None
    previous = {"job_error": job.error, "job_finished_at": job.finished_at, "stage": s.stage, "completed_at": s.completed_at}
    job.status, job.error, job.finished_at, job.progress = "queued", None, None, ok
    reopened = False
    if s.stage == "done":
        s.stage, s.substage, s.completed_at = "rate_renders", None, None
        s.participant.status = "active"
        reopened = True
    db.flush()
    log(db, s, "system", "renders_requeued", {"failed": len(failed), "never_attempted": never_attempted, "kept_ok": ok, "reopened_render_stage": reopened, "previous": previous})
    return {"requeued": len(failed), "never_attempted": never_attempted, "reopened_render_stage": reopened}


def kick_jobs(session_id: int) -> None:
    """
    Starts the background worker for a session if it has unfinished jobs and no
    worker is already running. Safe to call on every request: it is how a
    generation resumes after a server restart.
    """
    with _workers_lock:
        t = _workers.get(session_id)
        if t and t.is_alive():
            return
        with session_scope() as db:
            pending = db.scalar(select(Job).where(Job.session_id == session_id, Job.status.in_(["queued", "running"])))
            if not pending:
                return
            # a 'running' job with no live thread is one a restart interrupted
            for j in db.scalars(select(Job).where(Job.session_id == session_id, Job.status == "running")):
                j.status = "queued"
            kinds = {j.kind for j in db.scalars(select(Job).where(Job.session_id == session_id, Job.status == "queued"))}
        target = _phenomena_worker if "phenomena" in kinds else _generation_worker
        t = threading.Thread(target=target, args=(session_id,), daemon=True, name=f"vitis-{'phen' if target is _phenomena_worker else 'gen'}-{session_id}")
        _workers[session_id] = t
        t.start()


def _generation_worker(session_id: int) -> None:
    """Concepts then renders, in a thread with its own DB session. Progress in `jobs`."""
    with session_scope() as db:
        s = db.get(StudySession, session_id)
        job = db.scalar(select(Job).where(Job.session_id == session_id, Job.kind == "concepts"))
        job.status, job.started_at = "running", now_iso()
        db.commit()
        try:
            prob = selected_problem(db, s)
            per = setting(s, "concepts_per_idea")
            # Frozen at queue time (jobs.total), so a console flip mid-run cannot desync progress.
            rjob = db.scalar(select(Job).where(Job.session_id == session_id, Job.kind == "renders"))
            render_kinds = ("product", "in_use") if rjob and rjob.total >= 2 * per * len(db.scalars(select(Idea.id).where(Idea.session_id == session_id)).all()) else ("product",)
            for idea in db.scalars(select(Idea).where(Idea.session_id == session_id).order_by(Idea.id)).all():
                have = len(db.scalars(select(Concept.id).where(Concept.idea_id == idea.id)).all())
                for c in range(have, per):
                    db.commit()  # release the write lock while Claude works
                    out = claude_json(db, session_id, "concepts", "concept", P.CONCEPT_FROM_IDEA.format(**_aopc_kwargs(prob), title=idea.title, principle=idea.principle, phenomenon=idea.phenomenon))
                    db.add(Concept(session_id=session_id, idea_id=idea.id, ordinal=c, title=out.get("title") or idea.title, object=out.get("object", ""), characteristics=out.get("characteristics", []), how_it_works=out.get("how_it_works")))
                    job.progress += 1
                    db.commit()
            job.status, job.finished_at = "done", now_iso()
            db.commit()
        except Exception as e:
            job.status, job.error, job.finished_at = "error", str(e), now_iso()
            db.commit()
            return

        job = db.scalar(select(Job).where(Job.session_id == session_id, Job.kind == "renders"))
        job.status, job.started_at = "running", now_iso()
        db.commit()
        try:
            for concept in db.scalars(select(Concept).where(Concept.session_id == session_id).order_by(Concept.id)).all():
                existing = {r.kind: r for r in db.scalars(select(Render).where(Render.concept_id == concept.id))}
                if all(existing.get(k) and existing[k].status == "ok" for k in render_kinds):
                    continue
                db.commit()
                pr = None
                for attempt in (1, 2):  # one cheap retry before the generic fallback
                    try:
                        pr = claude_json(db, session_id, "renders", "render_prompts", P.RENDER_PROMPTS.format(title=concept.title, object=concept.object, characteristics="; ".join(concept.characteristics or []), party=prob.party, context=prob.context))
                        break
                    except AIError as e:
                        db.commit()
                        log(db, s, "system", "render_prompt_error", {"concept_id": concept.id, "attempt": attempt, "error": str(e)})
                        db.commit()
                if pr is None:
                    # One malformed prompt response must not sink the whole job.
                    desc = f"{concept.title}: {concept.object}. " + "; ".join(concept.characteristics or [])
                    pr = {
                        "product": f"Photorealistic studio product photograph, three-quarter view, neutral background, soft lighting, no text. {desc}",
                        "in_use": f"Photorealistic candid documentary photograph of this in everyday use by {prob.party}, {prob.context}, natural light, no text, no close-up faces. {desc}",
                    }
                for kind in render_kinds:
                    prompt = pr.get(kind) or f"{concept.title}: {concept.object}"
                    rel = Path(str(session_id)) / f"c{concept.id}_{kind}.png"
                    r = existing.get(kind) or Render(session_id=session_id, concept_id=concept.id, kind=kind, prompt=prompt, provider="mock" if config.mock else "openai", model="placeholder" if config.mock else config.image_model)
                    r.prompt = prompt
                    db.add(r)
                    db.commit()  # commit, not flush: nothing may hold the write lock during the image call
                    try:
                        generate_image(db, session_id, "renders", prompt, config.image_dir / rel,
                                       quality=config.image_quality_product if kind == "product" else config.image_quality_in_use)
                        r.file_path, r.status = rel.as_posix(), "ok"
                    except Exception as e:
                        r.status, r.error = "error", str(e)
                    job.progress += 1
                    db.commit()
            job.status, job.finished_at = "done", now_iso()
            db.commit()
        except Exception as e:
            job.status, job.error, job.finished_at = "error", str(e), now_iso()
            db.commit()


# --- review-only history -----------------------------------------------------------------------------------

def history(db: Session, s: StudySession) -> dict:
    """What the participant has already done, for read-only review. Never includes
    AI-generated ideas: those are rated blind."""
    stage_idx = STAGES.index(s.stage) if s.stage in STAGES else 0

    def done(st: str) -> bool:
        return STAGES.index(st) < stage_idx

    out: dict = {"stage": s.stage, "substage": s.substage, "pages": []}
    if done("issue"):
        out["pages"].append({"key": "issue", "label": "Your issue", "issue_inputs": [{"text": r.text, "input_mode": r.input_mode} for r in db.scalars(select(IssueInput).where(IssueInput.session_id == s.id).order_by(IssueInput.id))]})
    if done("cae"):
        out["pages"].append({"key": "cae", "label": "Structure", "issues": [{"id": r.id, "headline": r.headline, "cause": r.cause, "affect": r.affect, "effect": r.effect, "confirmed": r.confirmed} for r in db.scalars(select(CAEIssue).where(CAEIssue.session_id == s.id).order_by(CAEIssue.ordinal))]})
    if done("problems"):
        out["pages"].append({"key": "problems", "label": "Problem", "problems": [{"id": r.id, "statement": r.statement, "rationale": r.rationale, "selected": r.selected} for r in db.scalars(select(Problem).where(Problem.session_id == s.id).order_by(Problem.ordinal))]})
    if done("aopc"):
        try:
            p = selected_problem(db, s)
            out["pages"].append({"key": "aopc", "label": "Define", "problem": {"statement": p.statement, "action": p.action, "object": p.object, "party": p.party, "context": p.context}})
        except WorkflowError:
            pass
    if done("traditional"):
        out["pages"].append({"key": "traditional", "label": "Your ideas", "ideas": [{"title": i.title, "raw_text": i.raw_text, "principle": i.principle, "phenomenon": i.phenomenon} for i in db.scalars(select(Idea).where(Idea.session_id == s.id, Idea.condition == "traditional").order_by(Idea.ordinal))]})
    # Inspider steps already passed, within the current condition or an earlier one.
    insp_stage = next((st for st, c in zip(("auto_1", "auto_2"), s.condition_order[1:]) if c == "inspider"), None)
    if insp_stage:
        passed = done(insp_stage)
        sub_idx = INSPIDER_STEPS.index(s.substage) if (s.stage == insp_stage and s.substage in INSPIDER_STEPS) else -1

        def step_done(step: str) -> bool:
            return passed or sub_idx > INSPIDER_STEPS.index(step)

        kws = db.scalars(select(Keyword).where(Keyword.session_id == s.id).order_by(Keyword.id)).all()
        by_id = {k.id: k for k in kws}
        if step_done("keywords"):
            out["pages"].append({"key": "keywords", "label": "Keywords", "keywords": [{"lemma": k.resolved_lemma or k.text, "source": k.source, "rationale": k.rationale, "selected": k.selected} for k in kws if k.source in ("ai", "user")]})
        if step_done("neighbours"):
            out["pages"].append({"key": "neighbours", "label": "Web strands", "neighbours": [{"lemma": k.resolved_lemma, "parent_lemma": by_id[k.parent_keyword_id].resolved_lemma if k.parent_keyword_id in by_id else None, "sim": k.similarity_to_parent} for k in kws if k.source == "neighbour"]})
        if step_done("select"):
            out["pages"].append({"key": "select", "label": "Chosen verbs", "kept": [k.resolved_lemma for k in kws if k.final], "dropped": [k.resolved_lemma for k in kws if k.selected and k.node_id and not k.final]})
        if step_done("phenomena"):
            out["pages"].append({"key": "phenomena", "label": "Phenomena", "groups": phenomena_view(db, s)["groups"]})
    return out


def job_status(db: Session, s: StudySession) -> dict:
    return {j.kind: {"status": j.status, "progress": j.progress, "total": j.total, "error": j.error} for j in db.scalars(select(Job).where(Job.session_id == s.id))}


# --- rating -------------------------------------------------------------------------------------------

def _deck(db: Session, s: StudySession, target_type: str) -> list[dict]:
    """The blind, shuffled deck. Same order every time for a session (seeded)."""
    rng = random.Random(s.shuffle_seed + {"idea": 1, "concept": 2, "render": 3}[target_type])
    if target_type == "idea":
        items = [{"id": i.id, "title": i.title, "principle": i.principle, "phenomenon": i.phenomenon, "_cond": i.condition} for i in db.scalars(select(Idea).where(Idea.session_id == s.id))]
    elif target_type == "concept":
        items = [{"id": c.id, "title": c.title, "object": c.object, "characteristics": c.characteristics, "how_it_works": c.how_it_works} for c in db.scalars(select(Concept).where(Concept.session_id == s.id))]
    else:
        items = []
        for c in db.scalars(select(Concept).where(Concept.session_id == s.id)):
            renders = db.scalars(select(Render).where(Render.concept_id == c.id, Render.status == "ok")).all()
            if renders:
                items.append({"id": c.id, "title": c.title, "object": c.object, "images": [{"kind": r.kind, "url": f"/api/images/{r.file_path}"} for r in renders]})
    rng.shuffle(items)
    rated = {r.target_id: r for r in db.scalars(select(Rating).where(Rating.session_id == s.id, Rating.target_type == target_type))}
    for pos, it in enumerate(items):
        it["display_order"] = pos
        it["rated"] = it["id"] in rated
        # The values, so a participant can step back to an earlier card and change them.
        r = rated.get(it["id"])
        it["rating"] = {"novelty": r.novelty, "usefulness": r.usefulness, "feasibility": r.feasibility, "comment": r.comment} if r else None
        it.pop("_cond", None)  # never sent to the participant
    return items


def rating_deck(db: Session, s: StudySession) -> dict:
    stage_to_type = {"rate_ideas": "idea", "rate_concepts": "concept", "rate_renders": "render"}
    t = stage_to_type.get(s.stage)
    if not t:
        raise WorkflowError("Not in a rating stage.", 409)
    jobs = job_status(db, s)
    ready = True
    waiting_on = None
    if t == "concept" and jobs.get("concepts", {}).get("status") != "done":
        ready, waiting_on = False, jobs.get("concepts")
    if t == "render" and jobs.get("renders", {}).get("status") != "done":
        ready, waiting_on = False, jobs.get("renders")
    return {"target_type": t, "ready": ready, "waiting_on": waiting_on, "items": _deck(db, s, t) if ready else []}


def submit_rating(db: Session, s: StudySession, target_type: str, target_id: int, novelty: int, usefulness: int, feasibility: int, comment: str | None, display_order: int, response_ms: int | None) -> None:
    expected = {"rate_ideas": "idea", "rate_concepts": "concept", "rate_renders": "render"}.get(s.stage)
    if expected != target_type:
        raise WorkflowError(f"The session is rating {expected}, not {target_type}.", 409)
    for v in (novelty, usefulness, feasibility):
        if not isinstance(v, int) or not 1 <= v <= 5:
            raise WorkflowError("Ratings must be whole numbers from 1 to 5.")
    valid = {it["id"] for it in _deck(db, s, target_type)}
    if target_id not in valid:
        raise WorkflowError("That item is not in this session's deck.", 404)
    row = db.scalar(select(Rating).where(Rating.session_id == s.id, Rating.target_type == target_type, Rating.target_id == target_id))
    edited = row is not None
    if not row:
        row = Rating(session_id=s.id, target_type=target_type, target_id=target_id, display_order=display_order, novelty=novelty, usefulness=usefulness, feasibility=feasibility)
        db.add(row)
    row.novelty, row.usefulness, row.feasibility, row.comment, row.response_ms = novelty, usefulness, feasibility, comment, response_ms
    log(db, s, "user", "rating_edited" if edited else "rating", {"target_type": target_type, "target_id": target_id, "novelty": novelty, "usefulness": usefulness, "feasibility": feasibility, "comment": comment})


def complete_rating_stage(db: Session, s: StudySession) -> None:
    deck = rating_deck(db, s)
    if not deck["ready"]:
        raise WorkflowError("Still generating.", 409)
    if any(not it["rated"] for it in deck["items"]):
        raise WorkflowError("Rate every item before continuing.")
    advance(db, s)
