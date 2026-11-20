import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb, closeDb } from './index.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export const SCHEMA_VERSION = '1.0.0';

/**
 * Applies schema.sql. Every statement is CREATE ... IF NOT EXISTS, so this is
 * idempotent and safe to run on every boot.
 */
export function migrate({ verbose = false } = {}) {
  const db = getDb();
  const sql = fs.readFileSync(path.join(here, 'schema.sql'), 'utf8');
  db.exec(sql);

  db.prepare(
    `INSERT INTO schema_meta (key, value, updated_at)
     VALUES ('schema_version', ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(SCHEMA_VERSION);

  if (verbose) {
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
      .all()
      .map((r) => r.name)
      .filter((n) => !n.startsWith('sqlite_'));
    console.log(`[migrate] schema ${SCHEMA_VERSION} applied, ${tables.length} tables`);
    console.log(`[migrate] ${tables.join(', ')}`);
  }

  return SCHEMA_VERSION;
}

// Allow `npm run migrate` as a standalone command.
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('migrate.js')) {
  migrate({ verbose: true });
  closeDb();
}
