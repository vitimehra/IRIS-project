import { getDb, transact } from '../db/index.js';
import { newId } from './ids.js';
import { selectFoils } from '../content/foils.js';

/** The rating screen shows this many real issues, plus the foils. */
export const MAX_SHOWN_ISSUES = 18;
export const FOIL_COUNT = 3;

/**
 * Persists an extraction result.
 *
 * Everything extracted is stored. Only the top-ranked slice is shown, because a
 * participant rating thirty cards at the end of a twenty-minute session gives
 * you fatigue noise rather than data. The rest stay in the export.
 */
export function persistIssues({ sessionId, extractionRunId, issues }) {
  return transact(() => {
    const db = getDb();

    // Re-running extraction replaces the previous result rather than
    // accumulating duplicates. Ratings cascade, which is correct: a rating
    // belongs to the exact card it was given for.
    db.prepare(`DELETE FROM issues WHERE session_id = ?`).run(sessionId);

    const ranked = [...issues].sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
    const shown = ranked.slice(0, MAX_SHOWN_ISSUES);
    const hidden = ranked.slice(MAX_SHOWN_ISSUES);

    const usedDomains = shown.map((i) => i.domain).filter(Boolean);
    const foils = selectFoils(usedDomains, FOIL_COUNT).map((foil) => ({
      headline: foil.headline,
      cause: foil.cause,
      cause_provenance: 'inferred',
      affect: foil.affect,
      affect_provenance: 'inferred',
      effect: foil.effect,
      effect_provenance: 'inferred',
      domain: foil.domain,
      time_band: null,
      source_episode_id: null,
      source_evidence: null,
      confidence: null,
      is_foil: 1,
      foil_family: foil.key,
    }));

    // Foils are spread through the deck rather than appended. A block of three
    // unfamiliar cards at the end is trivially detectable, and a detectable
    // foil measures nothing.
    const deck = [...shown.map((i) => ({ ...i, is_foil: 0 }))];
    if (foils.length > 0 && deck.length > 0) {
      const gap = Math.max(1, Math.floor(deck.length / (foils.length + 1)));
      foils.forEach((foil, index) => {
        const position = Math.min(deck.length, gap * (index + 1) + index);
        deck.splice(position, 0, foil);
      });
    } else {
      deck.push(...foils);
    }

    const insert = db.prepare(
      `INSERT INTO issues (
         id, session_id, extraction_run_id, ordinal,
         headline, cause, cause_provenance, affect, affect_provenance, effect, effect_provenance,
         domain, time_band, source_episode_id, source_evidence, confidence,
         is_foil, foil_family, shown_to_participant, display_rank
       ) VALUES (
         @id, @session_id, @extraction_run_id, @ordinal,
         @headline, @cause, @cause_provenance, @affect, @affect_provenance, @effect, @effect_provenance,
         @domain, @time_band, @source_episode_id, @source_evidence, @confidence,
         @is_foil, @foil_family, @shown_to_participant, @display_rank
       )`
    );

    let ordinal = 0;
    const written = [];

    deck.forEach((issue, index) => {
      const row = {
        id: newId(),
        session_id: sessionId,
        extraction_run_id: issue.is_foil ? null : extractionRunId,
        ordinal: ordinal++,
        headline: issue.headline,
        cause: issue.cause,
        cause_provenance: issue.cause_provenance,
        affect: issue.affect,
        affect_provenance: issue.affect_provenance,
        effect: issue.effect,
        effect_provenance: issue.effect_provenance,
        domain: issue.domain ?? null,
        time_band: issue.time_band ?? null,
        source_episode_id: issue.source_episode_id ?? null,
        source_evidence: issue.source_evidence ?? null,
        confidence: issue.confidence ?? null,
        is_foil: issue.is_foil ?? 0,
        foil_family: issue.foil_family ?? null,
        shown_to_participant: 1,
        display_rank: index,
      };
      insert.run(row);
      written.push(row);
    });

    for (const issue of hidden) {
      insert.run({
        id: newId(),
        session_id: sessionId,
        extraction_run_id: extractionRunId,
        ordinal: ordinal++,
        headline: issue.headline,
        cause: issue.cause,
        cause_provenance: issue.cause_provenance,
        affect: issue.affect,
        affect_provenance: issue.affect_provenance,
        effect: issue.effect,
        effect_provenance: issue.effect_provenance,
        domain: issue.domain ?? null,
        time_band: issue.time_band ?? null,
        source_episode_id: issue.source_episode_id ?? null,
        source_evidence: issue.source_evidence ?? null,
        confidence: issue.confidence ?? null,
        is_foil: 0,
        foil_family: null,
        shown_to_participant: 0,
        display_rank: null,
      });
    }

    return { shown: written.length, hidden: hidden.length, foils: foils.length };
  });
}

