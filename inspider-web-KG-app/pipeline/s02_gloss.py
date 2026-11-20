"""
Step 2 - Attach a definition, frequency and VerbNet class to every verb.

The gloss is what gets embedded alongside the verb. Embedding the bare word
"rise" gives an ambiguous signal (rise the verb? bread? the noun?); embedding
"rise: to move from a lower position to a higher one" gives markedly better
neighbours. WordNet supplies this for free and offline.

Verbs WordNet does not know get either a GPT-written gloss (opt-in, costs a few
dollars across a corpus) or fall back to the bare verb, which is recorded in
`gloss_source` so the two are distinguishable downstream.
"""
from __future__ import annotations

import asyncio
import json

import pandas as pd
from tqdm import tqdm

from .config import Config, Provenance

MAX_SYNSETS = 2  # glosses joined for polysemous verbs; more dilutes the vector


def wordnet_gloss(lemma: str) -> tuple[str | None, int]:
    from nltk.corpus import wordnet as wn

    synsets = wn.synsets(lemma, pos=wn.VERB)
    if not synsets:
        return None, 0
    parts = []
    for s in synsets[:MAX_SYNSETS]:
        d = s.definition().strip()
        if d:
            parts.append(d)
    return ("; ".join(parts) if parts else None), len(synsets)


def zipf_frequency(lemma: str) -> float:
    try:
        from wordfreq import zipf_frequency as zf

        return float(zf(lemma, "en"))
    except Exception:
        return 0.0


async def gpt_glosses(cfg: Config, lemmas: list[str]) -> dict[str, str]:
    """One-line glosses for verbs WordNet lacks. Batched, concurrent, best effort."""
    from openai import AsyncOpenAI

    client = AsyncOpenAI(api_key=cfg.openai_api_key)
    sem = asyncio.Semaphore(cfg.concurrency)
    out: dict[str, str] = {}

    async def one(batch: list[str]) -> None:
        prompt = (
            "For each English verb below, write a one-line dictionary definition of its verb "
            "sense, under 20 words, no examples. Return ONLY a JSON object mapping verb to definition.\n\n"
            + "\n".join(batch)
        )
        async with sem:
            for attempt in range(4):
                try:
                    resp = await client.chat.completions.create(
                        model=cfg.chat_model,
                        messages=[{"role": "user", "content": prompt}],
                        temperature=0,
                        response_format={"type": "json_object"},
                    )
                    text = resp.choices[0].message.content or "{}"
                    data = json.loads(text)
                    for k, v in data.items():
                        if isinstance(v, str) and v.strip():
                            out[k.strip().lower()] = v.strip()
                    return
                except Exception:
                    await asyncio.sleep(2**attempt)

    batches = [lemmas[i : i + 40] for i in range(0, len(lemmas), 40)]
    for coro in tqdm(asyncio.as_completed([one(b) for b in batches]), total=len(batches), desc="gpt gloss", leave=False):
        await coro
    return out


def run(cfg: Config) -> pd.DataFrame:
    df = pd.read_parquet(cfg.verbs_parquet)

    glosses, synset_counts, gloss_sources, freqs = [], [], [], []
    for lemma in tqdm(df["lemma"], desc="wordnet gloss", unit="verb", leave=False):
        g, n = wordnet_gloss(lemma)
        glosses.append(g)
        synset_counts.append(n)
        gloss_sources.append("wordnet" if g else None)
        freqs.append(zipf_frequency(lemma))

    df["gloss"] = glosses
    df["synset_count"] = synset_counts
    df["gloss_source"] = gloss_sources
    df["zipf_frequency"] = freqs

    missing = df[df["gloss"].isna()]["lemma"].tolist()
    gpt_used = 0
    if missing and cfg.gpt_gloss_missing and cfg.openai_api_key:
        found = asyncio.run(gpt_glosses(cfg, missing))
        mask = df["lemma"].isin(found.keys())
        df.loc[mask, "gloss"] = df.loc[mask, "lemma"].map(found)
        df.loc[mask, "gloss_source"] = "gpt"
        gpt_used = int(mask.sum())

    still_missing = df["gloss"].isna()
    df.loc[still_missing, "gloss_source"] = "none"

    # The text that gets embedded. A verb with no gloss is embedded as the bare
    # word with its part of speech, which is the honest minimum.
    df["embed_text"] = [
        f"{l}: {g}" if isinstance(g, str) and g else f"{l} (verb)" for l, g in zip(df["lemma"], df["gloss"])
    ]

    df.to_parquet(cfg.glossed_parquet, index=False)
    Provenance.load(cfg).stamp(
        cfg,
        "02_gloss",
        verbs=len(df),
        wordnet_glossed=int((df["gloss_source"] == "wordnet").sum()),
        gpt_glossed=gpt_used,
        no_gloss=int(still_missing.sum()),
        max_synsets_per_gloss=MAX_SYNSETS,
    )
    print(
        f"[02_gloss] wordnet {int((df['gloss_source']=='wordnet').sum()):,} · gpt {gpt_used:,} · "
        f"none {int(still_missing.sum()):,} -> {cfg.glossed_parquet}"
    )
    return df


if __name__ == "__main__":
    run(Config())
