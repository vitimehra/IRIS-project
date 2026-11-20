import { getDb } from '../db/index.js';
import { DOMAINS, TIME_BANDS, EMOTION_TOKENS } from '../content/game.js';

/**
 * Analysis views for the researcher dashboard.
 *
 * Everything here excludes withdrawn participants by construction: withdrawal
 * deletes the child rows, so a withdrawn session simply has nothing to count.
 */

const DOMAIN_LABEL = new Map(DOMAINS.map((d) => [d.key, d.label]));
const BAND_LABEL = new Map(TIME_BANDS.map((b) => [b.key, b.label]));
const TOKEN_LABEL = new Map(EMOTION_TOKENS.map((t) => [t.key, t.label]));

/**
 * The acquiescence check.
 *
 * Foils exist to be rejected. A participant who rates the fabricated issues as
 * severely as their real ones is yea-saying, and their whole row should be
 * treated with suspicion. This surfaces that per participant and in aggregate,
 * because it is the first thing to look at before believing any severity mean.
 */
export function foilAnalysis() {
  const db = getDb();

  const perSession = db
    .prepare(
      `SELECT s.id, s.participant_code,
              AVG(CASE WHEN i.is_foil = 0 AND r.rejected = 0 THEN r.severity END) AS real_mean,
              AVG(CASE WHEN i.is_foil = 1 AND r.rejected = 0 THEN r.severity END) AS foil_mean,
              SUM(CASE WHEN i.is_foil = 1 AND r.rejected = 1 THEN 1 ELSE 0 END) AS foils_rejected,
              SUM(CASE WHEN i.is_foil = 1 THEN 1 ELSE 0 END) AS foils_shown,
              SUM(CASE WHEN i.is_foil = 0 AND r.rejected = 1 THEN 1 ELSE 0 END) AS real_rejected,
              SUM(CASE WHEN i.is_foil = 0 THEN 1 ELSE 0 END) AS real_shown
       FROM sessions s
       JOIN issues i ON i.session_id = s.id AND i.shown_to_participant = 1
       LEFT JOIN issue_ratings r ON r.issue_id = i.id
       WHERE s.status != 'withdrawn'
       GROUP BY s.id
       HAVING real_shown > 0`
    )
    .all();

  const withBoth = perSession.filter((r) => r.real_mean != null && r.foil_mean != null);
  const gaps = withBoth.map((r) => r.real_mean - r.foil_mean);

  return {
    perSession: perSession.map((r) => ({
      participantCode: r.participant_code,
      realMean: round(r.real_mean),
      foilMean: round(r.foil_mean),
      gap: r.real_mean != null && r.foil_mean != null ? round(r.real_mean - r.foil_mean) : null,
      foilsRejected: r.foils_rejected,
      foilsShown: r.foils_shown,
      realRejected: r.real_rejected,
      realShown: r.real_shown,
      // A participant who rejected none of the foils and rated them as highly
      // as their own issues is the case to look at by hand.
      flagged: r.foil_mean != null && r.real_mean != null && r.real_mean - r.foil_mean < 0.5,
    })),
    summary: {
      sessionsRated: perSession.length,
      meanRealSeverity: round(mean(perSession.map((r) => r.real_mean).filter((v) => v != null))),
      meanFoilSeverity: round(mean(perSession.map((r) => r.foil_mean).filter((v) => v != null))),
      meanGap: round(mean(gaps)),
      foilRejectionRate: rate(
        sum(perSession.map((r) => r.foils_rejected)),
        sum(perSession.map((r) => r.foils_shown))
      ),
      realRejectionRate: rate(
        sum(perSession.map((r) => r.real_rejected)),
        sum(perSession.map((r) => r.real_shown))
      ),
      flaggedSessions: perSession.filter(
        (r) => r.foil_mean != null && r.real_mean != null && r.real_mean - r.foil_mean < 0.5
      ).length,
    },
  };
}

/** Where the friction actually sits: by domain, band, and emotion token. */
export function frictionBreakdown() {
  const db = getDb();

  const byDomain = db
    .prepare(
      `SELECT i.domain,
              COUNT(*) AS issues,
              AVG(CASE WHEN r.rejected = 0 THEN r.severity END) AS mean_severity,
              SUM(CASE WHEN r.rejected = 1 THEN 1 ELSE 0 END) AS rejected
       FROM issues i
       JOIN sessions s ON s.id = i.session_id AND s.status != 'withdrawn'
       LEFT JOIN issue_ratings r ON r.issue_id = i.id
       WHERE i.is_foil = 0 AND i.domain IS NOT NULL
       GROUP BY i.domain
       ORDER BY issues DESC`
    )
    .all()
    .map((r) => ({
      key: r.domain,
      label: DOMAIN_LABEL.get(r.domain) || r.domain,
      issues: r.issues,
      meanSeverity: round(r.mean_severity),
      rejected: r.rejected,
    }));

  const byBand = db
    .prepare(
      `SELECT i.time_band, COUNT(*) AS issues,
              AVG(CASE WHEN r.rejected = 0 THEN r.severity END) AS mean_severity
       FROM issues i
       JOIN sessions s ON s.id = i.session_id AND s.status != 'withdrawn'
       LEFT JOIN issue_ratings r ON r.issue_id = i.id
       WHERE i.is_foil = 0 AND i.time_band IS NOT NULL
       GROUP BY i.time_band`
    )
    .all()
    .map((r) => ({
      key: r.time_band,
      label: BAND_LABEL.get(r.time_band) || r.time_band,
      issues: r.issues,
      meanSeverity: round(r.mean_severity),
    }));

  const byToken = db
    .prepare(
      `SELECT t.token_key, COUNT(*) AS uses,
              COUNT(DISTINCT e.game_session_id) AS sessions
       FROM episode_tags t
       JOIN episodes e ON e.id = t.episode_id
       JOIN game_sessions g ON g.id = e.game_session_id
       JOIN sessions s ON s.id = g.session_id AND s.status != 'withdrawn'
       GROUP BY t.token_key
       ORDER BY uses DESC`
    )
    .all()
    .map((r) => ({
      key: r.token_key,
      label: TOKEN_LABEL.get(r.token_key) || r.token_key,
      uses: r.uses,
      sessions: r.sessions,
    }));

  return { byDomain, byBand, byToken };
}

