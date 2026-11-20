import { Router } from 'express';
import { config } from '../config.js';
import { getDb } from '../db/index.js';
import { newId } from '../services/ids.js';
import { createSession, publicSession, updateSession } from '../services/sessions.js';
import { requireSession } from '../middleware/auth.js';
import { asyncHandler, badRequest } from '../middleware/errors.js';

export const sessionsRouter = Router();

function clientIp(req) {
  // Railway sits behind a proxy; app.js enables trust proxy so this is the real
  // client address rather than the load balancer.
  return req.ip;
}

/** POST /api/sessions -- anonymous session, returns the bearer token once. */
sessionsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const { client } = req.body || {};
    const created = createSession({
      client: client || {},
      ip: clientIp(req),
      userAgent: req.get('user-agent'),
    });

    res.status(201).json({
      sessionId: created.sessionId,
      participantCode: created.participantCode,
      token: created.token,
      study: {
        minAge: config.study.minAge,
        maxAge: config.study.maxAge,
        minorThreshold: config.study.minorThreshold,
      },
    });
  })
);

/** GET /api/sessions/me */
sessionsRouter.get(
  '/me',
  requireSession,
  asyncHandler(async (req, res) => {
    res.json({ session: publicSession(req.session) });
  })
);

/**
 * POST /api/sessions/me/age-gate
 * Records the declared age and decides which consent path applies.
 */
sessionsRouter.post(
  '/me/age-gate',
  requireSession,
  asyncHandler(async (req, res) => {
    const age = Number(req.body?.age);
    if (!Number.isInteger(age) || age < 1 || age > 120) {
      throw badRequest('Please enter a valid age.');
    }

    const { minAge, maxAge, minorThreshold } = config.study;
    let result;
    if (age < minAge || age > maxAge) result = 'screened_out';
    else if (age < minorThreshold) result = 'minor';
    else result = 'adult';

    getDb()
      .prepare(
        `INSERT INTO age_gate_responses (id, session_id, declared_age, result)
         VALUES (?, ?, ?, ?)`
      )
      .run(newId(), req.session.id, age, result);

    const updated = updateSession(req.session.id, {
      declared_age: age,
      is_minor: result === 'minor' ? 1 : 0,
      status: result === 'screened_out' ? 'screened_out' : 'age_gated',
      stage: result === 'screened_out' ? 'age_gate' : result === 'minor' ? 'guardian_wait' : 'consent',
    });

    res.json({
      result,
      eligible: result !== 'screened_out',
      requiresGuardianConsent: result === 'minor',
      session: publicSession(updated),
    });
  })
);

/** PATCH /api/sessions/me/stage -- lets the client record where it navigated. */
sessionsRouter.patch(
  '/me/stage',
  requireSession,
  asyncHandler(async (req, res) => {
    const { stage } = req.body || {};
    if (!stage || typeof stage !== 'string') throw badRequest('stage is required.');
    const updated = updateSession(req.session.id, { stage });
    res.json({ session: publicSession(updated) });
  })
);
