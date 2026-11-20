# VITIS

**V**erb-**I**nspired **T**raversal from **I**ssues to **S**olutions

*Vitis* is Latin for vine — a plant that spreads by strands, which is what the Inspider web
is. A within-subject study instrument that takes a participant from a small everyday
annoyance to rendered product concepts by three routes, and records everything.

Viti Mehra · Sankar Balasubramanian — Illusion of Novelty project.

## The study, as the participant experiences it

```
 1  Describe an issue        talk or type, freely
 2  CAE                      AI structures it into cause / affect / effect; participant edits, removes, confirms
 3  Problems                 AI lists the design problems behind the issues; participant picks the most prominent
 4  AOPC                     AI structures it as action / object / party / context; participant confirms
 5  Traditional              participant writes 5 ideas by hand  (AI restructures each into PP, raw text kept)
 6  Modern AI    ┐ order     AI generates 5 PP ideas straight from the AOPC
 7  Inspider     ┘ counter-  AI proposes 5 verbs → participant picks, adds → web shows each verb's 5 neighbours →
                 balanced    participant picks up to 3 per verb → the pool is cut to the 5 most mutually distant
                             verbs (farthest-point sampling on the web's embeddings; participant may swap one) →
                             AI web-searches 3 phenomena per kept verb, appends them to the web →
                             AI generates 5 PP ideas, one per verb, each inspired by that verb's phenomena
 8  Rate ideas               all 15 pooled and shuffled; novelty / usefulness / feasibility 1–5, blind to condition
    (meanwhile)              AI turns every idea into an OC concept and renders a product shot (plus an in-use
                             scene if the console switch is on), in the background
 9  Rate concepts            15, shuffled, blind
10  Rate renders             15 × (product shot + in-use scene), shuffled, blind
11  Done
```

Traditional always comes first so the participant's own ideas are never contaminated by the
AI's. Odd-numbered participants then get Modern → Inspider, even-numbered get Inspider →
Modern. The order is stored and can be changed in the console until an automatic condition
has run.

## The notation

Taken verbatim from the project document and encoded in every prompt (`backend/app/content/prompts.py`):

| Thing | Notation | Slots |
| --- | --- | --- |
| User issue | **CAE** | cause (trigger) · affect (emotion) · effect (consequence for that person) |
| Problem | **AOPC** | action · object · party · context |
| Idea — *what should happen* | **PP** | principle · phenomenon |
| Concept — *how it should happen* | **OC** | object · characteristics |

## Run it locally

Requires Python 3.11+ and Node 18+, and a **built Inspider web** (`inspider-web-KG-app/data`
with real embeddings — VITIS refuses to import a dev build).

```powershell
.\run.ps1          # Windows
```
```bash
./run.sh           # macOS / Linux
```

First run creates `.env` and stops. Fill in:

- `ANTHROPIC_API_KEY` — Claude Opus 5, for everything textual and the phenomena web search
- `OPENAI_API_KEY` — `gpt-image-1` renders, and embeddings for phenomenon nodes
- `SECRET_SALT` — any long random string
- `EXPERIMENTER_VITI_PASSWORD`, `EXPERIMENTER_SANKAR_PASSWORD` — the two console accounts

Run again. It builds the venv, installs, imports the Inspider web into VITIS's database
(once, ~30 s), seeds the accounts, and opens `http://localhost:5175`. The console is at
`/console`.

**Rehearse without spending:** `.\run.ps1 -Mock` / `./run.sh --mock` runs the whole study
with canned AI output and placeholder images. The console shows a warning banner. Never run a
real participant in this mode.

**Tests:** `.\run.ps1 -Test` — 10 tests that walk two full participants (both
counterbalance orders) through every stage in mock mode.

## The experimenter console

`/console`, two named accounts.

- **Participants** — create one with name, age, gender, occupation, education and any other
  details. Username (`P01`, `P02`…) and a 5-character passcode (A–Z 2–9, no confusables) are
  generated, unique, and shown once. The condition order is assigned by participant number.
- **Participant page** — the by-condition summary (mean novelty / usefulness / feasibility for
  ideas, concepts and renders), every stage's data including what the AI wrote *and* what the
  participant changed it to, the Inspider path (keywords → neighbours → phenomena, with what
  was inherited vs freshly generated), the full transcript in order, every AI call with its
  exact prompt, response, tokens, latency and web searches, every image, stage timings.
  Regenerate passcode, change condition order, withdraw, delete.
- **Overview** — counts, token spend, provider, Inspider web size and growth.
- **Inspider web** — look up any verb, see its strands and the phenomena attached; the list of
  phenomena participants have added.
- **Export** — `ratings.csv` (one row per rating with the condition resolved: the analysis
  table) and `export.json` (everything).
- **Access log** — who did what in the console.

## Data

SQLite, via SQLAlchemy, so the Postgres switch is one `DATABASE_URL`. Tables:

`experimenters`, `experimenter_tokens`, `audit_log`, `participants`, `participant_tokens`,
`study_sessions`, `events` (the transcript), `ai_calls` (every model call verbatim),
`issue_inputs`, `cae_issues`, `problems`, `keywords`, `phenomena`, `session_phenomena`,
`ideas`, `concepts`, `renders`, `ratings`, `jobs`, `inspider_nodes`, `inspider_edges`,
`inspider_meta`.

