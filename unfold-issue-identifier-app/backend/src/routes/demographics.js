import { Router } from 'express';
import { getDb } from '../db/index.js';
import { newId } from '../services/ids.js';
import { publicSession, updateSession } from '../services/sessions.js';
import { requireSession } from '../middleware/auth.js';
import { asyncHandler, badRequest, forbidden } from '../middleware/errors.js';
import {
  DEMOGRAPHICS_VERSION,
  DEMOGRAPHIC_STEPS,
  DEMOGRAPHIC_FIELDS,
  MAPPED_COLUMNS,
  ageBand,
} from '../content/demographics.js';

export const demographicsRouter = Router();

/** GET /api/demographics/schema -- the frontend renders the form from this. */
demographicsRouter.get(
  '/schema',
  asyncHandler(async (_req, res) => {
    res.json({ version: DEMOGRAPHICS_VERSION, steps: DEMOGRAPHIC_STEPS });
  })
);

const FIELD_BY_KEY = new Map(DEMOGRAPHIC_FIELDS.map((f) => [f.key, f]));

/**
 * Coerces a submitted value to the column type. Anything unusable becomes null
 * in the column but survives verbatim in raw_payload, so nothing is ever lost.
 */
function coerce(key, value) {
  if (value === undefined || value === null || value === '') return null;
  const field = FIELD_BY_KEY.get(key);
  const type = field?.type;

  if (type === 'number') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  if (type === 'boolean') {
    if (typeof value === 'boolean') return value ? 1 : 0;
    if (value === 'true' || value === 'yes') return 1;
    if (value === 'false' || value === 'no') return 0;
    return null;
  }
  if (type === 'multiselect') {
    if (Array.isArray(value)) return value.join(',');
    return String(value);
  }
  return String(value);
}

/** POST /api/demographics -- upsert, so a participant can go back and amend. */
demographicsRouter.post(
  '/',
  requireSession,
  asyncHandler(async (req, res) => {
    if (req.session.status === 'screened_out') {
      throw forbidden('This session is not eligible to continue.');
    }

    const consented = getDb()
      .prepare(
        `SELECT 1 FROM consent_records
         WHERE session_id = ?
           AND consent_type IN ('adult', 'minor_assent')
           AND agreed = 1 AND withdrawn_at IS NULL`
      )
      .get(req.session.id);
    if (!consented) throw forbidden('Consent must be given before submitting demographics.');

    const { answers, completedSteps, durationMs } = req.body || {};
    if (!answers || typeof answers !== 'object') throw badRequest('answers is required.');

    const age = Number(answers.age);
    if (!Number.isFinite(age)) throw badRequest('Age is required.');

    const mapped = {};
    for (const column of MAPPED_COLUMNS) {
      mapped[column] = coerce(column, answers[column]);
    }
    mapped.age = Number.isFinite(age) ? age : null;
    mapped.age_band = ageBand(age);

    const db = getDb();
    const existing = db
      .prepare(`SELECT id FROM demographics WHERE session_id = ?`)
      .get(req.session.id);

    const payload = {
      ...mapped,
      id: existing?.id || newId(),
      session_id: req.session.id,
      // The verbatim submission, including any field not yet given a column.
      raw_payload: JSON.stringify({ version: DEMOGRAPHICS_VERSION, answers }),
      completed_steps: Number.isFinite(Number(completedSteps)) ? Number(completedSteps) : null,
      duration_ms: Number.isFinite(Number(durationMs)) ? Number(durationMs) : null,
    };

    const columns = [
      'id',
      'session_id',
      ...MAPPED_COLUMNS,
      'raw_payload',
      'completed_steps',
      'duration_ms',
    ];

    if (existing) {
      const sets = columns
        .filter((c) => c !== 'id' && c !== 'session_id')
        .map((c) => `${c} = @${c}`)
        .join(', ');
      db.prepare(
        `UPDATE demographics SET ${sets}, updated_at = datetime('now') WHERE session_id = @session_id`
      ).run(payload);
    } else {
      db.prepare(
        `INSERT INTO demographics (${columns.join(', ')})
         VALUES (${columns.map((c) => `@${c}`).join(', ')})`
      ).run(payload);
    }

    const updated = updateSession(req.session.id, {
      status: 'demographics_done',
      stage: 'game',
    });

    res.status(existing ? 200 : 201).json({
      saved: true,
      session: publicSession(updated),
    });
  })
);

/** GET /api/demographics/me */
demographicsRouter.get(
  '/me',
  requireSession,
  asyncHandler(async (req, res) => {
    const row = getDb()
      .prepare(`SELECT raw_payload FROM demographics WHERE session_id = ?`)
      .get(req.session.id);

    if (!row) return res.json({ answers: null });
    res.json({ answers: JSON.parse(row.raw_payload).answers });
  })
);