/**
 * The rating deck.
 *
 * `is_foil` is deliberately NOT included: the participant's browser must not be
 * able to tell a foil from a real issue, or the measure is worthless to anyone
 * who opens the network tab.
 */
export function ratingDeck(sessionId) {
  return getDb()
    .prepare(
      `SELECT id, headline, cause, affect, effect, domain, time_band, display_rank
       FROM issues
       WHERE session_id = ? AND shown_to_participant = 1
       ORDER BY display_rank`
    )
    .all(sessionId);
}

export function saveRating({ sessionId, issueId, rating }) {
  const db = getDb();

  const issue = db
    .prepare(`SELECT id FROM issues WHERE id = ? AND session_id = ? AND shown_to_participant = 1`)
    .get(issueId, sessionId);
  if (!issue) return null;

  const severity = rating.rejected ? null : Number(rating.severity);
  const validSeverity =
    severity === null || (Number.isInteger(severity) && severity >= 1 && severity <= 5);
  if (!validSeverity) return { error: 'Severity must be a whole number from 1 to 5.' };

  db.prepare(
    `INSERT INTO issue_ratings (
       id, issue_id, session_id, severity, rejected, recognised,
       edited_headline, edited_cause, edited_affect, edited_effect, edit_note, response_ms
     ) VALUES (
       @id, @issue_id, @session_id, @severity, @rejected, @recognised,
       @edited_headline, @edited_cause, @edited_affect, @edited_effect, @edit_note, @response_ms
     )
     ON CONFLICT(issue_id) DO UPDATE SET
       severity = excluded.severity,
       rejected = excluded.rejected,
       recognised = excluded.recognised,
       edited_headline = excluded.edited_headline,
       edited_cause = excluded.edited_cause,
       edited_affect = excluded.edited_affect,
       edited_effect = excluded.edited_effect,
       edit_note = excluded.edit_note,
       response_ms = excluded.response_ms`
  ).run({
    id: newId(),
    issue_id: issueId,
    session_id: sessionId,
    severity,
    rejected: rating.rejected ? 1 : 0,
    recognised: rating.recognised === undefined ? null : rating.recognised ? 1 : 0,
    edited_headline: rating.editedHeadline || null,
    edited_cause: rating.editedCause || null,
    edited_affect: rating.editedAffect || null,
    edited_effect: rating.editedEffect || null,
    edit_note: rating.editNote || null,
    response_ms: Number.isFinite(Number(rating.responseMs)) ? Number(rating.responseMs) : null,
  });

  return { saved: true };
}

/**
 * Debrief payload: the reconstructed day, the real issues with their ratings,
 * and the foils named as foils.
 */
export function debriefPayload(sessionId) {
  const db = getDb();

  const game = db
    .prepare(`SELECT * FROM game_sessions WHERE session_id = ? ORDER BY started_at DESC LIMIT 1`)
    .get(sessionId);

  const episodes = game
    ? db.prepare(`SELECT * FROM episodes WHERE game_session_id = ? ORDER BY ordinal`).all(game.id)
    : [];

  const tagStmt = db.prepare(`SELECT token_key FROM episode_tags WHERE episode_id = ?`);
  for (const episode of episodes) {
    episode.tags = tagStmt.all(episode.id).map((t) => t.token_key);
  }

  const rows = db
    .prepare(
      `SELECT i.id, i.headline, i.cause, i.affect, i.effect, i.domain, i.time_band,
              i.is_foil, i.foil_family, i.display_rank,
              r.severity, r.rejected
       FROM issues i
       LEFT JOIN issue_ratings r ON r.issue_id = i.id
       WHERE i.session_id = ? AND i.shown_to_participant = 1
       ORDER BY i.display_rank`
    )
    .all(sessionId);

  return {
    day: {
      anchorDate: game?.anchor_date || null,
      anchorDayOfWeek: game?.anchor_day_of_week || null,
      episodes: episodes.map((e) => ({
        id: e.id,
        timeBand: e.time_band,
        label: e.label,
        domain: e.domain,
        tags: e.tags,
      })),
    },
    issues: rows.filter((r) => !r.is_foil),
    foils: rows.filter((r) => r.is_foil),
  };
}
