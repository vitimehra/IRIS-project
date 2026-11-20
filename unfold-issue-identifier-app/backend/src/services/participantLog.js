/**
 * Full record of one participant, for the experimenter panel.
 *
 * Withdrawal deletes child rows, so a withdrawn session returns the stub and
 * whatever is left on the session row.
 */
import { getDb } from '../db/index.js';

function parseJson(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function pushTimeline(events, at, type, summary, detail = null) {
  if (!at) return;
  events.push({ at, type, summary, detail });
}

const TELEMETRY_LABELS = {
  page_view: 'Opened a page',
  session_started: 'Session started',
  study_started: 'Began the study',
  age_gate_result: 'Age gate result',
  consent_given: 'Gave consent',
  guardian_consented: 'Guardian consented',
  guardian_resolved: 'Guardian request resolved',
  demographics_step_complete: 'Finished a demographics step',
  demographics_submitted: 'Submitted demographics',
  game_started: 'Started reconstructing the day',
  episode_added: 'Added a moment',
  episode_removed: 'Removed a moment',
  day_built: 'Finished the day board',
  day_tagged: 'Finished emotion tagging',
  saboteur_round: 'Answered a Saboteur round',
  saboteur_complete: 'Finished the Saboteur',
  pairwise_choice: 'Made a forced choice',
  pairwise_complete: 'Finished forced choice',
  game_complete: 'Finished the game',
  issues_extracted: 'Issues extracted',
  issue_rated: 'Rated an issue',
  questionnaire_submitted: 'Submitted the post-questionnaire',
};

function telemetrySummary(row) {
  const payload = parseJson(row.payload_json) || {};
  const label = TELEMETRY_LABELS[row.event_type] || row.event_type;
  if (row.event_type === 'page_view') {
    return `${label}: ${payload.page || row.page || 'unknown'}`;
  }
  return label;
}

function sortByTime(events) {
  return events.sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

export function buildParticipantLog(sessionId) {
  const db = getDb();
  const session = db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(sessionId);
  if (!session) return null;

  const ageGate = db
    .prepare(`SELECT * FROM age_gate_responses WHERE session_id = ? ORDER BY created_at`)
    .all(sessionId);

  const consentRecords = db
    .prepare(`SELECT * FROM consent_records WHERE session_id = ? ORDER BY agreed_at`)
    .all(sessionId);
  const consent = consentRecords.map((record) => ({
    ...record,
    items: db
      .prepare(`SELECT * FROM consent_items WHERE consent_record_id = ? ORDER BY created_at`)
      .all(record.id),
  }));

  const guardian = db
    .prepare(`SELECT * FROM guardian_requests WHERE session_id = ? ORDER BY created_at`)
    .all(sessionId);

  const demographics =
    db.prepare(`SELECT * FROM demographics WHERE session_id = ?`).get(sessionId) || null;
  if (demographics) {
    demographics.raw_payload = parseJson(demographics.raw_payload);
  }

  const gameSessions = db
    .prepare(`SELECT * FROM game_sessions WHERE session_id = ? ORDER BY started_at`)
    .all(sessionId);

  const game = gameSessions.map((gameSession) => {
    const episodes = db
      .prepare(`SELECT * FROM episodes WHERE game_session_id = ? ORDER BY ordinal`)
      .all(gameSession.id)
      .map((episode) => ({
        ...episode,
        tags: db
          .prepare(`SELECT * FROM episode_tags WHERE episode_id = ? ORDER BY created_at`)
          .all(episode.id),
      }));

    const saboteur = db
      .prepare(
        `SELECT * FROM saboteur_rounds WHERE game_session_id = ? ORDER BY ordinal, started_at`
      )
      .all(gameSession.id)
      .map((round) => ({
        ...round,
        responses: db
          .prepare(
            `SELECT * FROM saboteur_responses WHERE saboteur_round_id = ? ORDER BY ordinal`
          )
          .all(round.id),
      }));

    const pairwise = db
      .prepare(`SELECT * FROM pairwise_rounds WHERE game_session_id = ? ORDER BY ordinal`)
      .all(gameSession.id);

    return { ...gameSession, episodes, saboteur, pairwise };
  });

  const extraction = db
    .prepare(`SELECT * FROM extraction_runs WHERE session_id = ? ORDER BY created_at`)
    .all(sessionId)
    .map((run) => ({
      ...run,
      request_json: parseJson(run.request_json),
      response_json: parseJson(run.response_json),
    }));

  const issues = db
    .prepare(`SELECT * FROM issues WHERE session_id = ? ORDER BY display_rank, ordinal, created_at`)
    .all(sessionId)
    .map((issue) => ({
      ...issue,
      rating:
        db.prepare(`SELECT * FROM issue_ratings WHERE issue_id = ?`).get(issue.id) || null,
    }));

  const questionnaire = db
    .prepare(
      `SELECT * FROM post_questionnaire_responses WHERE session_id = ? ORDER BY created_at`
    )
    .all(sessionId);

  const debrief = db
    .prepare(`SELECT * FROM debrief_views WHERE session_id = ? ORDER BY viewed_at`)
    .all(sessionId);

  const telemetry = db
    .prepare(
      `SELECT id, event_type, page, payload_json, client_ts, server_ts
       FROM telemetry_events WHERE session_id = ? ORDER BY server_ts, client_ts`
    )
    .all(sessionId)
    .map((row) => ({
      ...row,
      payload: parseJson(row.payload_json),
    }));

  const withdrawals = db
    .prepare(`SELECT * FROM withdrawals WHERE session_id = ? ORDER BY requested_at`)
    .all(sessionId);

  const timeline = [];
  pushTimeline(timeline, session.started_at, 'session', 'Session created', {
    participantCode: session.participant_code,
  });
  for (const row of ageGate) {
    pushTimeline(timeline, row.created_at, 'age_gate', `Age gate: ${row.result}`, {
      declaredAge: row.declared_age,
    });
  }
  for (const row of consent) {
    pushTimeline(
      timeline,
      row.agreed_at,
      'consent',
      `${row.consent_type} consent ${row.agreed ? 'given' : 'not given'}`,
      { version: row.document_version, signature: row.signature_name }
    );
  }
  for (const row of guardian) {
    pushTimeline(timeline, row.created_at, 'guardian', `Guardian request ${row.status}`, {
      shortCode: row.short_code,
      name: row.guardian_name,
      relationship: row.guardian_relationship,
    });
    pushTimeline(timeline, row.resolved_at, 'guardian', `Guardian ${row.status}`);
  }
  if (demographics) {
    pushTimeline(timeline, demographics.created_at, 'demographics', 'Demographics submitted');
  }
  for (const row of game) {
    pushTimeline(timeline, row.started_at, 'game', 'Day reconstruction started', {
      anchorDate: row.anchor_date,
      typical: row.anchor_is_typical,
    });
    for (const episode of row.episodes) {
      pushTimeline(
        timeline,
        episode.created_at,
        'episode',
        `Moment: ${episode.label || 'untitled'}`,
        {
          timeBand: episode.time_band,
          domain: episode.domain,
          tags: episode.tags.map((t) => t.token_key),
        }
      );
    }
    for (const round of row.saboteur) {
      const answers = round.responses.map((r) => r.response_text).filter(Boolean);
      pushTimeline(
        timeline,
        round.ended_at || round.started_at,
        'saboteur',
        round.skipped ? 'Saboteur round skipped' : 'Saboteur round answered',
        { prompt: round.prompt_text, answers }
      );
    }
    for (const round of row.pairwise) {
      pushTimeline(
        timeline,
        round.created_at,
        'pairwise',
        `Forced choice: ${round.chosen_side || 'unanswered'}`,
        { left: round.left_text, right: round.right_text, latencyMs: round.response_ms }
      );
    }
    pushTimeline(timeline, row.ended_at, 'game', 'Day reconstruction finished');
  }
  for (const row of extraction) {
    pushTimeline(timeline, row.created_at, 'extraction', `Extraction ${row.status}`, {
      model: row.model,
      error: row.error_message,
    });
  }
  for (const row of issues) {
    const rating = row.rating;
    const ratingNote = rating
      ? rating.rejected
        ? 'rejected'
        : `severity ${rating.severity ?? '—'}`
      : 'unrated';
    pushTimeline(
      timeline,
      rating?.created_at || row.created_at,
      'issue',
      `${row.is_foil ? 'Foil' : 'Issue'}: ${row.headline} (${ratingNote})`
    );
  }
  for (const row of questionnaire) {
    pushTimeline(
      timeline,
      row.created_at,
      'questionnaire',
      `Questionnaire: ${row.question_key}`,
      { answer: row.response_value || row.response_text }
    );
  }
  for (const row of debrief) {
    pushTimeline(timeline, row.viewed_at, 'debrief', 'Viewed debrief', {
      foilsRevealed: row.foils_revealed,
      dayShown: row.day_shown,
    });
  }
  for (const row of telemetry) {
    pushTimeline(
      timeline,
      row.client_ts || row.server_ts,
      row.event_type,
      telemetrySummary(row),
      row.payload
    );
  }
  pushTimeline(timeline, session.completed_at, 'session', 'Session completed');
  pushTimeline(timeline, session.withdrawn_at, 'session', 'Session data deleted');
  for (const row of withdrawals) {
    pushTimeline(timeline, row.requested_at, 'withdrawal', `Deleted via ${row.method}`, {
      reason: row.reason,
    });
  }

  const { ip_hash: _ip, ...safeSession } = session;

  return {
    session: safeSession,
    timeline: sortByTime(timeline),
    ageGate,
    consent,
    guardian: guardian.map(({ guardian_ip_hash: _h, ...row }) => row),
    demographics,
    game,
    extraction,
    issues,
    questionnaire,
    debrief,
    telemetry: telemetry.map(({ payload_json: _p, ...row }) => row),
    withdrawals,
  };
}
