"""
Walks two participants (odd and even number, so both counterbalance orders)
through the entire study in mock mode, against a throwaway database and a
throwaway copy of the Inspider import. Checks the invariants that matter to the
experiment rather than AI quality.
"""
from __future__ import annotations

import os
import tempfile
import time
from pathlib import Path

import pytest

TMP = Path(tempfile.mkdtemp(prefix="vitis-test-"))
os.environ["AI_PROVIDER"] = "mock"
os.environ["DATABASE_URL"] = f"sqlite:///{(TMP / 'test.sqlite').as_posix()}"
os.environ["IMAGE_DIR"] = str(TMP / "images")
os.environ["SECRET_SALT"] = "test"
os.environ["EXPERIMENTER_VITI_PASSWORD"] = "test-password-viti"
os.environ["EXPERIMENTER_SANKAR_PASSWORD"] = "test-password-sankar"

from fastapi.testclient import TestClient  # noqa: E402

from app.config import config  # noqa: E402
from app.main import app  # noqa: E402
from app.seed import main as seed  # noqa: E402

pytestmark = pytest.mark.skipif(not (config.inspider_data_dir / "nodes.parquet").exists(), reason="Inspider web not built")


@pytest.fixture(scope="module")
def client():
    seed()
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="module")
def admin(client):
    r = client.post("/api/admin/login", json={"username": "viti", "password": "test-password-viti"})
    assert r.status_code == 200, r.text
    h = {"authorization": f"Bearer {r.json()['token']}"}
    # The Inspider web imports in a background thread at boot; wait for it.
    for _ in range(240):
        if client.get("/api/admin/overview", headers=h).json()["web"]["imported"]:
            break
        time.sleep(0.5)
    else:
        pytest.fail("Inspider web never imported")
    return h


def create_participant(client, admin, **kw):
    r = client.post("/api/admin/participants", json={"name": "Test Person", "age": 30, **kw}, headers=admin)
    assert r.status_code == 200, r.text
    return r.json()


def login(client, p):
    r = client.post("/api/participant/login", json={"username": p["username"], "passcode": p["passcode"]})
    assert r.status_code == 200, r.text
    return {"authorization": f"Bearer {r.json()['token']}"}


def consent(client, h):
    items = client.get("/api/consent").json()["items"]
    r = client.post("/api/participant/consent", json={"agreed": {i["key"]: True for i in items}}, headers=h)
    assert r.status_code == 200, r.text


def state(client, h):
    r = client.get("/api/study/state", headers=h)
    assert r.status_code == 200, r.text
    return r.json()


# --- admin basics ------------------------------------------------------------------------

def test_admin_login_and_overview(client, admin):
    ov = client.get("/api/admin/overview", headers=admin).json()
    assert ov["web"]["imported"] is True
    assert ov["web"]["verbs"] > 10000
    assert ov["provider"] == "mock"


def test_participant_codes_are_unique_and_counterbalanced(client, admin):
    a = create_participant(client, admin)
    b = create_participant(client, admin)
    assert a["username"] != b["username"] and a["passcode"] != b["passcode"]
    assert len(a["passcode"]) == 5 and not set(a["passcode"]) & set("0O1IL")
    assert a["condition_order"][0] == "traditional" and b["condition_order"][0] == "traditional"
    assert a["condition_order"][1:] != b["condition_order"][1:], "consecutive participants must get different orders"


def test_wrong_passcode_rejected(client, admin):
    p = create_participant(client, admin)
    assert client.post("/api/participant/login", json={"username": p["username"], "passcode": "WRONG"}).status_code == 401


def test_consent_gate(client, admin):
    p = create_participant(client, admin)
    h = login(client, p)
    assert client.get("/api/study/state", headers=h).status_code == 403
    consent(client, h)
    assert state(client, h)["stage"] == "issue"


# --- the full flow ---------------------------------------------------------------------------

def walk_to_rating(client, h):
    st = state(client, h)
    assert st["stage"] == "issue"

    r = client.post("/api/study/issue", json={"text": "Every morning the geyser takes forever to heat and I can never find my keys before leaving.", "input_mode": "typed"}, headers=h)
    assert r.status_code == 200, r.text
    st = r.json()
    assert st["stage"] == "cae" and len(st["issues"]) >= 1

    edits = [{"id": i["id"], "cause": i["cause"] + " (edited)"} for i in st["issues"]]
    st = client.post("/api/study/cae/confirm", json={"issues": edits}, headers=h).json()
    assert st["stage"] == "problems" and len(st["problems"]) >= 1

    st = client.post("/api/study/problems/select", json={"problem_id": st["problems"][0]["id"]}, headers=h).json()
    assert st["stage"] == "aopc" and st["problem"]["action"]

    st = client.post("/api/study/aopc/confirm", json={"context": "an edited context"}, headers=h).json()
    assert st["stage"] == "traditional" and st["ideas_required"] == 5

    # too few ideas is refused
    assert client.post("/api/study/traditional", json={"ideas": ["only one"]}, headers=h).status_code == 400
    st = client.post("/api/study/traditional", json={"ideas": [f"My own idea number {i}" for i in range(1, 6)]}, headers=h).json()

    # whichever automatic condition is first, drive it; modern runs itself.
    for _ in range(2):
        if st["stage"] == "rate_ideas":
            break
        assert st["stage"] in ("auto_1", "auto_2")
        if st["condition"] == "inspider":
            st = run_inspider(client, h, st)
        else:
            pytest.fail("modern should have auto-advanced")
    assert st["stage"] == "rate_ideas", st
    return st


