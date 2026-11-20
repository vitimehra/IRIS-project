import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { config } from '../config.js';
import { getDb } from '../db/index.js';
import { newId, newToken, hashToken, hashIp } from '../services/ids.js';
import { requireAdmin } from '../middleware/auth.js';
import { adminLoginLimiter } from '../middleware/rateLimits.js';
import { asyncHandler, badRequest, unauthorized, notFoundError } from '../middleware/errors.js';
import { buildFullExport, buildTableCsv, studyStats, EXPORTABLE_TABLES } from '../services/export.js';
import {
  foilAnalysis,
  frictionBreakdown,
  provenanceBreakdown,
  extractionHealth,
  completionFunnel,
  questionnaireSummary,
} from '../services/analysis.js';
import { withdrawSession } from './withdrawal.js';
import { buildParticipantLog } from '../services/participantLog.js';

export const adminRouter = Router();

/** Named accounts, so the audit log can say who did what. */
function audit(req, action, { targetType, targetId, details } = {}) {
  getDb()
    .prepare(
      `INSERT INTO admin_audit_log (
         id, admin_user_id, actor_label, action, target_type, target_id, details_json, ip_hash
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      newId(),
      req.adminUser?.id || null,
      req.adminUser?.display_name || 'unknown',
      action,
      targetType || null,
      targetId || null,
      details ? JSON.stringify(details) : null,
      hashIp(req.ip)
    );
}

/** POST /api/admin/login */
adminRouter.post(
  '/login',
  adminLoginLimiter,
  asyncHandler(async (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) throw badRequest('Username and password are required.');

    const user = getDb()
      .prepare(`SELECT * FROM admin_users WHERE username = ? AND is_active = 1`)
      .get(String(username).trim().toLowerCase());

    // Compare against a dummy hash when the user does not exist, so a missing
    // account and a wrong password take the same time to answer.
    const hash = user?.password_hash || '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin';
    const ok = await bcrypt.compare(String(password), hash);
    if (!user || !ok) throw unauthorized('Incorrect username or password.');

    const token = newToken();
    const db = getDb();
    db.prepare(
      `INSERT INTO admin_sessions (id, admin_user_id, token_hash, expires_at, ip_hash, user_agent)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      newId(),
      user.id,
      hashToken(token),
      new Date(Date.now() + config.adminSessionTtlHours * 3600 * 1000).toISOString(),
      hashIp(req.ip),
      req.get('user-agent') || null
    );
    db.prepare(`UPDATE admin_users SET last_login_at = datetime('now') WHERE id = ?`).run(user.id);

    req.adminUser = user;
    audit(req, 'admin.login');

    res.json({
      token,
      user: { username: user.username, displayName: user.display_name, role: user.role },
      expiresInHours: config.adminSessionTtlHours,
    });
  })
);

/** POST /api/admin/logout */
adminRouter.post(
  '/logout',
  requireAdmin,
  asyncHandler(async (req, res) => {
    getDb()
      .prepare(`UPDATE admin_sessions SET revoked_at = datetime('now') WHERE id = ?`)
      .run(req.adminSessionId);
    audit(req, 'admin.logout');
    res.json({ ok: true });
  })
);

/** GET /api/admin/me */
adminRouter.get(
  '/me',
  requireAdmin,
  asyncHandler(async (req, res) => {
    res.json({
      user: {
        username: req.adminUser.username,
        displayName: req.adminUser.display_name,
        role: req.adminUser.role,
        lastLoginAt: req.adminUser.last_login_at,
      },
    });
  })
);

/** GET /api/admin/stats */
adminRouter.get(
  '/stats',
  requireAdmin,
  asyncHandler(async (_req, res) => {
    res.json(studyStats());
  })
);

/** GET /api/admin/sessions */
adminRouter.get(
  '/sessions',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const offset = Number(req.query.offset) || 0;

    const rows = getDb()
      .prepare(
        `SELECT s.id, s.participant_code, s.status, s.stage, s.is_minor, s.declared_age,
                s.started_at, s.last_seen_at, s.completed_at, s.withdrawn_at,
                d.age, d.gender, d.occupation_category, d.settlement_type,
                (SELECT COUNT(*) FROM issues i WHERE i.session_id = s.id AND i.is_foil = 0) AS issue_count,
                (SELECT COUNT(*) FROM issue_ratings r WHERE r.session_id = s.id) AS rating_count
         FROM sessions s
         LEFT JOIN demographics d ON d.session_id = s.id
         ORDER BY s.started_at DESC
         LIMIT ? OFFSET ?`
      )
      .all(limit, offset);

    const total = getDb().prepare(`SELECT COUNT(*) n FROM sessions`).get().n;
    res.json({ sessions: rows, total, limit, offset });
  })
);

