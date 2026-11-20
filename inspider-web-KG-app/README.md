# Inspider Web Visualizer

*Inspider Web ≈ Inspire Web.* A weighted knowledge graph of English verbs — every verb a
world phenomenon, every strand a cosine similarity between two verbs' embeddings — and a
web app to explore it: search, zoom, hang the web from any verb, walk it for inspiration.

Built from the session deck *13092026 — Knowledge Graph*, for the Illusion of Novelty
project (Viti Mehra · Sankar Balasubramanian).

## Run it

Requires **Python 3.11+** and **Node 18+**. Tested on Python 3.14 / Node 24, Windows 11.

```powershell
# Windows
.\run.ps1
```

```bash
# macOS / Linux
./run.sh
```

First run: creates `.env` from `.env.example` and stops so you can add your key. Put your
`OPENAI_API_KEY` in `.env`, run again, and it will install dependencies, download the verb
sources, build the web (about two minutes), and open the app at `http://localhost:5174`.

**No key yet?** `.\run.ps1 -Dev` / `./run.sh --dev` builds with deterministic pseudo-embeddings
so you can see the interface. The app shows a **dev embeddings** badge, and neighbours are
*not* meaningful — they cluster by spelling, not sense. Never analyse a dev build.

| Flag | Windows | macOS / Linux |
| --- | --- | --- |
| Cost estimate, no API calls | `-Estimate` | `--estimate` |
| Rebuild from scratch | `-Rebuild` | `--rebuild` |
| Build only, don't start servers | `-BuildOnly` | `--build-only` |
| Smoke test on N verbs | `-Limit 2000` | `--limit 2000` |

## What it costs

For the corpus the eight sources actually yield — **23,268 verb lemmas** — embedding each verb
with its WordNet definition is **192k tokens**:

| Model | Once | Batch API |
| --- | --- | --- |
| `text-embedding-3-large` (3072-d, default) | **~$0.025** | ~$0.012 |
| `text-embedding-3-small` (1536-d) | ~$0.004 | ~$0.002 |

Under three cents. Prices are indicative per 1M tokens; `run.ps1 -Estimate` prints the live
count for your build. The run takes 1–3 minutes: requests are batched (1,024 inputs each),
8 in flight, exponential backoff, and every finished batch is checkpointed so a dropped
connection resumes rather than re-pays.

Optional extras, both off by default in `.env`: `GPT_GLOSS_MISSING=true` has a chat model
write definitions for the ~14.5k verbs WordNet lacks (about $0.50–$1); `GPT_NAME_CLUSTERS=true`
names the regions of the map (cents).

## What you get

**The Web.** Search a verb (typo-tolerant, inflected forms resolve — *rising* finds *rise*).
It sits at the hub; its nearest verbs hang on concentric rings by similarity, exactly like the
spider web on slide 1. Cross-strands join neighbours that are also close to each other.
Sliders for strand count, depth (1 or 2 hops) and minimum similarity. Scroll to zoom, drag
to pan, click any node to re-centre, hover a strand for its score.

**The Map.** Every verb as a point on a UMAP projection, coloured by region, WebGL-rendered
so it stays smooth at a hundred thousand points. Labels are budgeted by zoom and frequency;
region names sit at their centroids. Selecting a verb draws its strands over the map.

**Regions.** Leiden community detection on the strands themselves, so a region is a region
of the web rather than of the projection. Named by their most central verbs.

**Tools.**
- *Path* — shortest chain of near-synonyms between two verbs, each strand scored.
- *Serendipity walk* — the ideation mechanic. Start at a verb, walk the web with a "wander"
  dial, and land on a phenomenon connected by the chain but far by the vector. "Leave the
  region" pushes the walk out of the starting verb's own cluster, where the analogies live.
- *Analogy* — vector arithmetic: *rise − sun + moon → ?*
- *Compare* — two verbs: score, shared strands, neighbourhood overlap.

**Also:** pin verbs and export the subgraph they span as CSV, GraphML (Gephi/Cytoscape) or
JSON; a verb detail panel with definition, forms, frequency, hubness, VerbNet classes and
source provenance; "Surprise me"; keyboard search with `/`.

## The data

Everything the pipeline writes lives in `data/` (git-ignored, rebuildable):

| File | Format | Holds |
| --- | --- | --- |
| `verbs.parquet` | Parquet | the lemma list: forms, sources, VerbNet classes, verification flag |
| `verbs_glossed.parquet` | Parquet | + definition, gloss source, zipf frequency, the text that was embedded |
| `embeddings.npz` | NPZ, float16, L2-normalised | one vector per verb, ~120 MB at 23k × 3072 |
| `edges.parquet` | Parquet | the web: `src, dst, sim, rank` — top-50 per verb, ~1.2M rows |
| `nodes.parquet` | Parquet | everything above + `x, y` (UMAP), `cluster_id`, `in_degree`, `pagerank`, `size` |
| `clusters.parquet` | Parquet | region id, name, size, central verbs, centroid |
| `inspider.duckdb` | DuckDB | SQL over all of the above, no server needed |
| `faiss.index` | FAISS | exact inner-product index over the vectors |
| `provenance.json` | JSON | per-stage stamps: model, dims, k, timings, token usage, source list |