def run_inspider(client, h, st):
    assert st["substage"] == "keywords"
    st = client.post("/api/study/inspider/keywords/propose", headers=h).json()
    kws = st["keywords"]
    assert len(kws) >= 3
    assert all(k["resolved_lemma"] for k in kws), "every proposed keyword must resolve to a verb node"
    st = client.post("/api/study/inspider/keywords/add", json={"text": "notifiy"}, headers=h).json()  # typo, fuzzy resolves
    added = [k for k in st["keywords"] if k["source"] == "user"][0]
    assert added["resolved_lemma"] == "notify" and added["resolution"] in ("fuzzy", "form", "exact")

    keep = [k["id"] for k in st["keywords"]][:3]
    st = client.post("/api/study/inspider/keywords/confirm", json={"keyword_ids": keep}, headers=h).json()
    assert st["substage"] == "neighbours"
    opts = st["neighbour_options"]
    assert len(opts) == 3 and all(len(o["neighbours"]) >= 5 for o in opts)
    assert all(n["sim"] <= 1.0 for o in opts for n in o["neighbours"])

    # Ask for one more neighbour than allowed: the server clamps to the study setting.
    max_pick = config.study.neighbours_max_pick
    picks = [{"keyword_id": o["keyword"]["id"], "node_ids": [n["node_id"] for n in o["neighbours"][:max_pick + 1]]} for o in opts]
    r = client.post("/api/study/inspider/neighbours/confirm", json={"picks": picks}, headers=h)
    assert r.status_code == 200, r.text
    st = r.json()
    assert st["substage"] == "select", st
    sel = st["selection"]
    k = sel["k"]
    assert len(sel["kept"]) == k
    assert len(sel["kept"]) + len(sel["dropped"]) == 3 + 3 * max_pick
    st = client.post("/api/study/inspider/select/confirm", headers=h).json()
    assert st["substage"] == "phenomena"
    expected_groups = k

    # The search is a background job: the run call returns at once, and the
    # participant's page polls state until the job reports done.
    st = client.post("/api/study/inspider/phenomena/run", headers=h).json()
    assert st["phenomena"]["job"]["status"] in ("queued", "running", "done")
    assert st["phenomena"]["job"]["total"] == expected_groups
    # confirming while the job runs is refused
    if st["phenomena"]["job"]["status"] != "done":
        assert client.post("/api/study/inspider/phenomena/confirm", headers=h).status_code == 409
    for _ in range(120):
        if st["phenomena"]["job"]["status"] == "done":
            break
        time.sleep(0.25)
        st = state(client, h)
    else:
        pytest.fail(f"phenomena job never finished: {st['phenomena']['job']}")
    # a second run call is a no-op, not a second search
    again = client.post("/api/study/inspider/phenomena/run", headers=h).json()
    assert again["phenomena"]["job"]["status"] == "done"
    groups = st["phenomena"]["groups"]
    assert len(groups) == expected_groups, f"kept {expected_groups} verbs after selection, got {len(groups)} groups"
    n_phen = config.study.phenomena_per_keyword
    assert all(sum(1 for p in g["phenomena"] if p["fresh"]) == n_phen for g in groups)
    assert all(len(g["phenomena"]) >= n_phen for g in groups)

    st = client.post("/api/study/inspider/phenomena/confirm", headers=h).json()
    return st


def rate_all(client, h, expected_type):
    for _ in range(120):
        st = state(client, h)
        deck = st["deck"]
        assert deck["target_type"] == expected_type
        if deck["ready"]:
            break
        time.sleep(0.25)
    else:
        pytest.fail(f"generation never finished: {st.get('jobs')}")
    items = deck["items"]
    assert items, "empty deck"
    assert all("condition" not in it and "_cond" not in it for it in items), "deck leaked the condition"
    for it in items:
        r = client.post("/api/study/rate", json={"target_type": expected_type, "target_id": it["id"], "novelty": 3, "usefulness": 4, "feasibility": 2, "display_order": it["display_order"], "response_ms": 1200}, headers=h)
        assert r.status_code == 200, r.text
    st = client.post("/api/study/rate/complete", headers=h).json()
    return st, items


