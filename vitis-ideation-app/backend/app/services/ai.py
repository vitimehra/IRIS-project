"""
Model calls. Every call - request, response, tokens, latency, errors - is written
to ai_calls before this module returns, so the console can show the exact
prompt behind every sentence a participant saw.

`AI_PROVIDER=mock` swaps in deterministic canned output for the whole study.
That is how the flow is rehearsed and tested without spending, and it is
clearly stamped as `mock` in ai_calls.
"""
from __future__ import annotations

import base64
import hashlib
import io
import json
import re
import time
from pathlib import Path

import numpy as np
from sqlalchemy.orm import Session

from ..config import config
from ..content.prompts import PROMPT_VERSION, SYSTEM
from ..db import SessionLocal, retry_locked
from ..models import AICall


class AIError(RuntimeError):
    pass


def _top_level_objects(text: str) -> list[str]:
    """Every balanced top-level {...} in the text, string-aware."""
    out, depth, start, in_str, esc = [], 0, -1, False, False
    for i, ch in enumerate(text):
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "{":
            if depth == 0:
                start = i
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0 and start >= 0:
                out.append(text[start : i + 1])
                start = -1
    return out


def _parse_json(text: str) -> dict:
    """
    The model is told to return one JSON object. In practice it sometimes
    returns it inside a fence, with prose around it, or - when asked for
    several named fields - as several adjacent objects, one per field. All of
    those are recovered here; only genuinely malformed JSON is an error.
    """
    candidates = [text, *re.findall(r"```(?:json)?\s*([\s\S]*?)```", text)]
    for attempt in candidates:
        try:
            v = json.loads(attempt.strip())
            if isinstance(v, dict):
                return v
        except Exception:
            continue

    objects = []
    for chunk in _top_level_objects(text):
        try:
            v = json.loads(chunk)
            if isinstance(v, dict):
                objects.append(v)
        except Exception:
            continue
    if len(objects) == 1:
        return objects[0]
    if len(objects) > 1:
        merged: dict = {}
        for o in objects:
            for k, val in o.items():
                merged.setdefault(k, val)
        return merged
    raise AIError(f"Model did not return JSON: {text[:300]!r}")


def _log(db: Session, session_id: int | None, stage: str, purpose: str, provider: str, model: str,
         request: dict, response: dict | None, usage: dict, latency_ms: int, error: str | None = None) -> None:
    """
    Record the call. Uses the caller's session when there is one: the row rides
    on the caller's transaction and is committed with the result it belongs to.

    It must NOT open a second connection while the caller holds a flushed but
    uncommitted write - on SQLite that second connection waits on the first
    for the whole busy_timeout and then fails, which is a deadlock with itself.
    A separate session is used only when no caller session exists (background
    workers between transactions).
    """
    row = AICall(
        session_id=session_id, stage=stage, provider=provider, model=model, purpose=purpose,
        request={**request, "prompt_version": PROMPT_VERSION}, response=response,
        input_tokens=usage.get("input_tokens"), output_tokens=usage.get("output_tokens"),
        latency_ms=latency_ms, status="error" if error else "ok", error=error,
    )
    if db is not None:
        db.add(row)
        db.flush()
        return

    s = SessionLocal()
    try:
        s.add(row)
        s.commit()
    except Exception as e:
        s.rollback()
        print(f"[vitis] WARNING: could not log AI call {purpose}: {e}")
    finally:
        s.close()


# --- Claude -------------------------------------------------------------------------

