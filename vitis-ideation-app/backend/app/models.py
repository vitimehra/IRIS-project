"""
VITIS schema.

Everything a participant does, and everything the AI produces for them, is a
row here. The `events` table is the transcript: a single ordered log per session
of every user input and AI output, which is what the console replays.
"""
from __future__ import annotations

from sqlalchemy import Boolean, Float, ForeignKey, Index, Integer, LargeBinary, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base, JSONText, now_iso


# --- experimenters -----------------------------------------------------------

class Experimenter(Base):
    __tablename__ = "experimenters"
    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(40), unique=True)
    display_name: Mapped[str] = mapped_column(String(120))
    password_hash: Mapped[str] = mapped_column(String(200))
    role: Mapped[str] = mapped_column(String(20), default="experimenter")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[str] = mapped_column(String(40), default=now_iso)
    last_login_at: Mapped[str | None] = mapped_column(String(40))


class ExperimenterToken(Base):
    __tablename__ = "experimenter_tokens"
    id: Mapped[int] = mapped_column(primary_key=True)
    experimenter_id: Mapped[int] = mapped_column(ForeignKey("experimenters.id", ondelete="CASCADE"))
    token_hash: Mapped[str] = mapped_column(String(80), unique=True)
    created_at: Mapped[str] = mapped_column(String(40), default=now_iso)
    expires_at: Mapped[str] = mapped_column(String(40))
    revoked_at: Mapped[str | None] = mapped_column(String(40))


class AuditLog(Base):
    __tablename__ = "audit_log"
    id: Mapped[int] = mapped_column(primary_key=True)
    experimenter_id: Mapped[int | None] = mapped_column(ForeignKey("experimenters.id", ondelete="SET NULL"))
    actor: Mapped[str] = mapped_column(String(120))
    action: Mapped[str] = mapped_column(String(80))
    target_type: Mapped[str | None] = mapped_column(String(40))
    target_id: Mapped[str | None] = mapped_column(String(80))
    details: Mapped[dict | None] = mapped_column(JSONText)
    created_at: Mapped[str] = mapped_column(String(40), default=now_iso)


# --- participants --------------------------------------------------------------

class Participant(Base):
    __tablename__ = "participants"
    id: Mapped[int] = mapped_column(primary_key=True)
    number: Mapped[int] = mapped_column(Integer, unique=True)       # 1, 2, 3 ... drives P01 and counterbalance
    username: Mapped[str] = mapped_column(String(20), unique=True)  # P01
    passcode: Mapped[str] = mapped_column(String(10), unique=True)  # 5 chars, handed to the participant
    name: Mapped[str | None] = mapped_column(String(120))
    age: Mapped[int | None] = mapped_column(Integer)
    gender: Mapped[str | None] = mapped_column(String(40))
    occupation: Mapped[str | None] = mapped_column(String(120))
    education: Mapped[str | None] = mapped_column(String(120))
    email: Mapped[str | None] = mapped_column(String(160))
    demographics: Mapped[dict | None] = mapped_column(JSONText)      # anything else the experimenter typed
    condition_order: Mapped[list] = mapped_column(JSONText)          # ["traditional","modern","inspider"]
    settings: Mapped[dict | None] = mapped_column(JSONText)          # per-participant overrides of study defaults
    consented_at: Mapped[str | None] = mapped_column(String(40))
    consent_version: Mapped[str | None] = mapped_column(String(20))
    status: Mapped[str] = mapped_column(String(20), default="created")  # created | active | completed | withdrawn
    notes: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("experimenters.id", ondelete="SET NULL"))
    created_at: Mapped[str] = mapped_column(String(40), default=now_iso)
    last_seen_at: Mapped[str | None] = mapped_column(String(40))

    sessions: Mapped[list["StudySession"]] = relationship(back_populates="participant", cascade="all, delete-orphan")


class ParticipantToken(Base):
    __tablename__ = "participant_tokens"
    id: Mapped[int] = mapped_column(primary_key=True)
    participant_id: Mapped[int] = mapped_column(ForeignKey("participants.id", ondelete="CASCADE"))
    token_hash: Mapped[str] = mapped_column(String(80), unique=True)
    created_at: Mapped[str] = mapped_column(String(40), default=now_iso)
    expires_at: Mapped[str] = mapped_column(String(40))
    revoked_at: Mapped[str | None] = mapped_column(String(40))


# --- the study session ----------------------------------------------------------

