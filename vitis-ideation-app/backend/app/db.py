"""
SQLAlchemy engine and session.

SQLite today, Postgres later: the only thing that changes is DATABASE_URL.
Everything below is portable - no SQLite-only types, JSON stored as text via a
TypeDecorator, ids as integers, timestamps as ISO strings in UTC.
"""
from __future__ import annotations

import json
import time
from contextlib import contextmanager
from datetime import datetime, timezone

from sqlalchemy import Text, create_engine, event
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.pool import NullPool
from sqlalchemy.types import TypeDecorator

from .config import config


class Base(DeclarativeBase):
    pass


class JSONText(TypeDecorator):
    """JSON in a TEXT column. Works identically on SQLite and Postgres."""

    impl = Text
    cache_ok = True

    def process_bind_param(self, value, dialect):
        return None if value is None else json.dumps(value, ensure_ascii=False)

    def process_result_value(self, value, dialect):
        return None if value is None else json.loads(value)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def is_lock_error(exc: BaseException) -> bool:
    msg = str(exc).lower()
    return "database is locked" in msg or "database is busy" in msg


def retry_locked(fn, *, attempts: int = 12, wait: float = 0.05):
    """SQLite on Windows loses to a long writer; wait and try again."""
    delay = wait
    for i in range(attempts):
        try:
            return fn()
        except OperationalError as e:
            if not is_lock_error(e) or i == attempts - 1:
                raise
            time.sleep(delay)
            delay = min(delay * 2, 1.5)


_sqlite = config.database_url.startswith("sqlite")
connect_args = {"check_same_thread": False, "timeout": 10} if _sqlite else {}
engine_kw: dict = {"connect_args": connect_args, "future": True}
if _sqlite:
    engine_kw["poolclass"] = NullPool
engine = create_engine(config.database_url, **engine_kw)

if _sqlite:

    @event.listens_for(engine, "connect")
    def _sqlite_pragmas(dbapi_conn, _record):
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA journal_mode=WAL")
        cur.execute("PRAGMA synchronous=NORMAL")
        cur.execute("PRAGMA foreign_keys=ON")
        cur.execute("PRAGMA busy_timeout=10000")
        cur.close()


SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, future=True)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@contextmanager
def session_scope() -> Session:
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


# Columns added after the first release. create_all() only makes new tables, so
# an existing database (the Railway volume) gets these with a plain ALTER.
_ADDED_COLUMNS = {
    "keywords": [("final", "BOOLEAN NOT NULL DEFAULT FALSE")],
}


def ensure_columns() -> None:
    from sqlalchemy import inspect, text

    insp = inspect(engine)
    for table, cols in _ADDED_COLUMNS.items():
        if not insp.has_table(table):
            continue
        have = {c["name"] for c in insp.get_columns(table)}
        with engine.begin() as conn:
            for name, ddl in cols:
                if name not in have:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}"))
