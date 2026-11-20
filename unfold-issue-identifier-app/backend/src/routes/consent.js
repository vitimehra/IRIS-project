import { Router } from 'express';
import { getDb, transact } from '../db/index.js';
import { newId, hashIp } from '../services/ids.js';
import { publicSession, updateSession, getSession } from '../services/sessions.js';
import { requireSession } from '../middleware/auth.js';
import { asyncHandler, badRequest, forbidden } from '../middleware/errors.js';
import {
  CONSENT_VERSION,
  getConsentDocument,
  findConsentItem,
  requiredItemKeys,
} from '../content/consent.js';

export const consentRouter = Router();

/**
 * GET /api/consent/:type -- the document to display.
 * Public: the guardian page fetches this before it has any credential.
 */
consentRouter.get(
  '/:type',
  asyncHandler(async (req, res) => {
    const doc = getConsentDocument(req.params.type);
    if (!doc) throw badRequest('Unknown consent document type.');
    res.json(doc);
  })
);

/**
 * Persists a consent record and one row per item, storing the exact text shown.
 * Exported because the guardian route records consent for a session it is not
 * authenticated against.
 */
export function recordConsent({ sessionId, consentType, responses, signatureName, ip, userAgent }) {
  const required = requiredItemKeys(consentType);
  const missing = required.filter((key) => responses[key] !== true);
  if (missing.length > 0) {
    throw badRequest('All required items must be agreed to before continuing.', { missing });
  }

  return transact(() => {
    const db = getDb();
    const recordId = newId();

    db.prepare(
      `INSERT INTO consent_records (
         id, session_id, consent_type, document_version, agreed,
         signature_name, ip_hash, user_agent
       ) VALUES (?, ?, ?, ?, 1, ?, ?, ?)`
    ).run(
      recordId,
      sessionId,
      consentType,
      CONSENT_VERSION,
      signatureName || null,
      hashIp(ip),
      userAgent || null
    );

    const insertItem = db.prepare(
      `INSERT INTO consent_items (id, consent_record_id, item_key, item_text, required, response)
       VALUES (?, ?, ?, ?, ?, ?)`
    );

    for (const [key, value] of Object.entries(responses)) {
      const item = findConsentItem(consentType, key);
      if (!item) continue; // ignore keys not in the current document
      insertItem.run(newId(), recordId, key, item.text, item.required ? 1 : 0, value ? 1 : 0);
    }

    return recordId;
  });
}

/** POST /api/consent/adult */
consentRouter.post(
  '/adult',
  requireSession,
  asyncHandler(async (req, res) => {
    if (req.session.is_minor) {
      throw forbidden('This session requires guardian consent, not adult consent.');
    }
    if (req.session.status === 'screened_out') {
      throw forbidden('This session is outside the study age range.');
    }

    const { responses, signatureName } = req.body || {};
    if (!responses || typeof responses !== 'object') throw badRequest('responses is required.');

    const recordId = recordConsent({
      sessionId: req.session.id,
      consentType: 'adult',
      responses,
      signatureName,
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });

    const updated = updateSession(req.session.id, {
      status: 'consented',
      stage: 'demographics',
    });

    res.status(201).json({ consentRecordId: recordId, session: publicSession(updated) });
  })
);

/**
 * POST /api/consent/assent -- the young person's own agreement.
 * Only accepted once a guardian has already consented, so the order of the two
 * records in the database reflects the order they actually happened.
 */
consentRouter.post(
  '/assent',
  requireSession,
  asyncHandler(async (req, res) => {
    if (!req.session.is_minor) throw forbidden('Assent applies only to participants under 18.');

    const guardianConsented = getDb()
      .prepare(
        `SELECT 1 FROM consent_records
         WHERE session_id = ? AND consent_type = 'guardian' AND agreed = 1 AND withdrawn_at IS NULL`
      )
      .get(req.session.id);

    if (!guardianConsented) {
      throw forbidden('A parent or guardian must give permission before you can continue.');
    }

    const { responses, signatureName } = req.body || {};
    if (!responses || typeof responses !== 'object') throw badRequest('responses is required.');

    const recordId = recordConsent({
      sessionId: req.session.id,
      consentType: 'minor_assent',
      responses,
      signatureName,
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });

    const updated = updateSession(req.session.id, {
      status: 'consented',
      stage: 'demographics',
    });

    res.status(201).json({ consentRecordId: recordId, session: publicSession(updated) });
  })
);

/** GET /api/consent/me/status */
consentRouter.get(
  '/me/status',
  requireSession,
  asyncHandler(async (req, res) => {
    const records = getDb()
      .prepare(
        `SELECT consent_type, document_version, agreed, agreed_at, withdrawn_at
         FROM consent_records WHERE session_id = ? ORDER BY agreed_at`
      )
      .all(req.session.id);

    res.json({ records, session: publicSession(getSession(req.session.id)) });
  })
);
