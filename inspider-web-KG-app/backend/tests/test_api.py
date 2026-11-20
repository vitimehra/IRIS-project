"""
API tests against whatever is built in data/. Runs on the dev-provider build,
so they check shape and invariants, never semantic quality.
"""
from __future__ import annotations

import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

REPO = Path(__file__).resolve().parents[2]
DATA = REPO / os.environ.get("DATA_DIR", "data")

pytestmark = pytest.mark.skipif(not (DATA / "nodes.parquet").exists(), reason="no built data")


@pytest.fixture(scope="module")
def client():
    from backend.app import app

    with TestClient(app) as c:
        yield c


def first_verified(client) -> dict:
    r = client.get("/api/verbs/random")
    assert r.status_code == 200
    return r.json()


def test_health_and_meta(client):
    assert client.get("/api/health").json()["ok"] is True
    m = client.get("/api/meta").json()
    assert m["verbs"] > 100
    assert m["edges"] > m["verbs"]
    assert m["k"] > 0
    assert m["sim_convention"].startswith("cosine similarity")
    assert "03_embed" in m["provenance"]["stages"]


def test_search_exact_prefix_and_fuzzy(client):
    exact = client.get("/api/search", params={"q": "rise"}).json()["results"]
    assert exact and exact[0]["lemma"] == "rise" and exact[0]["match"] == "exact"

    typo = client.get("/api/search", params={"q": "rsie"}).json()["results"]
    assert any(r["lemma"] == "rise" for r in typo), "fuzzy search did not recover a typo"

    prefix = client.get("/api/search", params={"q": "coo"}).json()["results"]
    assert all(r["lemma"].startswith("coo") or r["match"] == "fuzzy" for r in prefix)


def test_search_resolves_inflected_forms(client):
    r = client.get("/api/verbs/rising")
    assert r.status_code == 200
    assert r.json()["lemma"] == "rise"


def test_search_hides_unverified_by_default(client):
    hidden = client.get("/api/search", params={"q": "bepearl"}).json()["results"]
    shown = client.get("/api/search", params={"q": "bepearl", "unverified": "true"}).json()["results"]
    assert not any(r["lemma"] == "bepearl" for r in hidden)
    assert any(r["lemma"] == "bepearl" for r in shown)


def test_verb_detail_has_gloss_and_cluster(client):
    v = client.get("/api/verbs/cook").json()
    assert v["gloss"] and "meal" in v["gloss"] or "heat" in v["gloss"]
    assert v["gloss_source"] == "wordnet"
    assert isinstance(v["cluster_name"], str)
    assert "rises" not in v["forms"]  # rises belongs to rise, not cook
    assert v["zipf_frequency"] > 3


def test_unknown_verb_is_404(client):
    assert client.get("/api/verbs/zzzznotaverb").status_code == 404


def test_neighbours_are_ranked_and_bounded(client):
    r = client.get("/api/verbs/rise/neighbours", params={"k": 10}).json()
    nb = r["neighbours"]
    assert 0 < len(nb) <= 10
    sims = [n["sim"] for n in nb]
    assert sims == sorted(sims, reverse=True)
    assert all(-1.0 <= s <= 1.0 for s in sims)
    assert all(n["lemma"] != "rise" for n in nb)


def test_neighbours_min_sim_filters(client):
    all_ = client.get("/api/verbs/rise/neighbours", params={"k": 50}).json()["neighbours"]
    cut = client.get("/api/verbs/rise/neighbours", params={"k": 50, "min_sim": 0.99}).json()["neighbours"]
    assert len(cut) <= len(all_)
    assert all(n["sim"] >= 0.99 for n in cut)


def test_ego_depth_one_and_two(client):
    one = client.get("/api/ego", params={"term": "rise", "k": 8, "depth": 1}).json()
    assert one["center"] == client.get("/api/verbs/rise").json()["id"]
    assert 1 < len(one["nodes"]) <= 9
    assert all(n["hop"] in (0, 1) for n in one["nodes"])

    two = client.get("/api/ego", params={"term": "rise", "k": 8, "depth": 2}).json()
    assert len(two["nodes"]) > len(one["nodes"])
    assert any(n["hop"] == 2 for n in two["nodes"])
    ids = {n["id"] for n in two["nodes"]}
    assert all(e["source"] in ids and e["target"] in ids for e in two["edges"])


