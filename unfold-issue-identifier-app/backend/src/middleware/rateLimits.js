import rateLimit from 'express-rate-limit';
import { config } from '../config.js';

/**
 * Rate limiting keys on IP address, and a supervised session in one room shares
 * one address. A cohort of twenty participants on institutional wifi therefore
 * looks like a single very busy visitor, so these limits are env-tunable rather
 * than baked in -- see RATE_LIMIT_* in .env.example.
 *
 * Disabled entirely under NODE_ENV=test, where the suite drives the whole study
 * from one socket.
 */
function makeLimiter({ windowMs, max, message }) {
  if (config.env === 'test') {
    return (_req, _res, next) => next();
  }
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: {
        code: 'rate_limited',
        message: message || 'Too many requests. Please wait a moment and try again.',
      },
    },
  });
}

/** Broad ceiling across the whole API. */
export const globalLimiter = makeLimiter({
  windowMs: 60 * 1000,
  max: config.rateLimits.globalPerMinute,
});

/** Guarding the guardian short code, which is the only credential on that page. */
export const guardianCodeLimiter = makeLimiter({
  windowMs: 10 * 60 * 1000,
  max: config.rateLimits.guardianCodeLookups,
  message: 'Too many attempts. Please wait a few minutes and try again.',
});

/** Deliberately strict: this one protects researcher credentials. */
export const adminLoginLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000,
  max: config.rateLimits.adminLoginAttempts,
  message: 'Too many login attempts. Try again later.',
});

export const withdrawalLimiter = makeLimiter({
  windowMs: 10 * 60 * 1000,
  max: config.rateLimits.withdrawalAttempts,
});