Images live on disk under `IMAGE_DIR/<session>/c<concept>_<product|in_use>.png` and are
served only to the session's participant or an experimenter (`?t=token`).

### The evolving web

The Inspider web (23,268 verbs, 1.16M strands) is imported into `inspider_nodes` /
`inspider_edges`. Every phenomenon a participant's run finds becomes a node of type
`phenomenon`, joined to its verb by an edge of type `phenomenon`, and embedded with the same
model as the web. When a later participant reaches that verb they see what is already there
*and* get 5 fresh ones. Deleting a participant removes their data but not the phenomena they
added — those are the web now.

## Cost per participant

The budget is **≤ $3 per participant** at full study size (5 ideas per condition, 5 verbs
searched, 15 concepts, 15 product renders). The spend is split by what matters:

| Stage | Model / setting | Why | ≈ USD |
| --- | --- | --- | --- |
| CAE, problems, AOPC, traditional, keywords | Sonnet 5 | Structuring with a strict format | 0.07 |
| Phenomena search (5 calls) | Sonnet 5, 2 searches per call | Retrieval; the cost is search results re-read as input tokens, not reasoning | 0.47 |
| Modern ideas, Inspider ideas | **Opus 5** | The creative transfer the study measures | 0.18 |
| Concepts (15) | **Opus 5** | Rated by participants; bridge to the renders | 0.45 |
| Render prompts (15) | Sonnet 5 | Prompt writing | 0.08 |
| Images (15 product) | `gpt-image-1` medium | The product shot is what is judged; the in-use scene (low) is a console switch | 0.63 |
| | | **Total** | **≈ 1.9** (measured $2.48 with 10 searched verbs and in-use scenes on) |

Prices: Opus 5 $5/$25 per M tokens, Sonnet 5 $2/$10, web search $10 per 1,000, images
$0.011/$0.042/$0.167 (low/medium/high). The console prices every logged call from its own
token counts, search count and image quality (`backend/app/services/cost.py`): the Overview
tab shows total spend and the average per completed participant; each participant page shows
their total with a breakdown by stage and model. Knobs, all in `.env`:
`ANTHROPIC_MODEL` / `ANTHROPIC_MODEL_FAST` / `ANTHROPIC_CREATIVE_PURPOSES`,
`CLAUDE_WEB_SEARCH_MAX_USES`, `OPENAI_IMAGE_QUALITY_PRODUCT` / `_IN_USE`, `RENDER_IN_USE`,
`KEYWORDS_FINAL` (0 = one verb per idea), `KEYWORD_SWAPS_MAX`. Each extra searched verb costs
≈ $0.10; the in-use scenes add ≈ $0.17 (low) or $0.63 (medium) per participant.

## Verb selection (the "select" step)

After neighbour picking the pool is `KEYWORDS_PROPOSED` + up to `NEIGHBOURS_MAX_PICK` per
keyword (5 + 15 = 20 with the defaults). `workflow.select_keywords` keeps the K most mutually
distant verbs by cosine distance on the web's embeddings (greedy farthest-point: start with the
verb farthest from the pool's centroid, then repeatedly add the verb whose nearest kept verb
is farthest). K defaults to `IDEAS_PER_CONDITION`. The participant sees kept and set-aside
verbs, may swap one, then confirms. Phenomena are searched for kept verbs only, and the ideas
prompt ties idea *k* to verb *k*, so the five ideas are structurally spread across five verbs.
The `keywords_selected` event records every verb's distance to its nearest kept verb.

## Looking back

Completed steps in the stepper are clickable and open a **read-only** view (issue text, CAE,
problems, AOPC, the participant's own ideas, keywords, strands, chosen verbs, phenomena).
AI-generated ideas are never shown there: they are rated blind. In a rating deck, **Previous**
steps back to an earlier card; re-saving a rating logs a `rating_edited` event.

## Deploy

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md): Vercel for `frontend/`, Railway for `backend/`
with a volume at `/data` holding both the SQLite file and the images.

## Layout

```
vitis-ideation-app/
├── run.ps1 · run.sh · .env.example
├── backend/
│   ├── app/
│   │   ├── main.py            FastAPI app, image route, Inspider import on boot
│   │   ├── config.py · db.py · models.py · seed.py
│   │   ├── content/           prompts.py (the notation, versioned) · consent.py
│   │   ├── services/          ai.py (Claude, images, embeddings, mock) · inspider.py · workflow.py · auth.py
│   │   └── routers/           study.py (participant) · admin.py (console)
│   ├── tests/test_study.py
│   ├── requirements.txt · railway.json
│   └── data/                  sqlite + images + inspider_vectors.npz (git-ignored)
├── frontend/                  React + Vite
│   └── src/pages/             Landing · Login · Consent · Study (+study/stages.jsx) · admin/Console · admin/ParticipantDetail
└── docs/DEPLOYMENT.md
```

Maintainer: sankar-mechengg (sankarb@iisc.ac.in).
