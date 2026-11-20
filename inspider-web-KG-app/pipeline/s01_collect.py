"""
Step 1 - Collect every English verb from the eight sources, deduplicate, lemmatise,
and store alphabetically as data/verbs.parquet.

Sources (the seven from the session deck, plus WordNet itself as a baseline):
  1. hossein1376/all-english-verbs           Excel sheet, ~22k verbs with forms
  2. monolithpl/verb.forms.dictionary        TSV: base, 3rd person, past, participle, -ing
  3. Stanford VerbNet verbs.txt              plain list, ~3.2k
  4. dariusk/corpora verbs.json              JSON, present + past
  5. legend80s/verb-corpus complete.json     JSON flat list
  6/7. VerbNet 3.3 tarball                   XML classes; gives each member a class
  8. WordNet (via NLTK)                      every verb lemma, with the gloss used later

Each raw download is cached under data/raw/, so a re-run is offline.

Deduplication is by lemma. Inflected forms met along the way are kept on the
lemma row (`forms`), which is what makes "lemmas only" a node policy rather than a
data loss: rises/rising/rose/risen are all still there, on the row for rise.
"""
from __future__ import annotations

import csv
import io
import json
import re
import tarfile
import xml.etree.ElementTree as ET
from collections import defaultdict
from pathlib import Path

import httpx
import pandas as pd
from tqdm import tqdm

from .config import Config, Provenance

SOURCES = {
    "hossein1376": "https://raw.githubusercontent.com/hossein1376/all-english-verbs/HEAD/Verbs.xlsx",
    "monolithpl": "https://raw.githubusercontent.com/monolithpl/verb.forms.dictionary/HEAD/csv/verbs-all.csv",
    "stanford_verbnet": "https://nlp.stanford.edu/projects/infer/data/resources/Verbnet/data/verbs.txt",
    "dariusk_corpora": "https://raw.githubusercontent.com/dariusk/corpora/master/data/words/verbs.json",
    "legend80s": "https://raw.githubusercontent.com/legend80s/verb-corpus/HEAD/generated/complete.json",
    "verbnet33": "http://verbs.colorado.edu/verb-index/vn/verbnet-3.3.tar.gz",
}

# A verb, for our purposes: lowercase letters, optionally hyphenated, 2-30 chars.
# Phrasal verbs (with spaces) are recorded as forms of their head verb rather than
# as nodes, per the agreed "lemmas only" policy.
WORD_RE = re.compile(r"^[a-z][a-z'-]{1,29}$")


def _download(cfg: Config, name: str, url: str) -> Path:
    suffix = Path(url.split("?")[0]).suffix or ".dat"
    target = cfg.raw_dir / f"{name}{suffix}"
    if target.exists() and target.stat().st_size > 0:
        return target
    with httpx.Client(follow_redirects=True, timeout=120) as client:
        with client.stream("GET", url, headers={"User-Agent": "inspider-web/1.0"}) as r:
            r.raise_for_status()
            with target.open("wb") as f:
                for chunk in r.iter_bytes():
                    f.write(chunk)
    return target


def _clean(token: str) -> str | None:
    t = token.strip().lower().replace("’", "'")
    t = re.sub(r"\s+", " ", t)
    if " " in t:
        # phrasal / multiword: keep the head verb; the phrase survives as a form
        t = t.split(" ")[0]
    if t.startswith("to "):
        t = t[3:]
    if not WORD_RE.match(t):
        return None
    if t.count("-") > 2 or "--" in t:
        return None
    return t


# --- per-source readers ------------------------------------------------------
# Each yields (surface_form, base_form_if_known, extra_forms, source_meta)

def read_hossein(path: Path):
    from openpyxl import load_workbook

    wb = load_workbook(path, read_only=True)
    ws = wb.active
    rows = ws.iter_rows(values_only=True)
    header = next(rows, None)
    for row in rows:
        cells = [str(c).strip() for c in row if c is not None and str(c).strip()]
        if not cells:
            continue
        base, *forms = cells
        yield base, base, forms, {}


def read_monolith(path: Path):
    with path.open(encoding="utf-8", errors="ignore") as f:
        for line in f:
            cells = [c.strip() for c in line.rstrip("\n").split("\t") if c.strip()]
            if not cells:
                continue
            base, *forms = cells
            yield base, base, forms, {}


def read_plain_list(path: Path):
    with path.open(encoding="utf-8", errors="ignore") as f:
        for line in f:
            w = line.strip()
            if w:
                yield w, w, [], {}


def read_dariusk(path: Path):
    data = json.loads(path.read_text(encoding="utf-8"))
    for item in data.get("verbs", []):
        present = item.get("present")
        if present:
            yield present, present, [v for k, v in item.items() if k != "present" and v], {}


def read_legend80s(path: Path):
    data = json.loads(path.read_text(encoding="utf-8"))
    for w in data:
        if isinstance(w, str):
            yield w, w, [], {}