def claude_json(db: Session, session_id: int | None, stage: str, purpose: str, prompt: str,
                web_search: bool = False, max_tokens: int = 4000, model: str | None = None) -> dict:
    """One Claude call expected to return a JSON object. Logged either way.

    The model is chosen per purpose (config.model_for) unless given explicitly.
    """
    if config.mock:
        return _mock_claude(db, session_id, stage, purpose, prompt)

    if not config.anthropic_api_key:
        raise AIError("ANTHROPIC_API_KEY is not set. Put it in .env, or set AI_PROVIDER=mock to rehearse.")

    from anthropic import Anthropic

    model = model or config.model_for(purpose)
    client = Anthropic(api_key=config.anthropic_api_key)
    kwargs: dict = {
        "model": model,
        "max_tokens": max_tokens,
        "system": SYSTEM,
        "messages": [{"role": "user", "content": prompt}],
    }
    if web_search and config.claude_web_search:
        kwargs["tools"] = [{"type": "web_search_20250305", "name": "web_search", "max_uses": config.web_search_max_uses}]

    t0 = time.time()
    request_log = {"system": SYSTEM, "prompt": prompt, "web_search": bool(kwargs.get("tools")), "max_tokens": max_tokens,
                   "max_searches": config.web_search_max_uses if kwargs.get("tools") else 0}

    def _create():
        return client.messages.create(**kwargs)

    # No silent retry-without-tools here: it hid the real error and produced
    # un-cited "phenomena" indistinguishable from searched ones. The workflow
    # does an explicit, logged fallback with a different prompt instead.
    try:
        resp = _create()
    except Exception as e:  # network, auth, rate limit, tool unavailable
        _log(db, session_id, stage, purpose, "anthropic", model, request_log, None, {}, int((time.time() - t0) * 1000), str(e))
        raise AIError(f"Claude call failed: {e}") from e

    latency = int((time.time() - t0) * 1000)
    text_parts, searches, citations = [], [], []
    for block in resp.content:
        btype = getattr(block, "type", "")
        if btype == "text":
            text_parts.append(block.text)
            for c in getattr(block, "citations", None) or []:
                citations.append({"url": getattr(c, "url", None), "title": getattr(c, "title", None)})
        elif btype == "server_tool_use":
            searches.append({"query": getattr(block, "input", {}).get("query")})
        elif btype == "web_search_tool_result":
            try:
                searches[-1]["results"] = [
                    {"url": r.url, "title": r.title} for r in block.content if getattr(r, "type", "") == "web_search_result"
                ][:8]
            except Exception:
                pass
    # Claude splits a web-searched answer into many text blocks at citation
    # boundaries - typically mid-sentence, inside a JSON string. They must be
    # concatenated with NO separator. A newline joiner put a raw newline inside
    # a string literal, which is invalid JSON, and every real web-search
    # response failed to parse until this was fixed.
    text = "".join(text_parts)
    # Sonnet 5 wraps searched sentences in <cite index="..."> tags inside the
    # text blocks themselves. Inside a JSON string they are noise; strip them.
    text = re.sub(r"</?cite[^>]*>", "", text)
    usage = {"input_tokens": getattr(resp.usage, "input_tokens", None), "output_tokens": getattr(resp.usage, "output_tokens", None)}
    # Billed searches come from usage.server_tool_use when present; the count of
    # server_tool_use blocks is the same number and works on older SDKs.
    stu = getattr(resp.usage, "server_tool_use", None)
    n_searches = getattr(stu, "web_search_requests", None) if stu is not None else None
    if n_searches is None:
        n_searches = len(searches)
    response_log = {"text": text, "searches": searches, "citations": citations, "stop_reason": resp.stop_reason, "search_count": n_searches}

    try:
        parsed = _parse_json(text)
    except AIError as e:
        _log(db, session_id, stage, purpose, "anthropic", model, request_log, response_log, usage, latency, str(e))
        raise
    _log(db, session_id, stage, purpose, "anthropic", model, request_log, {**response_log, "parsed": parsed}, usage, latency)
    return parsed


# --- images --------------------------------------------------------------------------

