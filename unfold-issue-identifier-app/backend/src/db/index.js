import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from '../config.js';

let db = null;

export function getDb() {
  if (db) return db;

  const dir = path.dirname(config.dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  db = new Database(config.dbPath);

  // WAL gives us concurrent readers while a write is in flight. It is safe here
  // precisely because the service is pinned to a single replica -- see railway.json.
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  return db;
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

/** Runs a function inside a transaction and returns its result. */
export function transact(fn) {
  return getDb().transaction(fn)();
}