Query it from anywhere:

```python
import duckdb
con = duckdb.connect("data/inspider.duckdb", read_only=True)
con.sql("""
  SELECT b.lemma, e.sim FROM edges e
  JOIN nodes a ON a.id = e.src JOIN nodes b ON b.id = e.dst
  WHERE a.lemma = 'rise' ORDER BY e.sim DESC LIMIT 10
""").show()
```

Schema details and the reasoning behind each format are in [docs/DATA.md](docs/DATA.md).

## The pipeline

Six stages, matching slide 11 of the deck, each idempotent and resumable:

| Stage | Does | Output |
| --- | --- | --- |
| `01_collect` | downloads the 7 sources from slide 7 + WordNet, dedupes, lemmatises | `verbs.parquet` |
| `02_gloss` | attaches WordNet definitions, frequency, builds the embed text | `verbs_glossed.parquet` |
| `03_embed` | OpenAI / local / dev, batched, checkpointed | `embeddings.npz` |
| `04_knn` | exact top-k cosine via FAISS — the full N×N matrix is never built | `edges.parquet` |
| `05_layout` | UMAP 2-D, Leiden clusters, naming, hubness | `nodes.parquet`, `clusters.parquet` |
| `06_index` | DuckDB over the Parquet | `inspider.duckdb` |

```bash
python -m pipeline.build              # all stages, skipping ones already built
python -m pipeline.build --from 03    # re-embed and everything after
python -m pipeline.build --only 05    # just relayout / recluster
```

### Two decisions the deck left open

**"Store the similarities in a matrix" (slide 11, step 3) is not done literally.** At one
lakh verbs a full matrix is 10¹⁰ entries — 20 GB at float16. The web is a **k-nearest-neighbour
graph**: each verb keeps its 50 most similar (`KNN_K` in `.env`). Any other pair is scored on
demand from the stored vectors; `/api/similarity?a=…&b=…` does exactly that.

**The score is cosine similarity, 1 = identical** (slide 8's formula), not the cosine
*distance* slide 5 describes. Every number in the app and in `edges.sim` follows this.

### On "one lakh verbs"

The sources yield 23,268 distinct lemmas, of which 12,715 are flagged `unverified`: found in
a single source and unknown to WordNet. Almost all come from one scrape (`bepearl`, `helicopt`,
`ajaxify`, `ruby`). They are kept — the brief was "take all" — but the app hides them by
default behind the **unverified** toggle in the top bar, and `nodes.unverified` lets you
filter them in analysis. English simply does not have a lakh of verb lemmas; getting there
would mean counting inflections or phrasal verbs as separate nodes, which was decided against.

## Layout

```
inspider-web-KG-app/
├── run.ps1 · run.sh        one command to build and run
├── .env.example            key, model, dims, k, ports
├── requirements.txt
├── pipeline/               the six stages + build.py + config.py
├── backend/                FastAPI: store.py (in-RAM web), app.py (routes), tests/
├── frontend/               React + Vite: web (SVG radial), map (deck.gl), regions, tools
├── data/                   outputs (git-ignored)
└── docs/DATA.md            file formats and query recipes
```

Tests: `.venv/Scripts/python -m pytest backend/tests` (19 tests, run against whatever is built).

## API

All read-only, bound to localhost. `unverified=true` on any endpoint includes flagged verbs.

| Endpoint | Returns |
| --- | --- |
| `GET /api/meta` | counts, model, k, full provenance |
| `GET /api/search?q=` | typo-tolerant matches with reason (exact / form / prefix / fuzzy) |
| `GET /api/verbs/{lemma}` | full detail |
| `GET /api/verbs/{lemma}/neighbours?k=&min_sim=` | ranked strands |
| `GET /api/ego?term=&k=&depth=` | the web around a verb, nodes + edges |
| `GET /api/similarity?a=&b=` · `GET /api/compare?a=&b=` | any pair |
| `POST /api/analogy` `{positive, negative, k}` | vector arithmetic |
| `GET /api/path?from=&to=` | weighted shortest path |
| `GET /api/walk?start=&steps=&temperature=&avoid_cluster=` | serendipity walk |
| `GET /api/clusters` · `GET /api/clusters/{id}` | regions and members |
| `GET /api/map` | all points, compact |
| `GET /api/export/subgraph?ids=&format=csv\|graphml\|json` | a chosen subgraph |
