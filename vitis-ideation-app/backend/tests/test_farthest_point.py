"""Diversity selection must treat keyword row ids as labels, not numpy indexes."""
from __future__ import annotations

import os
import tempfile
from pathlib import Path

TMP = Path(tempfile.mkdtemp(prefix="vitis-fp-"))
os.environ.setdefault("AI_PROVIDER", "mock")
os.environ.setdefault("DATABASE_URL", f"sqlite:///{(TMP / 't.sqlite').as_posix()}")
os.environ.setdefault("IMAGE_DIR", str(TMP / "images"))
os.environ.setdefault("SECRET_SALT", "test")

import numpy as np  # noqa: E402

from app.services.workflow import _farthest_point  # noqa: E402


def test_farthest_point_accepts_sparse_keyword_ids():
    rng = np.random.default_rng(0)
    vectors = {}
    for kid in (10, 20, 30, 40, 50, 60, 70, 80, 90, 100):
        v = rng.normal(size=16).astype(np.float32)
        vectors[kid] = v / np.linalg.norm(v)
    chosen, dist = _farthest_point(vectors, 5)
    assert len(chosen) == 5
    assert len(set(chosen)) == 5
    assert set(chosen) <= set(vectors)
    assert set(dist) == set(vectors)
    assert all(0.0 <= d <= 2.0 for d in dist.values())


def test_farthest_point_k_equals_pool():
    rng = np.random.default_rng(1)
    vectors = {100 + i: rng.normal(size=8).astype(np.float32) for i in range(3)}
    chosen, dist = _farthest_point(vectors, 3)
    assert set(chosen) == set(vectors)
    assert set(dist) == set(vectors)