STAGES = [
    "issue",          # participant describes their issue
    "cae",            # AI structures; participant confirms
    "problems",       # AI lists problems; participant selects one
    "aopc",           # AI structures the chosen problem; participant confirms
    "traditional",    # participant writes ideas by hand
    "auto_1",         # first automatic condition (modern or inspider, counterbalanced)
    "auto_2",         # second automatic condition
    "rate_ideas",     # all ideas pooled, shuffled, blind
    "rate_concepts",
    "rate_renders",
    "done",
]

# Sub-stages inside the inspider condition
# "select": the pool (proposed + picked neighbours) is cut to the most mutually
# distant few before any phenomena are searched; the participant may swap one.
INSPIDER_STEPS = ["keywords", "neighbours", "select", "phenomena", "ideas"]


class StudySession(Base):
    __tablename__ = "study_sessions"
    id: Mapped[int] = mapped_column(primary_key=True)
    participant_id: Mapped[int] = mapped_column(ForeignKey("participants.id", ondelete="CASCADE"))
    number: Mapped[int] = mapped_column(Integer, default=1)
    stage: Mapped[str] = mapped_column(String(30), default="issue")
    substage: Mapped[str | None] = mapped_column(String(30))   # inspider step, when in that condition
    condition_order: Mapped[list] = mapped_column(JSONText)
    shuffle_seed: Mapped[int] = mapped_column(Integer)
    settings: Mapped[dict] = mapped_column(JSONText)
    started_at: Mapped[str] = mapped_column(String(40), default=now_iso)
    completed_at: Mapped[str | None] = mapped_column(String(40))
    stage_timings: Mapped[dict | None] = mapped_column(JSONText)  # stage -> {entered, left}

    participant: Mapped["Participant"] = relationship(back_populates="sessions")

    def current_condition(self) -> str | None:
        if self.stage == "traditional":
            return "traditional"
        if self.stage == "auto_1":
            return self.condition_order[1]
        if self.stage == "auto_2":
            return self.condition_order[2]
        return None


class Event(Base):
    """The transcript. One row per thing that happened, in order."""
    __tablename__ = "events"
    id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("study_sessions.id", ondelete="CASCADE"))
    stage: Mapped[str] = mapped_column(String(30))
    actor: Mapped[str] = mapped_column(String(12))        # user | ai | system
    kind: Mapped[str] = mapped_column(String(40))         # issue_text | cae_generated | cae_confirmed | ...
    payload: Mapped[dict | None] = mapped_column(JSONText)
    created_at: Mapped[str] = mapped_column(String(40), default=now_iso)


Index("ix_events_session", Event.session_id, Event.id)


class AICall(Base):
    """Every model call, verbatim, so nothing the AI said is ever unrecoverable."""
    __tablename__ = "ai_calls"
    id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[int | None] = mapped_column(ForeignKey("study_sessions.id", ondelete="CASCADE"))
    stage: Mapped[str] = mapped_column(String(40))
    provider: Mapped[str] = mapped_column(String(20))     # anthropic | openai | mock
    model: Mapped[str] = mapped_column(String(80))
    purpose: Mapped[str] = mapped_column(String(60))
    request: Mapped[dict | None] = mapped_column(JSONText)
    response: Mapped[dict | None] = mapped_column(JSONText)
    input_tokens: Mapped[int | None] = mapped_column(Integer)
    output_tokens: Mapped[int | None] = mapped_column(Integer)
    latency_ms: Mapped[int | None] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(12))       # ok | error
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[str] = mapped_column(String(40), default=now_iso)


Index("ix_ai_calls_session", AICall.session_id)


class IssueInput(Base):
    __tablename__ = "issue_inputs"
    id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("study_sessions.id", ondelete="CASCADE"))
    text: Mapped[str] = mapped_column(Text)
    input_mode: Mapped[str] = mapped_column(String(12))   # typed | speech | mixed
    duration_ms: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[str] = mapped_column(String(40), default=now_iso)


class CAEIssue(Base):
    __tablename__ = "cae_issues"
    id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("study_sessions.id", ondelete="CASCADE"))
    ordinal: Mapped[int] = mapped_column(Integer)
    headline: Mapped[str] = mapped_column(Text)
    cause: Mapped[str] = mapped_column(Text)
    affect: Mapped[str] = mapped_column(Text)
    effect: Mapped[str] = mapped_column(Text)
    evidence: Mapped[str | None] = mapped_column(Text)
    ai_version: Mapped[dict | None] = mapped_column(JSONText)   # what the AI wrote, before any edit
    edited: Mapped[bool] = mapped_column(Boolean, default=False)
    confirmed: Mapped[bool] = mapped_column(Boolean, default=False)


