"""
Creates or updates the two experimenter accounts from the environment.

    EXPERIMENTER_VITI_PASSWORD=... EXPERIMENTER_SANKAR_PASSWORD=... python -m app.seed

Passwords are never printed. Re-run to rotate.
"""
from __future__ import annotations

import os
import sys

from sqlalchemy import select

from .db import Base, engine, ensure_columns, session_scope
from .models import Experimenter
from .services.auth import hash_password

ACCOUNTS = [("viti", "Viti Mehra", "EXPERIMENTER_VITI_PASSWORD"), ("sankar", "Sankar Balasubramanian", "EXPERIMENTER_SANKAR_PASSWORD")]


def ensure_accounts() -> int:
    """Create missing experimenter accounts from the environment. Does not rotate."""
    Base.metadata.create_all(engine)
    ensure_columns()
    created = 0
    with session_scope() as db:
        for username, display, env in ACCOUNTS:
            pw = os.environ.get(env, "")
            if not pw:
                continue
            if db.scalar(select(Experimenter.id).where(Experimenter.username == username)):
                continue
            db.add(Experimenter(username=username, display_name=display, password_hash=hash_password(pw)))
            print(f"[seed] created {username}")
            created += 1
    if created == 0:
        with session_scope() as db:
            if db.scalar(select(Experimenter.id)):
                print("[seed] experimenter accounts already present")
            else:
                print("[seed] no experimenter accounts: set EXPERIMENTER_VITI_PASSWORD / EXPERIMENTER_SANKAR_PASSWORD")
    return created


def main() -> int:
    Base.metadata.create_all(engine)
    ensure_columns()
    changed = 0
    with session_scope() as db:
        for username, display, env in ACCOUNTS:
            pw = os.environ.get(env, "")
            if not pw:
                print(f"[seed] {env} not set, skipping {username}")
                continue
            e = db.scalar(select(Experimenter).where(Experimenter.username == username))
            if e:
                e.password_hash, e.display_name, e.is_active = hash_password(pw), display, True
                print(f"[seed] updated {username}")
            else:
                db.add(Experimenter(username=username, display_name=display, password_hash=hash_password(pw)))
                print(f"[seed] created {username}")
            changed += 1
    if not changed:
        print("[seed] nothing to do")
    return 0


if __name__ == "__main__":
    sys.exit(main())