def generate_image(db: Session, session_id: int, stage: str, prompt: str, out_path: Path, quality: str | None = None) -> None:
    """Writes a PNG to out_path. Placeholder in mock mode."""
    out_path.parent.mkdir(parents=True, exist_ok=True)
    quality = quality or config.image_quality
    t0 = time.time()
    if config.mock:
        _placeholder_png(prompt, out_path)
        _log(db, session_id, stage, "render", "mock", "placeholder", {"prompt": prompt, "quality": quality}, {"file": str(out_path.name)}, {}, int((time.time() - t0) * 1000))
        return

    if not config.openai_api_key:
        raise AIError("OPENAI_API_KEY is not set (needed for images). Or set AI_PROVIDER=mock.")

    from openai import OpenAI

    client = OpenAI(api_key=config.openai_api_key)
    try:
        resp = client.images.generate(model=config.image_model, prompt=prompt, size="1024x1024", quality=quality, n=1)
        b64 = resp.data[0].b64_json
        out_path.write_bytes(base64.b64decode(b64))
    except Exception as e:
        _log(db, session_id, stage, "render", "openai", config.image_model, {"prompt": prompt, "quality": quality}, None, {}, int((time.time() - t0) * 1000), str(e))
        raise AIError(f"Image generation failed: {e}") from e
    _log(db, session_id, stage, "render", "openai", config.image_model, {"prompt": prompt, "quality": quality}, {"file": out_path.name, "bytes": out_path.stat().st_size}, {}, int((time.time() - t0) * 1000))


def _placeholder_png(prompt: str, out_path: Path) -> None:
    """A 512x512 PNG with a colour derived from the prompt. No dependencies beyond zlib."""
    import struct
    import zlib

    h = hashlib.sha256(prompt.encode()).digest()
    r, g, b = h[0] // 2 + 40, h[1] // 2 + 40, h[2] // 2 + 60
    w = hgt = 512
    raw = bytearray()
    for y in range(hgt):
        raw.append(0)
        for x in range(w):
            # a soft diagonal gradient so placeholders are not flat blocks
            t = (x + y) / (w + hgt)
            raw += bytes((int(r * (1 - t * 0.5)), int(g * (1 - t * 0.5)), int(b * (1 - t * 0.3))))

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, hgt, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(bytes(raw), 6)) + chunk(b"IEND", b"")
    out_path.write_bytes(png)


# --- embeddings ------------------------------------------------------------------------

def embed_texts(db: Session, session_id: int | None, stage: str, texts: list[str]) -> np.ndarray:
    """Unit vectors, same model and dimensions as the Inspider web."""
    if config.mock:
        rng = np.random.default_rng(abs(hash(tuple(texts))) % (2**32))
        v = rng.standard_normal((len(texts), config.embedding_dimensions)).astype(np.float32)
        return v / np.linalg.norm(v, axis=1, keepdims=True)
    if not config.openai_api_key:
        raise AIError("OPENAI_API_KEY is not set (needed for embeddings). Or set AI_PROVIDER=mock.")

    from openai import OpenAI

    client = OpenAI(api_key=config.openai_api_key)
    t0 = time.time()
    try:
        resp = client.embeddings.create(model=config.embedding_model, input=texts, dimensions=config.embedding_dimensions)
    except Exception as e:
        _log(db, session_id, stage, "embed", "openai", config.embedding_model, {"n": len(texts)}, None, {}, int((time.time() - t0) * 1000), str(e))
        raise AIError(f"Embedding failed: {e}") from e
    v = np.array([d.embedding for d in resp.data], dtype=np.float32)
    v /= np.maximum(np.linalg.norm(v, axis=1, keepdims=True), 1e-9)
    _log(db, session_id, stage, "embed", "openai", config.embedding_model, {"n": len(texts)}, {"dims": int(v.shape[1])},
         {"input_tokens": getattr(resp.usage, "prompt_tokens", None)}, int((time.time() - t0) * 1000))
    return v


# --- mock Claude ------------------------------------------------------------------------

