import { getDb } from '../db/index.js';

/**
 * Tables included in a full export, in dependency order so the JSON reads
 * top-down. Admin tables are excluded: they contain researcher credentials and
 * are not study data.
 */
export const EXPORTABLE_TABLES = [
  'sessions',
  'age_gate_responses',
  'consent_records',
  'consent_items',
  'guardian_requests',
  'demographics',
  'game_sessions',
  'episodes',
  'episode_tags',
  'saboteur_rounds',
  'saboteur_responses',
  'pairwise_rounds',
  'extraction_runs',
  'issues',
  'issue_ratings',
  'post_questionnaire_responses',
  'debrief_views',
  'telemetry_events',
  'withdrawals',
];

/**
 * Withdrawn participants have already had their rows deleted, so they cannot
 * appear in any child table. The sessions table still holds a blanked stub, and
 * that stub is excluded here: a withdrawal must not leave a participant visible
 * in the export.
 */
const SESSION_FILTER = `status != 'withdrawn'`;

function tableColumns(table) {
  return getDb()
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .map((c) => c.name);
}

function rowsFor(table) {
  const db = getDb();
  if (table === 'sessions') {
    return db.prepare(`SELECT * FROM sessions WHERE ${SESSION_FILTER} ORDER BY started_at`).all();
  }
  if (table === 'withdrawals') {
    // The audit stub: proves a deletion happened, carries no participant data.
    return db.prepare(`SELECT * FROM withdrawals ORDER BY requested_at`).all();
  }

  const columns = tableColumns(table);
  if (columns.includes('session_id')) {
    return db
      .prepare(
        `SELECT t.* FROM ${table} t
         JOIN sessions s ON s.id = t.session_id
         WHERE s.${SESSION_FILTER}`
      )
      .all();
  }

  // Tables that hang off game_sessions or another parent rather than directly
  // off sessions.
  const parents = {
    episodes: ['game_sessions', 'game_session_id'],
    episode_tags: ['episodes', 'episode_id'],
    saboteur_rounds: ['game_sessions', 'game_session_id'],
    saboteur_responses: ['saboteur_rounds', 'saboteur_round_id'],
    pairwise_rounds: ['game_sessions', 'game_session_id'],
    consent_items: ['consent_records', 'consent_record_id'],
  };

  const parent = parents[table];
  if (!parent) return db.prepare(`SELECT * FROM ${table}`).all();

  const [parentTable, fk] = parent;
  return db
    .prepare(
      `SELECT t.* FROM ${table} t
       JOIN ${parentTable} p ON p.id = t.${fk}
       WHERE p.id IN (SELECT id FROM ${parentTable})`
    )
    .all()
    .filter(Boolean);
}

export function buildFullExport() {
  const data = {};
  for (const table of EXPORTABLE_TABLES) {
    data[table] = rowsFor(table);
  }

  return {
    meta: {
      exportedAt: new Date().toISOString(),
      schemaVersion:
        getDb().prepare(`SELECT value FROM schema_meta WHERE key = 'schema_version'`).get()?.value ||
        'unknown',
      tableCounts: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.length])),
      note: 'Withdrawn participants are excluded. The withdrawals table records that a deletion occurred.',
    },
    data,
  };
}

function csvCell(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(rows) {
  if (!rows || rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => csvCell(row[h])).join(','));
  }
  return lines.join('\r\n');
}

export function buildTableCsv(table) {
  if (!EXPORTABLE_TABLES.includes(table)) return null;
  return toCsv(rowsFor(table));
}

/** Counters for the dashboard. */
export function studyStats() {
  const db = getDb();
  const one = (sql, ...params) => db.prepare(sql).get(...params);

  return {
    sessions: {
      total: one(`SELECT COUNT(*) n FROM sessions`).n,
      started: one(`SELECT COUNT(*) n FROM sessions WHERE status = 'started'`).n,
      consented: one(
        `SELECT COUNT(*) n FROM sessions WHERE status NOT IN ('started','age_gated','screened_out','withdrawn')`
      ).n,
      completed: one(`SELECT COUNT(*) n FROM sessions WHERE status = 'completed'`).n,
      screenedOut: one(`SELECT COUNT(*) n FROM sessions WHERE status = 'screened_out'`).n,
      withdrawn: one(`SELECT COUNT(*) n FROM sessions WHERE status = 'withdrawn'`).n,
      minors: one(`SELECT COUNT(*) n FROM sessions WHERE is_minor = 1 AND status != 'withdrawn'`).n,
    },
    guardian: {
      requested: one(`SELECT COUNT(*) n FROM guardian_requests`).n,
      consented: one(`SELECT COUNT(*) n FROM guardian_requests WHERE status = 'consented'`).n,
      declined: one(`SELECT COUNT(*) n FROM guardian_requests WHERE status = 'declined'`).n,
    },
    demographics: {
      submitted: one(`SELECT COUNT(*) n FROM demographics`).n,
    },
    issues: {
      extracted: one(`SELECT COUNT(*) n FROM issues WHERE is_foil = 0`).n,
      foils: one(`SELECT COUNT(*) n FROM issues WHERE is_foil = 1`).n,
      rated: one(`SELECT COUNT(*) n FROM issue_ratings`).n,
    },
    funnel: db
      .prepare(
        `SELECT status, COUNT(*) AS n FROM sessions GROUP BY status ORDER BY n DESC`
      )
      .all(),
  };
}