def test_full_study_both_orders(client, admin):
    for _ in range(2):
        p = create_participant(client, admin)
        h = login(client, p)
        consent(client, h)
        st = walk_to_rating(client, h)

        st, ideas = rate_all(client, h, "idea")
        assert len(ideas) == 15, "3 conditions x 5 ideas"
        assert st["stage"] == "rate_concepts"

        st, concepts = rate_all(client, h, "concept")
        assert len(concepts) == 15
        assert st["stage"] == "rate_renders"

        st, renders = rate_all(client, h, "render")
        assert len(renders) == 15 and all(len(r["images"]) == 2 for r in renders)
        assert st["stage"] == "done"

        full = client.get(f"/api/admin/participants/{p['id']}/full", headers=admin).json()
        s = full["sessions"][0]
        conds = {i["condition"] for i in s["ideas"]}
        assert conds == {"traditional", "modern", "inspider"}
        assert all(i["raw_text"] for i in s["ideas"] if i["condition"] == "traditional")
        assert all(i["rating"] for i in s["ideas"])
        assert set(s["summary"]) == {"traditional", "modern", "inspider"}
        assert len(s["transcript"]) > 20
        assert any(c["purpose"] == "phenomena" for c in s["ai_calls"])
        assert s["session"]["condition_order"] == p["condition_order"]
        assert s["session"]["completed_at"]


def test_deck_order_is_stable_and_blind(client, admin):
    p = create_participant(client, admin)
    h = login(client, p)
    consent(client, h)
    walk_to_rating(client, h)
    a = [it["id"] for it in state(client, h)["deck"]["items"]]
    b = [it["id"] for it in state(client, h)["deck"]["items"]]
    assert a == b, "shuffled deck must be stable across reloads"
    # not simply grouped by condition: at least one adjacent pair differs in condition
    full = client.get(f"/api/admin/participants/{p['id']}/full", headers=admin).json()
    cond = {i["id"]: i["condition"] for i in full["sessions"][0]["ideas"]}
    seq = [cond[i] for i in a]
    assert len({seq[i] == seq[i + 1] for i in range(len(seq) - 1)}) == 2 or len(set(seq)) < 3


def test_web_grows_and_is_shared(client, admin):
    before = client.get("/api/admin/overview", headers=admin).json()["web"]["phenomena"]
    p = create_participant(client, admin)
    h = login(client, p)
    consent(client, h)
    walk_to_rating(client, h)
    after = client.get("/api/admin/overview", headers=admin).json()["web"]["phenomena"]
    assert after > before, "a run must append phenomena to the web"
    full = client.get(f"/api/admin/participants/{p['id']}/full", headers=admin).json()
    phen = full["sessions"][0]["phenomena"]
    # an earlier participant already hit some of these verbs (mock proposes the same ones), so some are inherited
    assert any(not x["fresh"] for x in phen), "later participants should see phenomena added by earlier ones"
    assert any(x["fresh"] for x in phen)


def test_image_route_requires_token(client, admin):
    ph = client.get("/api/admin/web/phenomena", headers=admin).json()["phenomena"]
    assert ph and ph[0]["keyword"]
    parts = client.get("/api/admin/participants", headers=admin).json()["participants"]
    done = [p for p in parts if p["status"] == "completed"]
    assert done
    full = client.get(f"/api/admin/participants/{done[0]['id']}/full", headers=admin).json()
    url = full["sessions"][0]["concepts"][0]["renders"][0]["url"]
    assert client.get(url).status_code == 401
    assert client.get(url, params={"t": "garbage"}).status_code == 403
    tok = admin["authorization"].split(" ", 1)[1]
    r = client.get(url, params={"t": tok})
    assert r.status_code == 200 and r.content[:4] == b"\x89PNG"


def test_exports(client, admin):
    js = client.get("/api/admin/export.json", headers=admin).json()
    assert js["participants"]
    csv_ = client.get("/api/admin/export/ratings.csv", headers=admin)
    assert csv_.status_code == 200
    lines = csv_.text.strip().splitlines()
    assert lines[0].startswith("participant,session,condition_order,target_type")
    assert len(lines) > 30
    assert any(",inspider," in l for l in lines) and any(",traditional," in l for l in lines)