def read_verbnet_tarball(path: Path):
    """Members of every VerbNet class, with the class id and name attached."""
    with tarfile.open(path, "r:gz") as tar:
        for member in tar.getmembers():
            if not member.name.endswith(".xml"):
                continue
            f = tar.extractfile(member)
            if f is None:
                continue
            try:
                root = ET.parse(io.BytesIO(f.read())).getroot()
            except ET.ParseError:
                continue
            # VNCLASS at root, VNSUBCLASS nested; MEMBER elements carry the verbs.
            for cls in root.iter():
                if cls.tag not in ("VNCLASS", "VNSUBCLASS"):
                    continue
                cls_id = cls.get("ID", "")
                members = cls.find("MEMBERS")
                if members is None:
                    continue
                for m in members.findall("MEMBER"):
                    name = m.get("name", "")
                    if name:
                        yield name.replace("_", " "), name.replace("_", " "), [], {"verbnet_class": cls_id}


def read_wordnet():
    from nltk.corpus import wordnet as wn

    seen = set()
    for synset in wn.all_synsets("v"):
        for lemma in synset.lemmas():
            name = lemma.name().replace("_", " ")
            if name in seen:
                continue
            seen.add(name)
            yield name, name, [], {}


def ensure_wordnet() -> None:
    import nltk

    for pkg in ("wordnet", "omw-1.4"):
        try:
            nltk.data.find(f"corpora/{pkg}")
        except LookupError:
            nltk.download(pkg, quiet=True)


def lemmatise(word: str) -> str:
    """WordNet morphy, verb POS. Returns the input if WordNet does not know it."""
    from nltk.corpus import wordnet as wn

    base = wn.morphy(word, wn.VERB)
    return base if base else word


def run(cfg: Config) -> pd.DataFrame:
    ensure_wordnet()
    from nltk.corpus import wordnet as wn

    # lemma -> aggregated record
    records: dict[str, dict] = defaultdict(
        lambda: {"forms": set(), "sources": set(), "verbnet_classes": set(), "raw_surface": set()}
    )

    readers = {
        "hossein1376": read_hossein,
        "monolithpl": read_monolith,
        "stanford_verbnet": read_plain_list,
        "dariusk_corpora": read_dariusk,
        "legend80s": read_legend80s,
        "verbnet33": read_verbnet_tarball,
    }

    source_counts: dict[str, int] = {}

    for name, url in SOURCES.items():
        path = _download(cfg, name, url)
        count = 0
        for surface, base, forms, meta in tqdm(readers[name](path), desc=name, unit="verb", leave=False):
            cleaned = _clean(base or surface)
            if not cleaned:
                continue
            lemma = lemmatise(cleaned)
            rec = records[lemma]
            rec["sources"].add(name)
            rec["raw_surface"].add(surface.strip().lower())
            if cleaned != lemma:
                rec["forms"].add(cleaned)
            for fm in forms:
                fc = _clean(fm)
                if fc and fc != lemma:
                    rec["forms"].add(fc)
            if " " in surface.strip():
                rec["forms"].add(surface.strip().lower())
            if meta.get("verbnet_class"):
                rec["verbnet_classes"].add(meta["verbnet_class"])
            count += 1
        source_counts[name] = count

    count = 0
    for surface, base, _forms, _meta in tqdm(read_wordnet(), desc="wordnet", unit="verb", leave=False):
        cleaned = _clean(base)
        if not cleaned:
            continue
        lemma = lemmatise(cleaned)
        rec = records[lemma]
        rec["sources"].add("wordnet")
        rec["raw_surface"].add(surface)
        if " " in surface:
            rec["forms"].add(surface)
        count += 1
    source_counts["wordnet"] = count

    rows = []
    for lemma in sorted(records):
        rec = records[lemma]
        in_wordnet = bool(wn.synsets(lemma, pos=wn.VERB))
        rows.append(
            {
                "lemma": lemma,
                "forms": sorted(rec["forms"]),
                "sources": sorted(rec["sources"]),
                "source_count": len(rec["sources"]),
                "in_wordnet": in_wordnet,
                "verbnet_classes": sorted(rec["verbnet_classes"]),
                # A verb seen in one non-WordNet source and unknown to WordNet is
                # kept (the brief was "take all") but flagged, so it can be filtered
                # in analysis. legend80s, for instance, contains "absorbedthe".
                "unverified": (not in_wordnet) and len(rec["sources"]) < 2,
            }
        )

    df = pd.DataFrame(rows)
    if cfg.limit:
        # Smoke-test cap: prefer verified verbs so the sample is meaningful.
        df = df.sort_values(["unverified", "source_count"], ascending=[True, False]).head(cfg.limit)
        df = df.sort_values("lemma").reset_index(drop=True)

    df.insert(0, "id", range(len(df)))
    df.to_parquet(cfg.verbs_parquet, index=False)

    Provenance.load(cfg).stamp(
        cfg,
        "01_collect",
        verbs=len(df),
        unverified=int(df["unverified"].sum()),
        source_counts=source_counts,
        sources={**SOURCES, "wordnet": "nltk corpus"},
        limit=cfg.limit,
    )
    print(f"[01_collect] {len(df):,} lemmas ({int(df['unverified'].sum()):,} unverified) -> {cfg.verbs_parquet}")
    return df


if __name__ == "__main__":
    run(Config())
