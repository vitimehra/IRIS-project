/**
 * Creates or updates the two researcher accounts.
 *
 * Passwords come from ADMIN_VITI_PASSWORD and ADMIN_SANKAR_PASSWORD.
 * The API process runs this on boot, so Railway only needs those variables
 * set — no shell is required. Re-deploy after changing a password to rotate it.
 *
 * Local one-shot (still works):
 *   ADMIN_VITI_PASSWORD=... ADMIN_SANKAR_PASSWORD=... npm run seed:admins
 */
import bcrypt from 'bcryptjs';
import { getDb, closeDb } from '../db/index.js';
import { migrate } from '../db/migrate.js';
import { newId } from '../services/ids.js';

const ACCOUNTS = [
  {
    username: 'viti',
    displayName: 'Viti Mehra',
    role: 'researcher',
    passwordEnv: 'ADMIN_VITI_PASSWORD',
    emailEnv: 'ADMIN_VITI_EMAIL',
  },
  {
    username: 'sankar',
    displayName: 'Sankar Balasubramanian',
    role: 'owner',
    passwordEnv: 'ADMIN_SANKAR_PASSWORD',
    emailEnv: 'ADMIN_SANKAR_EMAIL',
  },
];

const MIN_PASSWORD_LENGTH = 4;

function passwordMatches(password, hash) {
  try {
    return Boolean(hash) && bcrypt.compareSync(password, hash);
  } catch {
    return false;
  }
}

export function seedAdmins({ applyMigrate = false, close = false } = {}) {
  if (applyMigrate) migrate();
  const db = getDb();
  let changed = 0;

  for (const account of ACCOUNTS) {
    const password = process.env[account.passwordEnv];
    const email = process.env[account.emailEnv] || null;

    if (!password) {
      console.log(`[seed] ${account.passwordEnv} not set, skipping ${account.username}`);
      continue;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      console.error(
        `[seed] ${account.passwordEnv} is too short - use at least ${MIN_PASSWORD_LENGTH} characters.`
      );
      if (close) process.exitCode = 1;
      continue;
    }

    const existing = db
      .prepare(`SELECT id, password_hash FROM admin_users WHERE username = ?`)
      .get(account.username);

    if (existing && passwordMatches(password, existing.password_hash)) {
      if (email) {
        db.prepare(
          `UPDATE admin_users SET email = COALESCE(?, email), is_active = 1 WHERE id = ?`
        ).run(email, existing.id);
      }
      console.log(`[seed] ${account.username} already up to date`);
      changed += 1;
      continue;
    }

    const hash = bcrypt.hashSync(password, 12);

    if (existing) {
      db.prepare(
        `UPDATE admin_users
         SET password_hash = ?, display_name = ?, role = ?, is_active = 1,
             email = COALESCE(?, email)
         WHERE id = ?`
      ).run(hash, account.displayName, account.role, email, existing.id);
      console.log(`[seed] updated ${account.username} (${account.displayName})`);
    } else {
      db.prepare(
        `INSERT INTO admin_users (id, username, display_name, email, password_hash, role)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(newId(), account.username, account.displayName, email, hash, account.role);
      console.log(`[seed] created ${account.username} (${account.displayName})`);
    }
    changed += 1;
  }

  if (changed === 0) {
    console.log('[seed] nothing to do. Set ADMIN_VITI_PASSWORD and ADMIN_SANKAR_PASSWORD.');
  }
  if (close) closeDb();
}

if (process.argv[1] && process.argv[1].endsWith('seedAdmins.js')) {
  seedAdmins({ applyMigrate: true, close: true });
}
