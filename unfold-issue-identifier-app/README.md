# UNFOLD

**U**ncovering **N**eeds and **F**rictions in **O**rdinary **L**ived **D**ays

A web-based research instrument that identifies the small, everyday difficulties people
run into during an ordinary day — and does it without asking them to remember any.

Viti Mehra · Sankar Balasubramanian

---

## What this is, and why it works the way it does

The target of the study is what we call a **user issue**: a difficulty small enough that a
person adapts to it, works around it, and forgets it within the hour. The geyser that takes
twelve minutes to heat. The form that makes you re-enter what you already entered. The
thing you go looking for every single morning.

These are precisely the difficulties that surveys and interviews cannot reach. Asked "what
problems are you facing?", people report the large, bottleneck-shaped ones. The small
frictions do not survive the trip to conscious recall, because adapting to something is
what stops you noticing it.

So the instrument does not ask. It triggers **recognition** instead of **recall**:

1. **Day Reconstruction Board** — the spine. The participant rebuilds *yesterday* as a
   sequence of episodes along a 24-hour strip and tags each with an emotion token. This is
   a gamified Day Reconstruction Method (Kahneman et al., 2004), which exists precisely
   because generalised self-report fails and episodic anchoring does not.
2. **The Saboteur** — a mini-game fired at episodes tagged negatively. "Make this moment
   worse." Reverse-brainstorming bypasses the *do I have a complaint?* gate entirely,
   because inventing a harm is a different act from confessing one, and what people reach
   for first is almost always what already grates.
3. **Forced-choice pairs** — "which of these two would you pay to delete?" Produces a
   severity ranking without asking anyone to rate anything.
4. **The rating screen** — the issues found in their day, shown back for a 1–5 severity
   rating, with the option to reject or edit each one. Two to three plausible-but-fabricated
   **foils** are seeded among them to measure acquiescence bias, and are disclosed at debrief.

A session takes about 20 minutes. Participants are aged 15–50.

## The CAE framework

Each identified issue is written as a **CAE** triple:

| Slot | Holds | Example |
| --- | --- | --- |
| **Cause** | The trigger — the condition or mechanism | the geyser takes 12 minutes to heat |
| **Affect** | The emotional response | the participant feels impatient and stuck |
| **Effect** | The consequence for *that person's* activity or goal | the morning runs late and they leave home rushed |

Two rules that the extraction prompt depends on:

- **Atom level.** "The geyser takes 12 minutes to heat" is one issue, not part of a broader
  "morning bathroom sequencing" issue. If one episode yields three atoms, the participant
  rates three separate cards.
- **Effect is bounded to the person.** A societal consequence — "making the younger
  generation unfit to work" — sits outside the atom and is not captured in this slot.

Every slot is always filled; where the participant did not supply one, the model infers it.
Each slot therefore carries a `provenance` value of `participant` or `inferred`, so analysis
can separate what was said from what was filled in.

This feeds a larger research programme in which user issues become **AOPC** problem
statements (action, object, party, context), and solutions are structured as **PP**
(principle, phenomenon) for ideas and **OC** (object, characteristics) for concepts.

## Repository layout

```
unfold-issue-identifier-app/
├── backend/              Node + Express + SQLite  →  Railway
│   ├── src/
│   │   ├── content/      Consent, demographics, game content, foils,
│   │   │                 the extraction prompt, the post-questionnaire
│   │   ├── db/           schema.sql (24 tables, all six phases) and migration
│   │   ├── middleware/   Auth, errors, rate limits
│   │   ├── routes/       API surface
│   │   ├── scripts/      Researcher account seeding
│   │   └── services/     Sessions, extraction, issues, analysis, export
│   └── tests/            94 API tests
├── frontend/             React + Vite  →  Vercel
│   ├── src/
│   │   ├── api/          Fetch client
│   │   ├── components/   Day strip, layout, form primitives, consent form
│   │   ├── pages/        Participant journey and the researcher dashboard
│   │   │   ├── game/     Day board, Saboteur, forced choice
│   │   │   └── admin/    Analysis and issue-corpus views
│   │   ├── state/        Session context, telemetry buffer
│   │   └── styles/       Design tokens
│   └── tests/            48 render tests
├── database/             Local SQLite file lives here (git-ignored)
└── docs/                 DEPLOYMENT.md, INSTRUMENT.md
```

## Participant journey

