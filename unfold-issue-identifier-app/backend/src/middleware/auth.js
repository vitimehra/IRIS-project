import { getDb } from '../db/index.js';
import { hashToken } from '../services/ids.js';
import { findSessionByToken, touchSession } from '../services/sessions.js';
import { unauthorized, forbidden, gone } from './errors.js';

function bearer(req) {
  const header = req.get('authorization') || '';
  if (!header.toLowerCase().startsWith('bearer ')) return null;
  return header.slice(7).trim() || null;
}

/** Attaches req.session for participant-facing routes. */
export function requireSession(req, _res, next) {
  const token = bearer(req);
  if (!token) return next(unauthorized('Missing session token.'));

  const session = findSessionByToken(token);
  if (!session) return next(unauthorized('Session token is invalid or has expired.'));

  // Defence in depth. Withdrawal already deletes the token row, so in practice
  // a withdrawn participant fails the lookup above and never reaches here. This
  // stays as a second gate in case a future path marks a session withdrawn
  // without revoking its tokens.
  if (session.status === 'withdrawn') {
    return next(gone('This session has been withdrawn.'));
  }

  req.session = session;
  touchSession(session.id);
  next();
}

/** Attaches req.adminUser. Used by the researcher dashboard. */
export function requireAdmin(req, _res, next) {
  const token = bearer(req);
  if (!token) return next(unauthorized('Missing admin token.'));

  const row = getDb()
    .prepare(
      `SELECT u.*, s.id AS admin_session_id
       FROM admin_sessions s
       JOIN admin_users u ON u.id = s.admin_user_id
       WHERE s.token_hash = ?
         AND s.revoked_at IS NULL
         AND s.expires_at > datetime('now')
         AND u.is_active = 1`
    )
    .get(hashToken(token));

  if (!row) return next(unauthorized('Admin token is invalid or has expired.'));

  req.adminUser = row;
  req.adminSessionId = row.admin_session_id;
  next();
}

export function requireRole(role) {
  return (req, _res, next) => {
    if (!req.adminUser) return next(unauthorized());
    if (req.adminUser.role !== role) return next(forbidden(`Requires ${role} role.`));
    next();
  };
}
