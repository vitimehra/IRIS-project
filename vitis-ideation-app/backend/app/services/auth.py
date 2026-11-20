from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone

import bcrypt
from fastapi import Depends, Header, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..config import config
from ..db import get_db, now_iso
from ..models import AuditLog, Experimenter, ExperimenterToken, Participant, ParticipantToken

# Passcode alphabet: no 0/O, 1/I/L - the code is read off a printed slip.
CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"


def _hash_token(token: str) -> str:
    return hashlib.sha256(f"{config.secret_salt}:{token}".encode()).hexdigest()


def _expiry(hours: int) -> str:
    return (datetime.now(timezone.utc) + timedelta(hours=hours)).isoformat(timespec="seconds")


def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt(12)).decode()


def check_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode(), hashed.encode())
    except Exception:
        return False


def new_passcode(db: Session) -> str:
    """5 characters, unique across all participants ever created."""
    for _ in range(100):
        code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(5))
        if not db.scalar(select(Participant.id).where(Participant.passcode == code)):
            return code
    raise RuntimeError("Could not allocate a unique passcode.")


def next_participant_number(db: Session) -> int:
    return (db.scalar(select(func.max(Participant.number))) or 0) + 1


def condition_order_for(number: int) -> list[str]:
    """Traditional always first; the two automatic conditions counterbalanced by parity."""
    return ["traditional", "modern", "inspider"] if number % 2 == 1 else ["traditional", "inspider", "modern"]


# --- participant --------------------------------------------------------------------------

def participant_login(db: Session, username: str, passcode: str) -> tuple[Participant, str]:
    p = db.scalar(select(Participant).where(Participant.username == username.strip().upper()))
    if not p or p.passcode != passcode.strip().upper() or p.status == "withdrawn":
        raise HTTPException(401, "Username or passcode is incorrect.")
    token = secrets.token_urlsafe(32)
    db.add(ParticipantToken(participant_id=p.id, token_hash=_hash_token(token), expires_at=_expiry(config.participant_ttl_hours)))
    p.last_seen_at = now_iso()
    db.flush()
    return p, token


def current_participant(authorization: str | None = Header(default=None), db: Session = Depends(get_db)) -> Participant:
    token = _bearer(authorization)
    row = db.scalar(select(ParticipantToken).where(ParticipantToken.token_hash == _hash_token(token), ParticipantToken.revoked_at.is_(None), ParticipantToken.expires_at > now_iso()))
    if not row:
        raise HTTPException(401, "Session expired. Please log in again.")
    p = db.get(Participant, row.participant_id)
    if not p or p.status == "withdrawn":
        raise HTTPException(401, "Participant not found.")
    now = now_iso()
    if (p.last_seen_at or "")[:16] != now[:16]:
        p.last_seen_at = now
    return p


# --- experimenter --------------------------------------------------------------------------

def experimenter_login(db: Session, username: str, password: str) -> tuple[Experimenter, str]:
    e = db.scalar(select(Experimenter).where(Experimenter.username == username.strip().lower(), Experimenter.is_active == True))  # noqa: E712
    dummy = "$2b$12$C6UzMDM.H6dfI/f/IKcEeO5sGqbz0G2Qq9cJ9J1Wm0a3k7T3s9y1W"
    ok = check_password(password, e.password_hash if e else dummy)
    if not e or not ok:
        raise HTTPException(401, "Incorrect username or password.")
    token = secrets.token_urlsafe(32)
    db.add(ExperimenterToken(experimenter_id=e.id, token_hash=_hash_token(token), expires_at=_expiry(config.experimenter_ttl_hours)))
    e.last_login_at = now_iso()
    db.add(AuditLog(experimenter_id=e.id, actor=e.display_name, action="login"))
    db.flush()
    return e, token


def current_experimenter(authorization: str | None = Header(default=None), db: Session = Depends(get_db)) -> Experimenter:
    token = _bearer(authorization)
    row = db.scalar(select(ExperimenterToken).where(ExperimenterToken.token_hash == _hash_token(token), ExperimenterToken.revoked_at.is_(None), ExperimenterToken.expires_at > now_iso()))
    if not row:
        raise HTTPException(401, "Experimenter session expired.")
    e = db.get(Experimenter, row.experimenter_id)
    if not e or not e.is_active:
        raise HTTPException(401, "Experimenter not found.")
    return e


def revoke_experimenter(db: Session, authorization: str | None) -> None:
    token = _bearer(authorization)
    row = db.scalar(select(ExperimenterToken).where(ExperimenterToken.token_hash == _hash_token(token)))
    if row:
        row.revoked_at = now_iso()


def audit(db: Session, e: Experimenter, action: str, target_type: str | None = None, target_id=None, details: dict | None = None) -> None:
    db.add(AuditLog(experimenter_id=e.id, actor=e.display_name, action=action, target_type=target_type, target_id=str(target_id) if target_id is not None else None, details=details))


def _bearer(authorization: str | None) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Not authenticated.")
    return authorization[7:].strip()
