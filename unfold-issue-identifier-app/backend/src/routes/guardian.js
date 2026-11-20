import { Router } from 'express';
import { config } from '../config.js';
import { getDb, transact } from '../db/index.js';
import { newId, newShortCode, hashIp } from '../services/ids.js';
import { publicSession, updateSession, getSession } from '../services/sessions.js';
import { requireSession } from '../middleware/auth.js';
import { guardianCodeLimiter } from '../middleware/rateLimits.js';
import { asyncHandler, badRequest, forbidden, notFoundError, gone } from '../middleware/errors.js';
import { recordConsent } from './consent.js';

export const guardianRouter = Router();

function expiryIso() {
  return new Date(Date.now() + config.guardianRequestTtlMinutes * 60 * 1000).toISOString();
}

function loadByCode(code) {
  return (
    getDb()
      .prepare(`SELECT * FROM guardian_requests WHERE short_code = ?`)
      .get(String(code || '').trim().toUpperCase()) || null
  );
}

/** Expiry is evaluated on read: a cron job would be one more thing to run. */
function withLiveStatus(request) {
  if (!request) return null;
  const expired =
    request.status === 'pending' || request.status === 'viewed'
      ? new Date(request.expires_at).getTime() < Date.now()
      : false;
  return { ...request, status: expired ? 'expired' : request.status };
}

/**
 * POST /api/guardian/requests
 * Creates the handoff. Returns the same live request on repeat calls, so a
 * participant refreshing the page does not strand the code their guardian is
 * already looking at.
 */
guardianRouter.post(
  '/requests',
  requireSession,
  asyncHandler(async (req, res) => {
    if (!req.session.is_minor) {
      throw forbidden('Guardian consent applies only to participants under 18.');
    }

    const existing = withLiveStatus(
      getDb()
        .prepare(
          `SELECT * FROM guardian_requests
           WHERE session_id = ? AND status IN ('pending', 'viewed')
           ORDER BY created_at DESC LIMIT 1`
        )
        .get(req.session.id)
    );

    if (existing && existing.status !== 'expired') {
      return res.json({
        shortCode: existing.short_code,
        status: existing.status,
        expiresAt: existing.expires_at,
        guardianUrl: `${config.publicAppUrl}/guardian/${existing.short_code}`,
      });
    }

    const shortCode = transact(() => {
      const db = getDb();
      // Retry on the vanishingly unlikely collision rather than 500-ing at a
      // participant who is sitting next to their parent.
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const candidate = newShortCode(6);
        const taken = db
          .prepare(`SELECT 1 FROM guardian_requests WHERE short_code = ?`)
          .get(candidate);
        if (taken) continue;

        db.prepare(
          `INSERT INTO guardian_requests (id, session_id, short_code, status, expires_at)
           VALUES (?, ?, ?, 'pending', ?)`
        ).run(newId(), req.session.id, candidate, expiryIso());
        return candidate;
      }
      throw new Error('Could not allocate a guardian code.');
    });

    updateSession(req.session.id, { status: 'awaiting_guardian', stage: 'guardian_wait' });

    res.status(201).json({
      shortCode,
      status: 'pending',
      expiresAt: expiryIso(),
      guardianUrl: `${config.publicAppUrl}/guardian/${shortCode}`,
    });
  })
);

/**
 * GET /api/guardian/requests/status -- polled by the participant's waiting screen.
 * Returns nothing about the guardian beyond whether they have acted.
 */
guardianRouter.get(
  '/requests/status',
  requireSession,
  asyncHandler(async (req, res) => {
    const request = withLiveStatus(
      getDb()
        .prepare(
          `SELECT * FROM guardian_requests WHERE session_id = ? ORDER BY created_at DESC LIMIT 1`
        )
        .get(req.session.id)
    );

    if (!request) return res.json({ status: 'none' });

    res.json({
      status: request.status,
      shortCode: request.short_code,
      expiresAt: request.expires_at,
      resolvedAt: request.resolved_at,
      declineReason: request.status === 'declined' ? request.decline_reason : null,
      session: publicSession(getSession(req.session.id)),
    });
  })
);