class Problem(Base):
    __tablename__ = "problems"
    id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("study_sessions.id", ondelete="CASCADE"))
    ordinal: Mapped[int] = mapped_column(Integer)
    statement: Mapped[str] = mapped_column(Text)
    rationale: Mapped[str | None] = mapped_column(Text)
    source_issue_ids: Mapped[list | None] = mapped_column(JSONText)
    selected: Mapped[bool] = mapped_column(Boolean, default=False)
    # AOPC, filled in for the selected problem
    action: Mapped[str | None] = mapped_column(Text)
    object: Mapped[str | None] = mapped_column(Text)
    party: Mapped[str | None] = mapped_column(Text)
    context: Mapped[str | None] = mapped_column(Text)
    aopc_ai_version: Mapped[dict | None] = mapped_column(JSONText)
    aopc_edited: Mapped[bool] = mapped_column(Boolean, default=False)
    aopc_confirmed: Mapped[bool] = mapped_column(Boolean, default=False)


# --- inspider condition -----------------------------------------------------------

class Keyword(Base):
    __tablename__ = "keywords"
    id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("study_sessions.id", ondelete="CASCADE"))
    text: Mapped[str] = mapped_column(String(80))                  # as proposed or typed
    source: Mapped[str] = mapped_column(String(12))                # ai | user | neighbour
    rationale: Mapped[str | None] = mapped_column(Text)
    parent_keyword_id: Mapped[int | None] = mapped_column(ForeignKey("keywords.id", ondelete="SET NULL"))
    node_id: Mapped[int | None] = mapped_column(ForeignKey("inspider_nodes.id", ondelete="SET NULL"))
    resolved_lemma: Mapped[str | None] = mapped_column(String(80))
    resolution: Mapped[str | None] = mapped_column(String(20))     # exact | form | fuzzy | embedding | none
    resolution_score: Mapped[float | None] = mapped_column(Float)
    similarity_to_parent: Mapped[float | None] = mapped_column(Float)
    selected: Mapped[bool] = mapped_column(Boolean, default=True)
    final: Mapped[bool] = mapped_column(Boolean, default=False)    # kept by the diversity selection (see workflow.select_keywords)
    ordinal: Mapped[int] = mapped_column(Integer, default=0)


class Phenomenon(Base):
    """
    A world phenomenon attached to a verb. These are the evolving part of the
    web: every participant's run appends new ones, and every later participant
    who reaches that verb sees them.
    """
    __tablename__ = "phenomena"
    id: Mapped[int] = mapped_column(primary_key=True)
    node_id: Mapped[int] = mapped_column(ForeignKey("inspider_nodes.id", ondelete="CASCADE"))
    keyword_text: Mapped[str] = mapped_column(String(80))
    title: Mapped[str] = mapped_column(Text)
    description: Mapped[str] = mapped_column(Text)
    domain: Mapped[str | None] = mapped_column(String(80))         # nature | physics | biology | engineering | ...
    source_url: Mapped[str | None] = mapped_column(Text)
    source_title: Mapped[str | None] = mapped_column(Text)
    embedding: Mapped[bytes | None] = mapped_column(LargeBinary)   # float16, same model as the web
    created_by_session: Mapped[int | None] = mapped_column(ForeignKey("study_sessions.id", ondelete="SET NULL"))
    created_at: Mapped[str] = mapped_column(String(40), default=now_iso)


Index("ix_phenomena_node", Phenomenon.node_id)


class SessionPhenomenon(Base):
    """Which phenomena a session saw, and whether it generated them."""
    __tablename__ = "session_phenomena"
    id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("study_sessions.id", ondelete="CASCADE"))
    keyword_id: Mapped[int] = mapped_column(ForeignKey("keywords.id", ondelete="CASCADE"))
    phenomenon_id: Mapped[int] = mapped_column(ForeignKey("phenomena.id", ondelete="CASCADE"))
    fresh: Mapped[bool] = mapped_column(Boolean)   # generated in this session vs inherited


# --- ideas, concepts, renders --------------------------------------------------------

class Idea(Base):
    __tablename__ = "ideas"
    id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("study_sessions.id", ondelete="CASCADE"))
    condition: Mapped[str] = mapped_column(String(12))            # traditional | modern | inspider
    ordinal: Mapped[int] = mapped_column(Integer)
    title: Mapped[str] = mapped_column(Text)
    raw_text: Mapped[str | None] = mapped_column(Text)            # traditional: what the participant typed
    principle: Mapped[str] = mapped_column(Text)                  # PP
    phenomenon: Mapped[str] = mapped_column(Text)
    inspired_by: Mapped[list | None] = mapped_column(JSONText)    # inspider: phenomenon ids / keywords used
    created_at: Mapped[str] = mapped_column(String(40), default=now_iso)


Index("ix_ideas_session", Idea.session_id)