/** GET /api/admin/sessions/:id -- everything recorded for one participant. */
adminRouter.get(
  '/sessions/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const log = buildParticipantLog(req.params.id);
    if (!log) throw notFoundError('No such session.');

    audit(req, 'admin.session.view', {
      targetType: 'session',
      targetId: log.session.id,
      details: { participantCode: log.session.participant_code },
    });

    res.json(log);
  })
);

function researcherDeleteSession(req, action = 'admin.session.delete') {
  const result = withdrawSession({
    sessionId: req.params.id,
    reason: req.body?.reason || 'Deleted by researcher',
    method: 'researcher',
  });
  if (!result.alreadyDeleted) {
    audit(req, action, {
      targetType: 'session',
      targetId: req.params.id,
      details: { participantCode: result.participantCode, reason: req.body?.reason || null },
    });
  }
  return result;
}

/** POST /api/admin/sessions/:id/delete -- wipe participant data at any stage. */
adminRouter.post(
  '/sessions/:id/delete',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const result = researcherDeleteSession(req);
    res.json({
      deleted: true,
      alreadyDeleted: Boolean(result.alreadyDeleted),
      participantCode: result.participantCode,
    });
  })
);

/** POST /api/admin/sessions/:id/withdraw -- same as delete; kept for older clients. */
adminRouter.post(
  '/sessions/:id/withdraw',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const result = researcherDeleteSession(req, 'admin.session.withdraw');
    res.json({
      withdrawn: true,
      deleted: true,
      alreadyDeleted: Boolean(result.alreadyDeleted),
      participantCode: result.participantCode,
    });
  })
);

/** GET /api/admin/export.json */
adminRouter.get(
  '/export.json',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const payload = buildFullExport();
    audit(req, 'admin.export.json', { details: payload.meta.tableCounts });
    res.setHeader('Content-Type', 'application/json');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="unfold-export-${new Date().toISOString().slice(0, 10)}.json"`
    );
    res.send(JSON.stringify(payload, null, 2));
  })
);

/** GET /api/admin/export/:table.csv */
adminRouter.get(
  '/export/:table.csv',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { table } = req.params;
    const csv = buildTableCsv(table);
    if (csv === null) {
      throw badRequest(`Unknown table. Available: ${EXPORTABLE_TABLES.join(', ')}`);
    }
    audit(req, 'admin.export.csv', { targetType: 'table', targetId: table });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="unfold-${table}.csv"`);
    res.send(csv);
  })
);

/**
 * GET /api/admin/analysis
 * The views that matter when reading the study rather than running it. The
 * foil check comes first deliberately: it is what tells you whether any of the
 * severity numbers below it can be believed.
 */
adminRouter.get(
  '/analysis',
  requireAdmin,
  asyncHandler(async (_req, res) => {
    res.json({
      foils: foilAnalysis(),
      friction: frictionBreakdown(),
      provenance: provenanceBreakdown(),
      extraction: extractionHealth(),
      completion: completionFunnel(),
      questionnaire: questionnaireSummary(),
    });
  })
);

/** GET /api/admin/issues - every extracted issue, for reading the corpus. */
adminRouter.get(
  '/issues',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 200, 1000);
    const offset = Number(req.query.offset) || 0;
    const includeFoils = req.query.foils === 'true';

    const rows = getDb()
      .prepare(
        `SELECT i.id, i.headline, i.cause, i.cause_provenance, i.affect, i.affect_provenance,
                i.effect, i.effect_provenance, i.domain, i.time_band, i.confidence,
                i.is_foil, i.foil_family, i.shown_to_participant, i.source_evidence,
                s.participant_code,
                r.severity, r.rejected, r.edit_note
         FROM issues i
         JOIN sessions s ON s.id = i.session_id AND s.status != 'withdrawn'
         LEFT JOIN issue_ratings r ON r.issue_id = i.id
         WHERE (? = 1 OR i.is_foil = 0)
         ORDER BY s.started_at DESC, i.display_rank
         LIMIT ? OFFSET ?`
      )
      .all(includeFoils ? 1 : 0, limit, offset);

    res.json({ issues: rows, limit, offset });
  })
);

/** GET /api/admin/audit */
adminRouter.get(
  '/audit',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const rows = getDb()
      .prepare(`SELECT * FROM admin_audit_log ORDER BY created_at DESC LIMIT ?`)
      .all(limit);
    res.json({ entries: rows });
  })
);