```
Landing → Age gate ─┬─ 18+  → Consent ──────────────────────────┐
                    │                                            ├→ Demographics
                    └─ 15–17 → Guardian QR handoff → Assent ─────┘        ↓
                                                                          ↓
        Day board  →  Emotion tagging  →  The Saboteur  →  Forced choice
                                                                          ↓
                                              Claude extraction (CAE)
                                                                          ↓
                                Rating screen  (18 real + 3 foils, 1–5)
                                                                          ↓
                                              Post-questionnaire
                                                                          ↓
                                    Debrief + end card (foils disclosed)
```

Under-18s cannot proceed on their own. The participant's screen shows a QR code and a
six-character code; the guardian opens it **on their own device**, reads a separately
authored information sheet, and decides there. That produces a timestamped, independently
actioned consent record — which is what an ethics committee actually wants to see — with no
email service in the loop. The young person then gives their own assent, because a
guardian's permission is not the same as the participant's agreement.

## Running it locally

Requires Node 20+.

```bash
cd backend && npm install && cp .env.example .env && npm run migrate && npm run dev
```

```bash
cd frontend && npm install && npm run dev
```

The frontend proxies `/api` to `http://localhost:4000`, so no frontend environment
variables are needed in development.

Create the two researcher accounts:

```bash
cd backend
ADMIN_VITI_PASSWORD='...' ADMIN_SANKAR_PASSWORD='...' npm run seed:admins
```

Then sign in at `/admin` as `viti` or `sankar`.

Tests:

```bash
cd backend && npm test     # 94 API and unit tests
cd frontend && npm test    # 48 render tests
```

The backend suite runs with `LLM_ENABLED=false`, so it exercises the rule-based
fallback rather than spending API credits. Claude's response handling is covered
separately by unit tests over the JSON parser and the CAE normaliser.

Deployment to Vercel and Railway: see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
The research decisions behind the instrument — token set, Saboteur, foils, how to
read the acquiescence check: see [docs/INSTRUMENT.md](docs/INSTRUMENT.md).

## Before you run this with real participants

Three things in this repository are deliberately incomplete, because they are yours to fill:

1. **Contact details.** `backend/src/content/consent.js` holds `STUDY_CONTACTS` with five
   `[REPLACE-WITH-...]` markers: two researcher emails, the affiliation, the ethics
   committee email, and the approval number. Nothing else in the codebase hard-codes a
   contact. The UI hides any value still holding a marker, so a placeholder can never
   appear on a participant's screen — but a consent form with no reachable contact will not
   satisfy a committee.
2. **Consent wording.** The three documents in that same file are complete and ready to
   use, but they were drafted here rather than approved by your committee. Check them
   against what your approval actually covers.
3. **The Anthropic key.** It goes in the *backend* environment only. A key placed in a Vite
   `.env` is compiled into the public bundle and readable by anyone who opens the site.

## Data protection notes

- No accounts, no passwords, no names beyond an optional first name.
- Sessions are identified by a random UUID and a readable participant code (`P001`).
- Bearer tokens are stored as SHA-256 digests; the plaintext exists only in the browser.
- IP addresses are stored only as a salted hash, never raw.
- Withdrawal deletes every row belonging to the participant and destroys their token. A
  stub row survives in `withdrawals` holding only the participant code and a timestamp, so
  you can demonstrate the request was honoured without retaining any of the data.
- Withdrawn participants are excluded from every export.
- Researcher access is per-account, and every export, participant view and researcher-
  initiated deletion is written to `admin_audit_log` with the actor named.

## A constraint worth holding in mind

SQLite on a Railway volume requires the service to stay at **a single replica**. Scaling to
two will corrupt the database. This is pinned in `backend/railway.json` (`numReplicas: 1`)
and is the one deployment setting you must not change.

## Development status

| Phase | Scope | State |
| --- | --- | --- |
| 1 | Scaffold, consent, guardian handoff, demographics, admin dashboard, export | **Done** |
| 2 | Day board, scene content, Saboteur, forced-choice rounds | **Done** |
| 3 | Claude extraction, CAE structuring, rule-based fallback | **Done** |
| 4 | Rating screen, foils, post-questionnaire, debrief | **Done** |
| 5 | Dashboard analysis views | **Done** |
| 6 | Accessibility and mobile pass | **Done** |

The application is complete and deployable. What remains is yours: the contact block, a
review of the consent wording against your approval, and the API key.