/**
 * How much of the CAE material came from participants versus was filled in by
 * the model. Worth watching: a corpus that is ninety percent inferred is a
 * corpus describing the model's priors rather than anybody's day.
 */
export function provenanceBreakdown() {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT
         SUM(CASE WHEN cause_provenance  = 'participant' THEN 1 ELSE 0 END) AS cause_p,
         SUM(CASE WHEN affect_provenance = 'participant' THEN 1 ELSE 0 END) AS affect_p,
         SUM(CASE WHEN effect_provenance = 'participant' THEN 1 ELSE 0 END) AS effect_p,
         COUNT(*) AS total
       FROM issues i
       JOIN sessions s ON s.id = i.session_id AND s.status != 'withdrawn'
       WHERE i.is_foil = 0`
    )
    .get();

  const total = row?.total || 0;
  return {
    total,
    cause: { participant: row?.cause_p || 0, rate: rate(row?.cause_p, total) },
    affect: { participant: row?.affect_p || 0, rate: rate(row?.affect_p, total) },
    effect: { participant: row?.effect_p || 0, rate: rate(row?.effect_p, total) },
  };
}

/** Extraction health: model versus fallback, latency, token spend. */
export function extractionHealth() {
  const db = getDb();

  const byStatus = db
    .prepare(
      // Both tables carry a `status` column, so every reference here is
      // qualified. An unqualified one is an ambiguous-column error at runtime.
      `SELECT e.status AS status, COUNT(*) AS n, AVG(e.latency_ms) AS mean_latency
       FROM extraction_runs e
       JOIN sessions s ON s.id = e.session_id AND s.status != 'withdrawn'
       GROUP BY e.status`
    )
    .all()
    .map((r) => ({ status: r.status, runs: r.n, meanLatencyMs: Math.round(r.mean_latency || 0) }));

  const tokens = db
    .prepare(
      `SELECT SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens
       FROM extraction_runs e
       JOIN sessions s ON s.id = e.session_id AND s.status != 'withdrawn'
       WHERE e.status = 'ok'`
    )
    .get();

  const recentErrors = db
    .prepare(
      `SELECT e.id, e.created_at, e.error_message, s.participant_code
       FROM extraction_runs e
       JOIN sessions s ON s.id = e.session_id
       WHERE e.status IN ('error', 'fallback') AND e.error_message IS NOT NULL
       ORDER BY e.created_at DESC LIMIT 20`
    )
    .all();

  return {
    byStatus,
    tokens: {
      input: tokens?.input_tokens || 0,
      output: tokens?.output_tokens || 0,
    },
    recentErrors,
  };
}

/** Completion funnel with median time per stage. */
export function completionFunnel() {
  const db = getDb();

  const durations = db
    .prepare(
      `SELECT total_duration_ms FROM sessions
       WHERE status = 'completed' AND total_duration_ms IS NOT NULL`
    )
    .all()
    .map((r) => r.total_duration_ms)
    .sort((a, b) => a - b);

  const gameDurations = db
    .prepare(
      `SELECT g.duration_ms FROM game_sessions g
       JOIN sessions s ON s.id = g.session_id AND s.status != 'withdrawn'
       WHERE g.duration_ms IS NOT NULL`
    )
    .all()
    .map((r) => r.duration_ms)
    .sort((a, b) => a - b);

  return {
    medianSessionMs: median(durations),
    medianGameMs: median(gameDurations),
    completedWithTiming: durations.length,
    byStage: db
      .prepare(
        `SELECT stage, COUNT(*) AS n FROM sessions
         WHERE status != 'withdrawn' GROUP BY stage ORDER BY n DESC`
      )
      .all(),
  };
}

/** The post-questionnaire, aggregated. */
export function questionnaireSummary() {
  const db = getDb();

  const scales = db
    .prepare(
      `SELECT question_key, question_text,
              COUNT(*) AS n,
              AVG(CAST(response_value AS REAL)) AS mean
       FROM post_questionnaire_responses q
       JOIN sessions s ON s.id = q.session_id AND s.status != 'withdrawn'
       WHERE response_value IS NOT NULL
       GROUP BY question_key`
    )
    .all()
    .map((r) => ({ key: r.question_key, text: r.question_text, n: r.n, mean: round(r.mean) }));

  const freeText = db
    .prepare(
      `SELECT q.question_key, q.response_text, s.participant_code
       FROM post_questionnaire_responses q
       JOIN sessions s ON s.id = q.session_id AND s.status != 'withdrawn'
       WHERE q.response_text IS NOT NULL AND TRIM(q.response_text) != ''
       ORDER BY q.created_at DESC LIMIT 200`
    )
    .all();

  return { scales, freeText };
}

// --- small helpers ---------------------------------------------------------

function sum(values) {
  return values.reduce((a, b) => a + (b || 0), 0);
}

function mean(values) {
  if (!values || values.length === 0) return null;
  return sum(values) / values.length;
}

function median(sorted) {
  if (!sorted || sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function round(value, places = 2) {
  if (value == null || Number.isNaN(value)) return null;
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function rate(numerator, denominator) {
  if (!denominator) return null;
  return round((numerator || 0) / denominator, 3);
}
