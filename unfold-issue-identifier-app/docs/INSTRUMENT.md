# The instrument

Reference for the parts of UNFOLD that are research decisions rather than
engineering ones. If you change anything here, the data before and after the
change is not comparable — so bump the relevant version constant when you do.

---

## 1. The day board

**Anchor.** Yesterday, by date. The participant is asked whether it was an
ordinary day; either answer proceeds, and the answer is stored in
`game_sessions.anchor_is_typical`. Filter on it during analysis if a participant
rebuilt a wedding.

Anchoring to one real day rather than "a typical day" is the whole basis of the
Day Reconstruction Method: episodic recall is substantially more accurate than
generalised self-report, and generalised self-report is what the study is trying
to escape.

**Seeding.** The board arrives pre-populated with 8–12 suggested episodes chosen
from the participant's own demographics (`selectStarterEpisodes` in
`backend/src/content/game.js`). A remote worker is not offered a commute; a
participant with children is offered "getting someone else ready".

This is deliberate. A blank board yields four episodes and a thin day. A seeded
board the participant corrects yields ten and an honest one. The cost is a
suggestion effect, which is mitigated by making removal a single tap and by
recording `episodes.source` so template-derived and participant-written episodes
can be separated in analysis.

**Version:** `GAME_CONTENT_VERSION`, stored on every `game_sessions` row.

---

## 2. Emotion tokens

Ten tokens, eight of them friction-shaped and two positive:

| Token | Negative | Reads as |
| --- | --- | --- |
| `rushed` | yes | Not enough time for it |
| `waiting` | yes | Stuck waiting on something or someone |
| `stuck` | yes | Could not get it to work |
| `repeating` | yes | Had to do or say it again |
| `cleaning_up` | yes | Undoing someone else's mess |
| `interrupted` | yes | Kept getting pulled away |
| `confused` | yes | Not sure what to do next |
| `put_off` | yes | Avoided it, or pushed it later |
| `fine` | no | Went as expected |
| `good` | no | Actually enjoyed it |

These are shaped like *kinds of friction*, not points on a happiness scale,
because the study wants to know what form the difficulty took rather than how
the participant felt overall.

The two positive tokens are not decoration. Without them, the board reads as a
complaint form and every moment gets a negative tag by default. Leaving an
episode untagged is also explicitly offered as a real answer.

`is_negative` is stored per tag, and it is what the Saboteur and the forced-choice
rounds select on.

---

## 3. The Saboteur

Fires at up to **five** episodes, chosen by negative-tag count descending.

Four prompt forms, assigned deterministically by round index so the same episode
always draws the same prompt:

1. Ruin it outright.
2. Make it worse without the participant noticing straight away.
3. Make it take twice as long.
4. Force it to be done all over again.

Up to three answers per round; skipping is offered on equal footing and recorded
as `skipped`.

**Why reverse-brainstorming.** Asking "what annoyed you?" runs into the same
recall gate the whole study exists to defeat, and it also asks the participant to
confess a complaint. Asking them to *invent* a harm is a different cognitive act
with no such gate, and what people reach for first is almost always an
intensification of something already present.

**Latency is data.** `saboteur_responses.response_ms` is measured from the first
keystroke, not from when the screen appeared — reading time is not thinking time.
A four-second answer is usually lived. A forty-second one is usually invented.

---

## 4. Forced choice

Up to **eight** rounds, pairing negatively tagged episodes by rotation rather
than randomly, so the pairing is reproducible from the stored ordinals when you
come to analyse it.

"Which would you rather never do again?" produces a ranking without asking anyone
to rate anything. A direct severity question invites people to be even-handed; a
forced choice does not let them. A tie option exists and is recorded as
`skipped` rather than being hidden.

---

## 5. Extraction

**Model:** `claude-opus-5`, server-side only, one call at the end of the session.
**Prompt:** `backend/src/content/extractionPrompt.js`, version-stamped on every
`extraction_runs` row along with the exact request and response.

The prompt encodes four rules that the study depends on:

1. **Scope.** If a participant would have mentioned it when asked "what problems
   are you facing?", it is too big and out of scope.
2. **Atom level.** "The geyser takes twelve minutes to heat" is one issue. It is
   not rolled up into "morning bathroom sequencing".
