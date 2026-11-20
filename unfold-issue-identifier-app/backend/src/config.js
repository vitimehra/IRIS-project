import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(here, '..');

function required(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === '') {
    if (fallback !== undefined) return fallback;
    throw new Error(
      `Missing required environment variable ${name}. See backend/.env.example.`
    );
  }
  return value;
}

const isProduction = process.env.NODE_ENV === 'production';

// On Railway the volume is mounted at /data. Locally we keep the file inside the
// repo's database/ folder so it is easy to find and easy to delete.
const defaultDbPath = isProduction
  ? '/data/unfold.sqlite'
  : path.resolve(backendRoot, '..', 'database', 'unfold.sqlite');

export const config = {
  env: process.env.NODE_ENV || 'development',
  isProduction,
  port: Number(process.env.PORT || 4000),

  dbPath: process.env.DATABASE_PATH || defaultDbPath,

  // Salts an IP before hashing. Without it, a short list of candidate addresses
  // could be brute-forced against the stored digests.
  ipHashSalt: required('IP_HASH_SALT', isProduction ? undefined : 'dev-only-insecure-salt'),

  // Comma-separated list of allowed frontend origins.
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  // Where the participant's browser is served from. Used to build the guardian
  // consent link that goes into the QR code.
  publicAppUrl: process.env.PUBLIC_APP_URL || 'http://localhost:5173',

  sessionTokenTtlHours: Number(process.env.SESSION_TOKEN_TTL_HOURS || 72),
  guardianRequestTtlMinutes: Number(process.env.GUARDIAN_REQUEST_TTL_MINUTES || 120),
  adminSessionTtlHours: Number(process.env.ADMIN_SESSION_TTL_HOURS || 12),

  // Phase 3 uses these. Declared now so deployment configuration does not change
  // between phases.
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY || '',
    model: process.env.ANTHROPIC_MODEL || 'claude-opus-5',
    // The instrument stays fully playable with extraction disabled, which is how
    // you demo it without burning credits.
    enabled: process.env.LLM_ENABLED !== 'false',
  },

  // Limits key on IP, and participants in one supervised room share an address.
  // Raise globalPerMinute before running a group session on shared wifi.
  rateLimits: {
    globalPerMinute: Number(process.env.RATE_LIMIT_GLOBAL_PER_MINUTE || 600),
    guardianCodeLookups: Number(process.env.RATE_LIMIT_GUARDIAN_LOOKUPS || 60),
    adminLoginAttempts: Number(process.env.RATE_LIMIT_ADMIN_LOGINS || 10),
    withdrawalAttempts: Number(process.env.RATE_LIMIT_WITHDRAWALS || 20),
  },

  study: {
    minAge: Number(process.env.STUDY_MIN_AGE || 15),
    maxAge: Number(process.env.STUDY_MAX_AGE || 50),
    minorThreshold: Number(process.env.STUDY_MINOR_THRESHOLD || 18),
    participantCodePrefix: process.env.PARTICIPANT_CODE_PREFIX || 'P',
  },
};
