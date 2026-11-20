import { randomUUID, randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

export function newId() {
  return randomUUID();
}

/** URL-safe opaque token. Only ever leaves the server once, to its owner. */
export function newToken() {
  return randomBytes(32).toString('base64url');
}

export function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

/** Tokens are stored as digests, so a database dump cannot be replayed. */
export function hashToken(token) {
  return sha256(token);
}

export function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * We keep a salted digest rather than the address itself. It is enough to spot
 * duplicate submissions from one device, and it is not personal data at rest.
 */
export function hashIp(ip) {
  if (!ip) return null;
  return sha256(`${config.ipHashSalt}:${ip}`);
}

// Deliberately excludes I, O, 0, 1 -- a guardian reads this off a phone screen
// and types it into their own.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function newShortCode(length = 6) {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return out;
}