def test_delete_participant_keeps_phenomena(client, admin):
    parts = client.get("/api/admin/participants", headers=admin).json()["participants"]
    victim = [p for p in parts if p["status"] == "completed"][0]
    before = client.get("/api/admin/overview", headers=admin).json()["web"]["phenomena"]
    bad = client.request("DELETE", f"/api/admin/participants/{victim['id']}", headers=admin, json={"username": "NOPE"})
    assert bad.status_code == 400
    assert client.get(f"/api/admin/participants/{victim['id']}/full", headers=admin).status_code == 200
    out = client.request("DELETE", f"/api/admin/participants/{victim['id']}", headers=admin, json={"username": victim["username"]}).json()
    assert out["deleted"] and out["status"] == "completed"
    after = client.get("/api/admin/overview", headers=admin).json()["web"]["phenomena"]
    assert after == before, "the web is not the participant's data; it must survive deletion"
    assert client.get(f"/api/admin/participants/{victim['id']}/full", headers=admin).status_code == 404


def test_delete_participant_any_status(client, admin):
    fresh = create_participant(client, admin, name="To Delete")
    assert fresh["status"] == "created"
    out = client.request("DELETE", f"/api/admin/participants/{fresh['id']}", headers=admin, json={"username": fresh["username"]}).json()
    assert out["deleted"] and out["status"] == "created"
    assert client.get(f"/api/admin/participants/{fresh['id']}/full", headers=admin).status_code == 404


def test_model_routing_and_cost_meter(client, admin):
    """Creative purposes go to the creative model, the rest to the fast one; the
    cost meter prices logged calls from their own token / search / quality data."""
    from app.models import AICall
    from app.services import cost

    assert config.model_for("ideas_inspider") == config.anthropic_model
    assert config.model_for("concept") == config.anthropic_model
    assert config.model_for("phenomena") == config.anthropic_model_fast
    assert config.model_for("cae_extract") == config.anthropic_model_fast

    opus = AICall(stage="inspider", provider="anthropic", model="claude-opus-5", purpose="ideas_inspider", request={}, response={},
                  input_tokens=10_000, output_tokens=2_000, status="ok")
    sonnet_search = AICall(stage="phenomena", provider="anthropic", model="claude-sonnet-5", purpose="phenomena", request={},
                           response={"search_count": 3, "searches": [{}, {}, {}]}, input_tokens=20_000, output_tokens=1_000, status="ok")
    img_med = AICall(stage="renders", provider="openai", model="gpt-image-1", purpose="render", request={"quality": "medium"}, response={}, status="ok")
    img_low = AICall(stage="renders", provider="openai", model="gpt-image-1", purpose="render", request={"quality": "low"}, response={}, status="ok")
    img_fail = AICall(stage="renders", provider="openai", model="gpt-image-1", purpose="render", request={"quality": "medium"}, response=None, status="error")
    mock = AICall(stage="cae", provider="mock", model="mock", purpose="cae_extract", request={}, response={}, input_tokens=999, output_tokens=999, status="ok")

    p = config.prices
    assert cost.cost_of_call(opus) == pytest.approx(10_000 / 1e6 * p["claude-opus"][0] + 2_000 / 1e6 * p["claude-opus"][1])
    assert cost.cost_of_call(sonnet_search) == pytest.approx(20_000 / 1e6 * p["claude-sonnet"][0] + 1_000 / 1e6 * p["claude-sonnet"][1] + 3 / 1000 * p["web_search_per_1000"])
    assert cost.cost_of_call(img_med) == p["image"]["medium"]
    assert cost.cost_of_call(img_low) == p["image"]["low"]
    assert cost.cost_of_call(img_fail) == 0.0
    assert cost.cost_of_call(mock) == 0.0

    summary = cost.summarise([opus, sonnet_search, img_med, img_low, img_fail, mock])
    assert summary["total_usd"] == pytest.approx(sum(cost.cost_of_call(c) for c in (opus, sonnet_search, img_med, img_low)), abs=1e-4)
    assert summary["by_stage"]["phenomena search"]["searches"] == 3
    assert summary["by_stage"]["renders"]["calls"] == 3
    assert set(summary["by_model"]) == {"claude-opus-5", "claude-sonnet-5", "gpt-image-1", "mock"}

    # The console exposes it: overview + participant rows carry a cost (0 in mock mode).
    ov = client.get("/api/admin/overview", headers=admin).json()
    assert ov["cost"]["total_usd"] == 0.0 and ov["model_fast"] == config.anthropic_model_fast
    assert ov["web_search_max_uses"] == config.web_search_max_uses
    parts = client.get("/api/admin/participants", headers=admin).json()["participants"]
    assert all(row["cost_usd"] == 0.0 for row in parts)


def test_neighbours_skip_spelling_variants():
    from app.services.inspider import _spelling_variant as v
    assert v("magnetize", "magnetise") and v("illuminate", "illumine") and v("colour", "color") and v("analyse", "analyze")
    assert not v("anchor", "ground") and not v("cue", "remind") and not v("gamify", "gam") and not v("light", "lighten")
