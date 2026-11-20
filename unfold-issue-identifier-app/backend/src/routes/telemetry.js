import { Router } from 'express';
import { getDb, transact } from '../db/index.js';
import { newId } from '../services/ids.js';
import { requireSession } from '../middleware/auth.js';
import { asyncHandler, badRequest } from '../middleware/errors.js';

export const telemetryRouter = Router();

const MAX_BATCH = 200;
const MAX_PAYLOAD_CHARS = 8000;

/**
 * POST /api/telemetry -- buffered batch from the client.
 * Timing data is a real part of the instrument: how long someone hovers over a
 * severity scale says something the rating alone does not.
 */
telemetryRouter.post(
  '/',
  requireSession,
  asyncHandler(async (req, res) => {
    const { events } = req.body || {};
    if (!Array.isArray(events)) throw badRequest('events must be an array.');
    if (events.length === 0) return res.json({ accepted: 0 });
    if (events.length > MAX_BATCH) throw badRequest(`Send at most ${MAX_BATCH} events per batch.`);

    const insert = getDb().prepare(
      `INSERT INTO telemetry_events (id, session_id, event_type, page, payload_json, client_ts)
       VALUES (?, ?, ?, ?, ?, ?)`
    );

    let accepted = 0;
    transact(() => {
      for (const event of events) {
        if (!event || typeof event.type !== 'string') continue;
        let payload = null;
        if (event.payload !== undefined) {
          payload = JSON.stringify(event.payload);
          if (payload.length > MAX_PAYLOAD_CHARS) payload = payload.slice(0, MAX_PAYLOAD_CHARS);
        }
        insert.run(
          newId(),
          req.session.id,
          event.type,
          event.page || null,
          payload,
          event.clientTs || null
        );
        accepted += 1;
      }
    });

    res.json({ accepted });
  })
);
