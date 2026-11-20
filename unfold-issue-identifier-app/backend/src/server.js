import { config } from './config.js';
import { migrate } from './db/migrate.js';
import { seedAdmins } from './scripts/seedAdmins.js';
import { createApp } from './app.js';

// Idempotent, so a fresh Railway volume becomes a working database on first boot
// without a separate deploy step. Researcher accounts follow the ADMIN_* variables
// the same way — no Railway shell required.
migrate({ verbose: true });
seedAdmins();

const app = createApp();

const server = app.listen(config.port, () => {
  console.log(`[unfold] API listening on :${config.port} (${config.env})`);
  console.log(`[unfold] database: ${config.dbPath}`);
  console.log(`[unfold] allowed origins: ${config.corsOrigins.join(', ')}`);
  if (!config.anthropic.apiKey) {
    console.log('[unfold] no ANTHROPIC_API_KEY set - extraction will use the rule-based fallback');
  }
});

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    console.log(`[unfold] ${signal} received, shutting down`);
    server.close(() => process.exit(0));
  });
}
