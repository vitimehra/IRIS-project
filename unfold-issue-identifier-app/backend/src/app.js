import express from 'express';
import cors from 'cors';
import { globalLimiter } from './middleware/rateLimits.js';
import { config } from './config.js';
import { getDb } from './db/index.js';
import { STUDY_CONTACTS } from './content/consent.js';
import { sessionsRouter } from './routes/sessions.js';
import { consentRouter } from './routes/consent.js';
import { guardianRouter } from './routes/guardian.js';
import { demographicsRouter } from './routes/demographics.js';
import { gameRouter } from './routes/game.js';
import { issuesRouter } from './routes/issues.js';
import { telemetryRouter } from './routes/telemetry.js';
import { withdrawalRouter } from './routes/withdrawal.js';
import { adminRouter } from './routes/admin.js';
import { notFoundMiddleware, errorMiddleware } from './middleware/errors.js';

export function createApp() {
  const app = express();

  // Railway terminates TLS at its edge, so the client address arrives in
  // X-Forwarded-For. Without this, every participant shares one IP hash and the
  // rate limiters treat the whole study as a single visitor.
  app.set('trust proxy', 1);

  app.use(express.json({ limit: '1mb' }));

  app.use(
    cors({
      origin(origin, callback) {
        // No Origin header: curl, server-to-server, same-origin. Allowed.
        if (!origin) return callback(null, true);
        if (config.corsOrigins.includes(origin)) return callback(null, true);
        callback(new Error(`Origin ${origin} is not allowed by CORS.`));
      },
      credentials: false,
    })
  );

  app.use(globalLimiter);

  app.get('/api/health', (_req, res) => {
    let dbOk = true;
    try {
      getDb().prepare('SELECT 1').get();
    } catch {
      dbOk = false;
    }
    res.status(dbOk ? 200 : 503).json({
      ok: dbOk,
      env: config.env,
      llmEnabled: config.anthropic.enabled && Boolean(config.anthropic.apiKey),
      time: new Date().toISOString(),
    });
  });

  /** Study metadata the frontend renders in its header, footer and debrief. */
  app.get('/api/study-info', (_req, res) => {
    res.json({
      contacts: STUDY_CONTACTS,
      ageRange: { min: config.study.minAge, max: config.study.maxAge },
      minorThreshold: config.study.minorThreshold,
    });
  });

  app.use('/api/sessions', sessionsRouter);
  app.use('/api/consent', consentRouter);
  app.use('/api/guardian', guardianRouter);
  app.use('/api/demographics', demographicsRouter);
  app.use('/api/game', gameRouter);
  app.use('/api/issues', issuesRouter);
  app.use('/api/telemetry', telemetryRouter);
  app.use('/api/withdrawal', withdrawalRouter);
  app.use('/api/admin', adminRouter);

  app.use(notFoundMiddleware);
  app.use(errorMiddleware);

  return app;
}