class Concept(Base):
    __tablename__ = "concepts"
    id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("study_sessions.id", ondelete="CASCADE"))
    idea_id: Mapped[int] = mapped_column(ForeignKey("ideas.id", ondelete="CASCADE"))
    ordinal: Mapped[int] = mapped_column(Integer, default=0)
    title: Mapped[str] = mapped_column(Text)
    object: Mapped[str] = mapped_column(Text)                     # OC
    characteristics: Mapped[list] = mapped_column(JSONText)       # list of strings: shape, size, colour, material...
    how_it_works: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[str] = mapped_column(String(40), default=now_iso)


class Render(Base):
    __tablename__ = "renders"
    id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("study_sessions.id", ondelete="CASCADE"))
    concept_id: Mapped[int] = mapped_column(ForeignKey("concepts.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(12))                 # product | in_use
    prompt: Mapped[str] = mapped_column(Text)
    provider: Mapped[str] = mapped_column(String(20))
    model: Mapped[str] = mapped_column(String(60))
    file_path: Mapped[str | None] = mapped_column(Text)           # relative to IMAGE_DIR
    status: Mapped[str] = mapped_column(String(12), default="pending")  # pending | ok | error
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[str] = mapped_column(String(40), default=now_iso)


class Rating(Base):
    __tablename__ = "ratings"
    id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("study_sessions.id", ondelete="CASCADE"))
    target_type: Mapped[str] = mapped_column(String(12))          # idea | concept | render
    target_id: Mapped[int] = mapped_column(Integer)
    display_order: Mapped[int] = mapped_column(Integer)           # position in the shuffled deck
    novelty: Mapped[int] = mapped_column(Integer)
    usefulness: Mapped[int] = mapped_column(Integer)
    feasibility: Mapped[int] = mapped_column(Integer)
    comment: Mapped[str | None] = mapped_column(Text)
    response_ms: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[str] = mapped_column(String(40), default=now_iso)
    __table_args__ = (UniqueConstraint("session_id", "target_type", "target_id"),)


class Job(Base):
    """Background generation (concepts, renders) so the participant can rate meanwhile."""
    __tablename__ = "jobs"
    id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("study_sessions.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(20))                 # concepts | renders
    status: Mapped[str] = mapped_column(String(12), default="queued")  # queued | running | done | error
    progress: Mapped[int] = mapped_column(Integer, default=0)
    total: Mapped[int] = mapped_column(Integer, default=0)
    error: Mapped[str | None] = mapped_column(Text)
    started_at: Mapped[str | None] = mapped_column(String(40))
    finished_at: Mapped[str | None] = mapped_column(String(40))


# --- the inspider web, imported --------------------------------------------------------

class InspiderNode(Base):
    __tablename__ = "inspider_nodes"
    id: Mapped[int] = mapped_column(primary_key=True)             # = inspider verb id for verbs
    lemma: Mapped[str] = mapped_column(String(120), index=True)
    node_type: Mapped[str] = mapped_column(String(12), default="verb")  # verb | phenomenon
    gloss: Mapped[str | None] = mapped_column(Text)
    forms: Mapped[list | None] = mapped_column(JSONText)
    cluster_id: Mapped[int | None] = mapped_column(Integer)
    cluster_name: Mapped[str | None] = mapped_column(String(160))
    zipf: Mapped[float | None] = mapped_column(Float)
    unverified: Mapped[bool] = mapped_column(Boolean, default=False)
    x: Mapped[float | None] = mapped_column(Float)
    y: Mapped[float | None] = mapped_column(Float)
    in_degree: Mapped[int | None] = mapped_column(Integer)
    phenomenon_count: Mapped[int] = mapped_column(Integer, default=0)


class InspiderEdge(Base):
    __tablename__ = "inspider_edges"
    id: Mapped[int] = mapped_column(primary_key=True)
    src: Mapped[int] = mapped_column(Integer, index=True)
    dst: Mapped[int] = mapped_column(Integer, index=True)
    sim: Mapped[float] = mapped_column(Float)
    rank: Mapped[int] = mapped_column(Integer)
    edge_type: Mapped[str] = mapped_column(String(12), default="similarity")  # similarity | phenomenon


class StudySetting(Base):
    """Study-wide switches the experimenter flips in the console (e.g. render_in_use)."""
    __tablename__ = "study_settings"
    key: Mapped[str] = mapped_column(String(60), primary_key=True)
    value: Mapped[dict | None] = mapped_column(JSONText)


class InspiderMeta(Base):
    __tablename__ = "inspider_meta"
    key: Mapped[str] = mapped_column(String(60), primary_key=True)
    value: Mapped[dict | None] = mapped_column(JSONText)
