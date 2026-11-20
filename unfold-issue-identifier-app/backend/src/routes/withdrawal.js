import { Router } from 'express';
import { getDb, transact } from '../db/index.js';
import { newId } from '../services/ids.js';
import { requireSession } from '../middleware/auth.js';
import { withdrawalLimiter } from '../middleware/rateLimits.js';
import { asyncHandler, badRequest, notFoundError } from '../middleware/errors.js';

export const withdrawalRouter = Router();

/**
 * Marks the session withdrawn and deletes every row that cascades from it.
 * The withdrawals row itself survives, holding the participant code, so there is
 * proof the request was honoured without keeping any of the data.
 */
export function withdrawSession({ sessionId, reason, method }) {
  return transact(() => {
    const db = getDb();
    const session = db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(sessionId);
    if (!session) throw notFoundError('No such session.');
    if (session.status === 'withdrawn') {
      return { participantCode: session.participant_code, alreadyDeleted: true };
    }

    db.prepare(
      `INSERT INTO withdrawals (id, session_id, participant_code, reason, method, hard_deleted_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))`
    ).run(newId(), sessionId, session.participant_code, reason || null, method || 'self_service');

    // Blank the session row rather than deleting it: the participant code must
    // stay reserved so a later participant is never issued the same one.
    db.prepare(
      `UPDATE sessions
       SET status = 'withdrawn',
           stage = 'complete',
           withdrawn_at = datetime('now'),
           declared_age = NULL,
           user_agent = NULL,
           ip_hash = NULL,
           screen_w = NULL,
           screen_h = NULL,
           device_pixel_ratio = NULL,
           timezone = NULL,
           locale = NULL,
           referrer = NULL,
           notes = NULL
       WHERE id = ?`
    ).run(sessionId);

    // Everything else cascades from sessions, so deleting the child rows is a
    // fixed list rather than a schema-wide sweep.
    const cascades = [
      'session_tokens',
      'age_gate_responses',
      'consent_records',
      'guardian_requests',
      'demographics',
      'game_sessions',
      'extraction_runs',
      'issues',
      'issue_ratings',
      'post_questionnaire_responses',
      'debrief_views',
      'telemetry_events',
    ];
    for (const table of cascades) {
      db.prepare(`DELETE FROM ${table} WHERE session_id = ?`).run(sessionId);
    }

    return { participantCode: session.participant_code };
  });
}

/** POST /api/withdrawal/me -- from inside a live session. */
withdrawalRouter.post(
  '/me',
  withdrawalLimiter,
  requireSession,
  asyncHandler(async (req, res) => {
    const result = withdrawSession({
      sessionId: req.session.id,
      reason: req.body?.reason,
      method: 'self_service',
    });
    res.json({ withdrawn: true, participantCode: result.participantCode });
  })
);

/**
 * POST /api/withdrawal/by-code -- for someone coming back later with the code
 * they wrote down. Rate limited, since the code is the only credential.
 */
withdrawalRouter.post(
  '/by-code',
  withdrawalLimiter,
  asyncHandler(async (req, res) => {
    const code = String(req.body?.participantCode || '').trim().toUpperCase();
    if (!code) throw badRequest('Please enter your participant code.');

    const session = getDb()
      .prepare(`SELECT id, status FROM sessions WHERE participant_code = ?`)
      .get(code);

    // Deliberately identical response whether or not the code exists: this
    // endpoint must not become a way to test which codes are real.
    if (!session || session.status === 'withdrawn') {
      return res.json({ withdrawn: true, participantCode: code });
    }

    withdrawSession({
      sessionId: session.id,
      reason: req.body?.reason,
      method: 'self_service',
    });

    res.json({ withdrawn: true, participantCode: code });
  })
);
