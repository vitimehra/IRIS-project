import { config } from '../config.js';
import { getDb } from '../db/index.js';
import { newId } from './ids.js';
import { PROMPT_VERSION, SYSTEM_PROMPT, buildUserMessage } from '../content/extractionPrompt.js';
import { DOMAINS, TIME_BANDS, EMOTION_TOKENS } from '../content/game.js';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const MAX_TOKENS = 8000;
const TIMEOUT_MS = 120000;

const TOKEN_LABEL = new Map(EMOTION_TOKENS.map((t) => [t.key, t.label]));

// ---------------------------------------------------------------------------
// Gathering the evidence
// ---------------------------------------------------------------------------

export function gatherSessionEvidence(sessionId) {
  const db = getDb();

  const game = db
    .prepare(`SELECT * FROM game_sessions WHERE session_id = ? ORDER BY started_at DESC LIMIT 1`)
    .get(sessionId);
  if (!game) return null;

  const episodes = db
    .prepare(`SELECT * FROM episodes WHERE game_session_id = ? ORDER BY ordinal`)
    .all(game.id);

  const tagStmt = db.prepare(`SELECT * FROM episode_tags WHERE episode_id = ?`);
  for (const episode of episodes) {
    episode.tags = tagStmt.all(episode.id).map((t) => ({
      ...t,
      label: TOKEN_LABEL.get(t.token_key) || t.token_key,
    }));
  }

  const saboteur = db
    .prepare(`SELECT * FROM saboteur_rounds WHERE game_session_id = ? ORDER BY ordinal`)
    .all(game.id);
  const responseStmt = db.prepare(
    `SELECT * FROM saboteur_responses WHERE saboteur_round_id = ? ORDER BY ordinal`
  );
  for (const round of saboteur) {
    round.responses = responseStmt.all(round.id);
  }

  const pairwise = db
    .prepare(`SELECT * FROM pairwise_rounds WHERE game_session_id = ? ORDER BY ordinal`)
    .all(game.id);

  const demographics = db
    .prepare(`SELECT * FROM demographics WHERE session_id = ?`)
    .get(sessionId);

  return { game, episodes, saboteur, pairwise, demographics };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const PROVENANCE = new Set(['participant', 'inferred']);
const DOMAIN_KEYS = new Set(DOMAINS.map((d) => d.key));
const BAND_KEYS = new Set(TIME_BANDS.map((b) => b.key));

function clean(value, fallback = '') {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

/**
 * Normalises whatever the model returned into rows the schema will accept.
 *
 * Every CAE slot is non-null by design, so a slot the model left blank is
 * filled here and forced to provenance "inferred" — an empty string in the
 * database would be indistinguishable from a real but terse answer.
 */
export function normaliseIssues(raw, { episodeIds = new Set() } = {}) {
  if (!raw || !Array.isArray(raw.issues)) return [];

  const out = [];
  for (const item of raw.issues) {
    if (!item || typeof item !== 'object') continue;

    const cause = clean(item.cause);
    const affect = clean(item.affect);
    const effect = clean(item.effect);
    const headline = clean(item.headline, cause);

    // An issue with no cause and no headline has nothing to show a participant.
    if (!headline && !cause) continue;

    const provenance = (value, slotFilled) => {
      if (!slotFilled) return 'inferred';
      const p = clean(value);
      return PROVENANCE.has(p) ? p : 'inferred';
    };

    const sourceEpisode = clean(item.source_episode_id, '');

    out.push({
      headline: headline || cause,
      cause: cause || headline,
      cause_provenance: provenance(item.cause_provenance, Boolean(cause)),
      affect: affect || 'the participant feels mildly frustrated by this',
      affect_provenance: provenance(item.affect_provenance, Boolean(affect)),
      effect: effect || 'the activity takes longer or needs a second attempt',
      effect_provenance: provenance(item.effect_provenance, Boolean(effect)),
      domain: DOMAIN_KEYS.has(item.domain) ? item.domain : null,
      time_band: BAND_KEYS.has(item.time_band) ? item.time_band : null,
      source_episode_id: episodeIds.has(sourceEpisode) ? sourceEpisode : null,
      source_evidence: clean(item.source_evidence, null) || null,
      confidence:
        typeof item.confidence === 'number' && item.confidence >= 0 && item.confidence <= 1
          ? item.confidence
          : 0.5,
    });
  }

  return out;
}

/** Models sometimes wrap JSON in prose or a fence despite instructions. */
export function parseModelJson(text) {
  if (!text) return null;

  const attempts = [text];

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) attempts.push(fenced[1]);

  const braced = text.match(/\{[\s\S]*\}/);
  if (braced) attempts.push(braced[0]);

  for (const attempt of attempts) {
    try {
      const parsed = JSON.parse(attempt.trim());
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      /* try the next shape */
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// The rule-based fallback
// ---------------------------------------------------------------------------
// Runs when the key is absent, the call fails, or LLM_ENABLED is false. The
// instrument stays complete and demoable either way; the extraction_runs row
// records status 'fallback' so these are never mistaken for model output.

const TOKEN_CAE = {
  rushed: {
    cause: 'there is not enough time allowed for {label} in the participant’s day',
    affect: 'the participant feels hurried and under pressure',
    effect: '{label} gets done partially or hastily, and whatever follows starts late',
  },
  waiting: {
    cause: '{label} involves waiting on something outside the participant’s control',
    affect: 'the participant feels impatient and idle',
    effect: 'time is lost that the participant cannot use for anything else, pushing the rest of the sequence later',
  },
  stuck: {
    cause: 'something in {label} does not work the way the participant expects',
    affect: 'the participant feels blocked and frustrated',
    effect: 'the participant cannot finish {label} without help or a workaround',
  },
  repeating: {
    cause: '{label} requires the participant to supply or do the same thing more than once',
    affect: 'the participant feels exasperated at the duplication',
    effect: 'the participant spends effort on repetition rather than on finishing the task',
  },
  cleaning_up: {
    cause: 'the participant has to undo or redo work left by someone else during {label}',
    affect: 'the participant feels resentful and taken for granted',
    effect: '{label} takes longer than the task itself warrants',
  },
  interrupted: {
    cause: 'the participant is repeatedly pulled away while doing {label}',
    affect: 'the participant feels scattered and unable to settle',
    effect: '{label} is finished in fragments and takes longer overall',
  },
  confused: {
    cause: 'it is not clear to the participant what to do next during {label}',
    affect: 'the participant feels uncertain and hesitant',
    effect: 'the participant pauses to work it out, or guesses and has to correct it',
  },
  put_off: {
    cause: '{label} is unpleasant or effortful enough that the participant delays starting it',
    affect: 'the participant feels reluctant, with a background sense of it hanging over them',
    effect: '{label} is done later than planned, or accumulates until it is larger',
  },
};

export function fallbackExtraction({ episodes, saboteur }) {
  const issues = [];

  for (const episode of episodes) {
    for (const tag of episode.tags || []) {
      const template = TOKEN_CAE[tag.token_key];
      if (!template) continue;

      const label = (episode.label || 'this part of the day').toLowerCase();
      issues.push({
        headline: `${episode.label}: ${TOKEN_LABEL.get(tag.token_key)?.toLowerCase() || tag.token_key}`,
        cause: template.cause.replaceAll('{label}', label),
        cause_provenance: 'inferred',
        affect: template.affect.replaceAll('{label}', label),
        affect_provenance: 'inferred',
        effect: template.effect.replaceAll('{label}', label),
        effect_provenance: 'inferred',
        domain: episode.domain,
        time_band: episode.time_band,
        source_episode_id: episode.id,
        source_evidence: `Tagged "${TOKEN_LABEL.get(tag.token_key) || tag.token_key}" on "${episode.label}".`,
        // Deliberately below anything the model would produce, so real
        // extractions always outrank fallback rows if both ever coexist.
        confidence: 0.4,
      });
    }
  }

  // The Saboteur answers are the participant's own words, so they anchor a
  // participant-grounded Cause. They cannot be copied into the slot verbatim,
  // though: an answer is an imperative describing a hypothetical worsening
  // ("make the geyser take twenty minutes"), not a condition that exists. Left
  // raw it is the wrong shape for a Cause and reads to the participant as an
  // instruction. The model reframes these; the fallback has to say plainly what
  // it actually knows, which is that the participant reached for this first.
  for (const round of saboteur || []) {
    for (const response of round.responses || []) {
      const text = clean(response.response_text);
      if (!text || text.length < 4) continue;
      const episode = episodes.find((e) => e.id === round.episode_id);
      const label = episode?.label || 'that part of the day';

      issues.push({
        headline: `Something about ${label.toLowerCase()} already grates`,
        cause: `asked what would make ${label.toLowerCase()} worse, the participant immediately reached for: ${text}`,
        cause_provenance: 'participant',
        affect: 'the participant feels irritated by this part of the day',
        affect_provenance: 'inferred',
        effect: `${label} takes longer than it should, or has to be done again`,
        effect_provenance: 'inferred',
        domain: episode?.domain || null,
        time_band: episode?.time_band || null,
        source_episode_id: round.episode_id || null,
        source_evidence: text,
        confidence: 0.5,
      });
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// The model call
// ---------------------------------------------------------------------------

async function callClaude({ system, user }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': config.anthropic.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: config.anthropic.model,
        max_tokens: MAX_TOKENS,
        system,
        messages: [{ role: 'user', content: user }],
      }),
      signal: controller.signal,
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Anthropic returned ${response.status}: ${text.slice(0, 500)}`);
    }

    const payload = JSON.parse(text);
    const content = (payload.content || [])
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n');

    return { content, usage: payload.usage || {}, raw: payload };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Runs extraction for one session and records the attempt.
 *
 * Always returns issues. A model failure degrades to the rule-based path rather
 * than leaving a participant staring at an empty results screen twenty minutes
 * into a study.
 */
export async function runExtraction(sessionId) {
  const evidence = gatherSessionEvidence(sessionId);
  if (!evidence) throw new Error('No game session to extract from.');

  const { game, episodes, saboteur, pairwise, demographics } = evidence;
  const episodeIds = new Set(episodes.map((e) => e.id));
  const db = getDb();
  const runId = newId();
  const startedAt = Date.now();

  const userMessage = buildUserMessage({
    demographics,
    game,
    episodes,
    saboteur,
    pairwise,
    domains: DOMAINS,
    timeBands: TIME_BANDS,
  });

  const useModel = config.anthropic.enabled && Boolean(config.anthropic.apiKey);

  if (!useModel) {
    const issues = fallbackExtraction({ episodes, saboteur });
    db.prepare(
      `INSERT INTO extraction_runs (id, session_id, model, prompt_version, status, request_json, latency_ms, error_message)
       VALUES (?, ?, ?, ?, 'fallback', ?, ?, ?)`
    ).run(
      runId,
      sessionId,
      'rule-based',
      PROMPT_VERSION,
      JSON.stringify({ system: SYSTEM_PROMPT, user: userMessage }),
      Date.now() - startedAt,
      config.anthropic.apiKey ? 'LLM_ENABLED is false' : 'No ANTHROPIC_API_KEY configured'
    );
    return { runId, issues, status: 'fallback' };
  }

  try {
    const { content, usage, raw } = await callClaude({ system: SYSTEM_PROMPT, user: userMessage });
    const parsed = parseModelJson(content);
    const issues = normaliseIssues(parsed, { episodeIds });

    if (issues.length === 0) throw new Error('Model returned no usable issues.');

    db.prepare(
      `INSERT INTO extraction_runs (
         id, session_id, model, prompt_version, status, request_json, response_json,
         input_tokens, output_tokens, latency_ms
       ) VALUES (?, ?, ?, ?, 'ok', ?, ?, ?, ?, ?)`
    ).run(
      runId,
      sessionId,
      config.anthropic.model,
      PROMPT_VERSION,
      JSON.stringify({ system: SYSTEM_PROMPT, user: userMessage }),
      JSON.stringify(raw),
      usage.input_tokens ?? null,
      usage.output_tokens ?? null,
      Date.now() - startedAt
    );

    return { runId, issues, status: 'ok' };
  } catch (error) {
    // Record the failure in full, then fall back. The participant should not
    // pay for an API problem.
    const issues = fallbackExtraction({ episodes, saboteur });
    db.prepare(
      `INSERT INTO extraction_runs (
         id, session_id, model, prompt_version, status, request_json, latency_ms, error_message
       ) VALUES (?, ?, ?, ?, 'error', ?, ?, ?)`
    ).run(
      runId,
      sessionId,
      config.anthropic.model,
      PROMPT_VERSION,
      JSON.stringify({ system: SYSTEM_PROMPT, user: userMessage }),
      Date.now() - startedAt,
      String(error?.message || error).slice(0, 2000)
    );

    return { runId, issues, status: 'error', error: String(error?.message || error) };
  }
}