def _mock_claude(db: Session, session_id: int | None, stage: str, purpose: str, prompt: str) -> dict:
    """Canned but shaped output, keyed on purpose. Enough to walk the whole study."""
    seed = int(hashlib.sha256(prompt.encode()).hexdigest()[:8], 16)
    n = 5
    m = re.search(r"Generate (\d+) ideas|Propose (\d+) English|Find (\d+) real-world", prompt)
    if m:
        n = int(next(g for g in m.groups() if g))

    out: dict
    if purpose == "cae_extract":
        out = {"issues": [
            {"headline": "The geyser takes twelve minutes to heat", "cause": "the geyser takes about twelve minutes to heat water after switching on", "affect": "the participant feels impatient and stuck", "effect": "the morning runs late and they leave rushed", "evidence": "the geyser takes forever"},
            {"headline": "Keys are never where they were left", "cause": "there is no fixed place for the keys", "affect": "the participant feels flustered", "effect": "leaving the house is delayed by a search", "evidence": "I can never find my keys"},
        ]}
    elif purpose == "problems_identify":
        out = {"problems": [
            {"statement": "Water heating time is dead time in a rushed morning", "rationale": "The wait is unavoidable but unused.", "source_issue_ordinals": [1]},
            {"statement": "Small essential objects have no reliable home", "rationale": "Search time recurs daily.", "source_issue_ordinals": [2]},
        ]}
    elif purpose == "aopc":
        out = {"action": "waiting", "object": "water heater", "party": "the participant", "context": "a time-pressured morning routine", "restated": "The participant waits on the water heater during a time-pressured morning routine."}
    elif purpose == "traditional_structure":
        ideas = re.findall(r'"text":\s*"([^"]*)"', prompt)
        out = {"ideas": [{"ordinal": i + 1, "title": f"Own idea {i + 1}", "principle": f"principle drawn from: {t[:60]}", "principle_inferred": True, "phenomenon": t, "phenomenon_inferred": False} for i, t in enumerate(ideas)]}
    elif purpose in ("ideas_modern", "ideas_inspider"):
        tag = "AI" if purpose == "ideas_modern" else "Inspider"
        out = {"ideas": [{"ordinal": i + 1, "title": f"{tag} idea {i + 1}", "principle": f"Principle {seed % 97 + i}: thermal inertia used to schedule", "phenomenon": f"Phenomenon {i + 1}: heat begins before the person does", "inspired_by": [], "transfer": "mock"} for i in range(n)]}
    elif purpose == "keywords":
        verbs = ["anticipate", "warm", "signal", "store", "schedule", "absorb", "trigger", "conserve"]
        out = {"keywords": [{"verb": v, "rationale": f"mock rationale for {v}"} for v in verbs[:n]]}
    elif purpose == "phenomena":
        verb = re.search(r'the verb "([^"]+)"', prompt)
        v = verb.group(1) if verb else "act"
        out = {"phenomena": [{"title": f"{v.title()} phenomenon {i + 1}", "description": f"A mock phenomenon in which something {v}s, with a mechanism behind it.", "domain": ["nature", "physics", "biology", "engineering", "everyday"][i % 5], "source_url": f"https://example.org/{v}/{i + 1}", "source_title": f"Example source {i + 1}"} for i in range(n)]}
    elif purpose == "concept":
        out = {"title": f"Concept {seed % 1000}", "object": "A compact device mounted beside the heater.", "characteristics": ["palm-sized disc, 80 mm", "matte ceramic, warm grey", "one dial, one light", "on the bathroom wall", "glows amber when water is ready", "battery lasts a year"], "how_it_works": "It senses the heater and signals readiness so the person does something else meanwhile."}
    elif purpose == "render_prompts":
        out = {"product": "Studio product photo of a palm-sized matte grey ceramic disc with an amber light, neutral background.", "in_use": "A bathroom wall at morning, the disc glowing amber beside a water heater, candid documentary style."}
    else:
        out = {}

    _log(db, session_id, stage, purpose, "mock", "mock", {"prompt": prompt}, {"parsed": out}, {"input_tokens": len(prompt) // 4, "output_tokens": 200}, 5)
    return out