/**
 * GET /api/guardian/by-code/:code -- what the guardian's device loads.
 * Public by necessity. Deliberately returns nothing about the young person:
 * no name, no age, no answers. Somebody guessing a code learns only that a
 * request exists.
 */
guardianRouter.get(
  '/by-code/:code',
  guardianCodeLimiter,
  asyncHandler(async (req, res) => {
    const request = withLiveStatus(loadByCode(req.params.code));
    if (!request) throw notFoundError('That code was not recognised. Please check and try again.');

    if (request.status === 'pending') {
      getDb()
        .prepare(
          `UPDATE guardian_requests
           SET status = 'viewed', first_viewed_at = COALESCE(first_viewed_at, datetime('now'))
           WHERE id = ?`
        )
        .run(request.id);
    }

    res.json({
      shortCode: request.short_code,
      status: request.status === 'pending' ? 'viewed' : request.status,
      expiresAt: request.expires_at,
      resolvedAt: request.resolved_at,
      alreadyResolved: ['consented', 'declined'].includes(request.status),
    });
  })
);

/** POST /api/guardian/by-code/:code/consent */
guardianRouter.post(
  '/by-code/:code/consent',
  guardianCodeLimiter,
  asyncHandler(async (req, res) => {
    const request = withLiveStatus(loadByCode(req.params.code));
    if (!request) throw notFoundError('That code was not recognised.');
    if (request.status === 'expired') {
      throw gone('This permission request has expired. Ask them to generate a new code.');
    }
    if (request.status === 'consented' || request.status === 'declined') {
      throw badRequest('This request has already been answered.');
    }

    const { responses, guardianName, guardianRelationship, guardianContact } = req.body || {};
    if (!responses || typeof responses !== 'object') throw badRequest('responses is required.');
    if (!guardianName || String(guardianName).trim().length < 2) {
      throw badRequest('Please enter your name.');
    }
    if (!guardianRelationship) throw badRequest('Please state your relationship to the participant.');

    // recordConsent throws if a required item is unticked, before anything is
    // marked as consented.
    const recordId = recordConsent({
      sessionId: request.session_id,
      consentType: 'guardian',
      responses,
      signatureName: String(guardianName).trim(),
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });

    transact(() => {
      getDb()
        .prepare(
          `UPDATE guardian_requests
           SET status = 'consented', resolved_at = datetime('now'),
               guardian_name = ?, guardian_relationship = ?, guardian_contact = ?,
               guardian_ip_hash = ?, guardian_user_agent = ?
           WHERE id = ?`
        )
        .run(
          String(guardianName).trim(),
          guardianRelationship,
          guardianContact || null,
          hashIp(req.ip),
          req.get('user-agent') || null,
          request.id
        );

      // The young person still has to give their own assent, so the session is
      // not 'consented' yet.
      updateSession(request.session_id, { stage: 'assent' });
    });

    res.status(201).json({ status: 'consented', consentRecordId: recordId });
  })
);

/** POST /api/guardian/by-code/:code/decline */
guardianRouter.post(
  '/by-code/:code/decline',
  guardianCodeLimiter,
  asyncHandler(async (req, res) => {
    const request = withLiveStatus(loadByCode(req.params.code));
    if (!request) throw notFoundError('That code was not recognised.');
    if (request.status === 'consented' || request.status === 'declined') {
      throw badRequest('This request has already been answered.');
    }

    getDb()
      .prepare(
        `UPDATE guardian_requests
         SET status = 'declined', resolved_at = datetime('now'),
             decline_reason = ?, guardian_ip_hash = ?, guardian_user_agent = ?
         WHERE id = ?`
      )
      .run(
        req.body?.reason || null,
        hashIp(req.ip),
        req.get('user-agent') || null,
        request.id
      );

    updateSession(request.session_id, { status: 'screened_out', stage: 'guardian_wait' });

    res.json({ status: 'declined' });
  })
);
