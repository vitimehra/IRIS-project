import { getDb, transact } from '../db/index.js';
import { config } from '../config.js';
import { newId, newToken, hashToken, hashIp } from './ids.js';

/** Ordered participant journey. Used to validate stage transitions. */
export const STAGES = [
  'landing',
  'age_gate',
  'consent',
  'guardian_wait',
  'assent',
  'demographics',
  'game',
  'rating',
  'post_questionnaire',
  'debrief',
  'complete',
];

function isoInHours(hours) {
  return new Date(Date.now() + hours * 3600 * 1000).toISOString();
}

/**
 * Allocates the next participant code inside the same transaction that creates
 * the session, so two simultaneous participants cannot both take P007.
 */
function nextParticipantCode(db) {
  const prefix = config.study.participantCodePrefix;
  const row = db
    .prepare(
      `SELECT participant_code FROM sessions
       WHERE participant_code LIKE ?
       ORDER BY LENGTH(participant_code) DESC, participant_code DESC
       LIMIT 1`
    )
    .get(`${prefix}%`);

  const last = row ? Number(String(row.participant_code).slice(prefix.length)) : 0;
  const next = Number.isFinite(last) ? last + 1 : 1;
  return `${prefix}${String(next).padStart(3, '0')}`;
}

export function createSession({ client = {}, ip, userAgent } = {}) {
  return transact(() => {
    const db = getDb();
    const id = newId();
    const code = nextParticipantCode(db);

    db.prepare(
      `INSERT INTO sessions (
         id, participant_code, status, stage, llm_enabled,
         user_agent, ip_hash, screen_w, screen_h, device_pixel_ratio,
         timezone, locale, referrer, last_seen_at
       ) VALUES (
         @id, @participant_code, 'started', 'landing', @llm_enabled,
         @user_agent, @ip_hash, @screen_w, @screen_h, @device_pixel_ratio,
         @timezone, @locale, @referrer, datetime('now')
       )`
    ).run({
      id,
      participant_code: code,
      llm_enabled: config.anthropic.enabled ? 1 : 0,
      user_agent: userAgent ?? null,
      ip_hash: hashIp(ip),
      screen_w: client.screenW ?? null,
      screen_h: client.screenH ?? null,
      device_pixel_ratio: client.devicePixelRatio ?? null,
      timezone: client.timezone ?? null,
      locale: client.locale ?? null,
      referrer: client.referrer ?? null,
    });

    const token = newToken();
    db.prepare(
      `INSERT INTO session_tokens (id, session_id, token_hash, expires_at)
       VALUES (?, ?, ?, ?)`
    ).run(newId(), id, hashToken(token), isoInHours(config.sessionTokenTtlHours));

    return { sessionId: id, participantCode: code, token };
  });
}

export function findSessionByToken(token) {
  if (!token) return null;
  const db = getDb();
  return (
    db
      .prepare(
        `SELECT s.* FROM sessions s
         JOIN session_tokens t ON t.session_id = s.id
         WHERE t.token_hash = ?
           AND t.revoked_at IS NULL
           AND t.expires_at > datetime('now')`
      )
      .get(hashToken(token)) || null
  );
}

export function getSession(sessionId) {
  return getDb().prepare(`SELECT * FROM sessions WHERE id = ?`).get(sessionId) || null;
}

export function touchSession(sessionId) {
  getDb()
    .prepare(`UPDATE sessions SET last_seen_at = datetime('now') WHERE id = ?`)
    .run(sessionId);
}

export function updateSession(sessionId, fields) {
  const allowed = [
    'status',
    'stage',
    'is_minor',
    'declared_age',
    'completed_at',
    'total_duration_ms',
    'notes',
  ];
  const entries = Object.entries(fields).filter(([k]) => allowed.includes(k));
  if (entries.length === 0) return getSession(sessionId);

  const sets = entries.map(([k]) => `${k} = @${k}`).join(', ');
  getDb()
    .prepare(`UPDATE sessions SET ${sets}, last_seen_at = datetime('now') WHERE id = @id`)
    .run({ ...Object.fromEntries(entries), id: sessionId });

  return getSession(sessionId);
}

/** Public shape. Never leaks ip_hash or internal columns to the browser. */
export function publicSession(session) {
  if (!session) return null;
  return {
    sessionId: session.id,
    participantCode: session.participant_code,
    status: session.status,
    stage: session.stage,
    isMinor: Boolean(session.is_minor),
    declaredAge: session.declared_age,
    llmEnabled: Boolean(session.llm_enabled),
    startedAt: session.started_at,
    completedAt: session.completed_at,
    withdrawnAt: session.withdrawn_at,
  };
}