def test_compare_and_similarity(client):
    c = client.get("/api/compare", params={"a": "rise", "b": "cook"}).json()
    assert -1.0 <= c["similarity"] <= 1.0
    assert 0.0 <= c["jaccard"] <= 1.0
    s = client.get("/api/similarity", params={"a": "rise", "b": "rise"}).json()
    assert abs(s["similarity"] - 1.0) < 1e-3


def test_analogy_excludes_inputs(client):
    r = client.post("/api/analogy", json={"positive": ["rise", "sun"], "negative": ["set"], "k": 5})
    if r.status_code == 404:
        pytest.skip("one of the analogy verbs is not in this corpus")
    body = r.json()
    lemmas = [x["lemma"] for x in body["results"]]
    assert len(lemmas) == 5
    assert not {"rise", "sun", "set"} & set(lemmas)


def test_analogy_requires_positive(client):
    assert client.post("/api/analogy", json={"positive": [], "negative": ["x"]}).status_code == 400


def test_path_between_verbs(client):
    p = client.get("/api/path", params={"from": "rise", "to": "cook"}).json()
    assert p["found"]
    assert p["nodes"][0]["lemma"] == "rise" and p["nodes"][-1]["lemma"] == "cook"
    assert len(p["edges"]) == len(p["nodes"]) - 1
    assert p["cost"] >= 0


def test_path_to_self(client):
    p = client.get("/api/path", params={"from": "rise", "to": "rise"}).json()
    assert p["found"] and p["hops"] == 0


def test_walk_is_reproducible_with_seed(client):
    a = client.get("/api/walk", params={"start": "rise", "steps": 5, "seed": 7}).json()
    b = client.get("/api/walk", params={"start": "rise", "steps": 5, "seed": 7}).json()
    assert [n["id"] for n in a["nodes"]] == [n["id"] for n in b["nodes"]]
    assert a["nodes"][0]["lemma"] == "rise"
    assert len(a["edges"]) == len(a["nodes"]) - 1
    assert len(set(n["id"] for n in a["nodes"])) == len(a["nodes"]), "walk revisited a verb"


def test_clusters_and_members(client):
    cl = client.get("/api/clusters").json()["clusters"]
    assert cl and all(c["size"] > 0 and c["name"] for c in cl)
    first = client.get(f"/api/clusters/{cl[0]['cluster_id']}", params={"limit": 20}).json()
    assert 0 < len(first["members"]) <= 20
    assert all(m["cluster_id"] == cl[0]["cluster_id"] for m in first["members"])


def test_map_is_compact_and_consistent(client):
    m = client.get("/api/map").json()
    n = len(m["ids"])
    assert n > 100
    assert len(m["x"]) == len(m["y"]) == len(m["cluster"]) == len(m["lemmas"]) == n
    assert all(-101 <= v <= 101 for v in m["x"][:1000])


def test_export_formats(client):
    ego = client.get("/api/ego", params={"term": "rise", "k": 5}).json()
    ids = ",".join(str(n["id"]) for n in ego["nodes"])
    js = client.get("/api/export/subgraph", params={"ids": ids, "format": "json"}).json()
    assert len(js["nodes"]) == len(ego["nodes"])
    csv_ = client.get("/api/export/subgraph", params={"ids": ids, "format": "csv"})
    assert csv_.status_code == 200 and csv_.text.startswith("source,")
    gml = client.get("/api/export/subgraph", params={"ids": ids, "format": "graphml"})
    assert gml.status_code == 200 and b"graphml" in gml.content
    assert client.get("/api/export/subgraph", params={"ids": ids, "format": "xlsx"}).status_code == 400


def test_random_is_frequent_and_verified(client):
    for _ in range(5):
        v = first_verified(client)
        assert not v["unverified"]
        assert v["zipf_frequency"] >= 3.0