3. **Affect is an emotion.** An inability or a delay in the Affect slot means an
   Effect has been put there.
4. **Effect is bounded to the person.** Societal consequences sit outside the atom.

**No empty slots, with provenance.** Where the participant did not supply a slot,
the model infers it and marks that slot `inferred`; slots supported by the
participant's own words are marked `participant`. The normaliser enforces this:
any slot the model leaves blank is filled and forced to `inferred`, because an
empty string in the database is indistinguishable from a real but terse answer.

Watch the provenance rates on the dashboard. A corpus that is ninety percent
inferred is describing the model's priors, not anybody's day.

**The fallback.** With no API key, or `LLM_ENABLED=false`, or an API failure,
extraction takes a rule-based path and the run is recorded as `fallback` or
`error` — never as model output. The instrument stays complete, which is how you
pilot or demo it without spending credits.

The fallback reframes Saboteur answers rather than copying them. An answer is an
imperative about a hypothetical worsening ("make the geyser take twenty minutes"),
which is the wrong shape for a Cause and reads to a participant as an
instruction. It becomes "asked what would make waking up worse, the participant
immediately reached for: …", with the raw answer preserved in `source_evidence`.

---

## 6. The rating deck

**18 real issues + 3 foils.** Everything extracted is stored; only the top 18 by
confidence are shown. A participant rating thirty cards at minute eighteen of a
twenty-minute session gives you fatigue noise, not data. The remainder stay in
the export with `shown_to_participant = 0`.

**Foils** are plausible-but-fabricated issues drawn from domains the
participant's own day did *not* touch, so a foil is never accidentally true for
them. They are spread through the deck at computed intervals rather than
appended — three unfamiliar cards in a row at the end is trivially detectable,
and a detectable foil measures nothing.

`is_foil` is never sent to the browser. Opening the network tab reveals nothing.

**Two design choices on the rating screen itself:**

- Recognition is asked before severity. "Is this yours?" and "how bad is it?" are
  different questions; collapsing them into one scale loses the first.
- "This one is not me" sits at the same visual weight as the scale. If rejecting
  is harder than agreeing, everybody agrees — which is the exact bias the foils
  exist to measure.

Participants can rewrite any slot. Both versions are kept: `issues` holds what
was offered, `issue_ratings.edited_*` holds what they meant.

---

## 7. Reading the foil check

On the dashboard's Analysis tab, per participant:

| Column | Means |
| --- | --- |
| Real mean | Mean severity of their genuine issues |
| Foil mean | Mean severity of the three fabrications |
| Gap | Real minus foil. **Bigger is healthier.** |
| Foils rejected | How many of three they caught |

A participant is **flagged** when the gap is under 0.5 — they rated inventions
about as severely as their own life. That does not make them a bad participant;
it makes their severity row weak evidence. Look at the flagged rows by hand
before including them in any mean.

A negative gap means they rated the fabrications *higher* than their real issues,
which usually indicates they were not reading.

Note that the foils are disclosed at debrief. That disclosure is not optional —
it is what keeps the deception minimal and defensible, and your ethics committee
will expect to see it.

---

## 8. Version constants

Bump these when you change the thing they name. Each is stored on the rows it
produced, so data from before and after a change stays distinguishable.

| Constant | File | Stamped on |
| --- | --- | --- |
| `CONSENT_VERSION` | `content/consent.js` | `consent_records.document_version` |
| `DEMOGRAPHICS_VERSION` | `content/demographics.js` | `demographics.raw_payload` |
| `GAME_CONTENT_VERSION` | `content/game.js` | `game_sessions.content_version` |
| `PROMPT_VERSION` | `content/extractionPrompt.js` | `extraction_runs.prompt_version` |
| `FOIL_VERSION` | `content/foils.js` | (families named in `issues.foil_family`) |
| `POST_QUESTIONNAIRE_VERSION` | `content/postQuestionnaire.js` | response rows carry their question text |
| `SCHEMA_VERSION` | `db/migrate.js` | `schema_meta`, and every export |

Consent items and questionnaire questions additionally store the **exact text
shown** alongside each response, so a later revision never makes an old record
ambiguous.
