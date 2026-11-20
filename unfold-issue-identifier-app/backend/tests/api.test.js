/**
 * End-to-end exercise of the Phase 1 participant journey.
 *
 * Runs against a throwaway SQLite file so it never touches development data.
 * Environment is set before any application module is imported, because config.js
 * reads process.env at import time.
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TEST_DB = path.join(os.tmpdir(), `unfold-test-${Date.now()}-${process.pid}.sqlite`);

process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = TEST_DB;
process.env.IP_HASH_SALT = 'test-salt';
process.env.PUBLIC_APP_URL = 'http://localhost:5173';
process.env.ADMIN_VITI_PASSWORD = 'test-password-viti-1234';
process.env.ADMIN_SANKAR_PASSWORD = 'test-password-sankar-1234';

const { migrate } = await import('../src/db/migrate.js');
const { createApp } = await import('../src/app.js');
const { getDb, closeDb } = await import('../src/db/index.js');
const bcrypt = (await import('bcryptjs')).default;
const { newId } = await import('../src/services/ids.js');

let server;
let base;

before(async () => {
  migrate();

  // Two named researcher accounts, matching what seedAdmins.js creates.
  const db = getDb();
  for (const [username, displayName, role, password] of [
    ['viti', 'Viti Mehra', 'researcher', process.env.ADMIN_VITI_PASSWORD],
    ['sankar', 'Sankar Balasubramanian', 'owner', process.env.ADMIN_SANKAR_PASSWORD],
  ]) {
    db.prepare(
      `INSERT INTO admin_users (id, username, display_name, password_hash, role)
       VALUES (?, ?, ?, ?, ?)`
    ).run(newId(), username, displayName, bcrypt.hashSync(password, 4), role);
  }

  await new Promise((resolve) => {
    server = createApp().listen(0, () => {
      base = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  closeDb();
  try {
    for (const suffix of ['', '-wal', '-shm']) fs.unlinkSync(TEST_DB + suffix);
  } catch {
    /* best effort */
  }
});

// --- helpers ---------------------------------------------------------------

async function api(method, url, { body, token } = {}) {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: res.status, body: json, text };
}

const get = (u, o) => api('GET', u, o);
const post = (u, b, o) => api('POST', u, { body: b, ...o });

async function newSession() {
  const res = await post('/api/sessions', { client: { timezone: 'Asia/Kolkata', locale: 'en-IN' } });
  assert.equal(res.status, 201);
  return res.body;
}

function allRequired(items) {
  return Object.fromEntries(items.filter((i) => i.required).map((i) => [i.key, true]));
}

async function consentedAdultSession() {
  const session = await newSession();
  await post('/api/sessions/me/age-gate', { age: 28 }, { token: session.token });
  const doc = (await get('/api/consent/adult')).body;
  await post(
    '/api/consent/adult',
    { responses: allRequired(doc.items) },
    { token: session.token }
  );
  return session;
}

// --- health and metadata ---------------------------------------------------

test('health check reports database reachable', async () => {
  const res = await get('/api/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
});

test('study info exposes contacts and the age range', async () => {
  const res = await get('/api/study-info');
  assert.equal(res.status, 200);
  assert.equal(res.body.ageRange.min, 15);
  assert.equal(res.body.ageRange.max, 50);
  assert.equal(res.body.contacts.researchers.length, 2);
});

// --- sessions --------------------------------------------------------------

test('session creation issues a token and a sequential participant code', async () => {
  const a = await newSession();
  const b = await newSession();
  assert.match(a.participantCode, /^P\d{3}$/);
  assert.notEqual(a.participantCode, b.participantCode);
  assert.ok(a.token.length > 20);
});

test('session token is stored hashed, never in plaintext', async () => {
  const session = await newSession();
  const rows = getDb().prepare(`SELECT token_hash FROM session_tokens`).all();
  assert.ok(rows.every((r) => r.token_hash !== session.token));
});

test('requests without a token are rejected', async () => {
  const res = await get('/api/sessions/me');
  assert.equal(res.status, 401);
});

test('a forged token is rejected', async () => {
  const res = await get('/api/sessions/me', { token: 'not-a-real-token' });
  assert.equal(res.status, 401);
});

// --- age gate --------------------------------------------------------------

test('age gate routes an adult to the adult consent path', async () => {
  const session = await newSession();
  const res = await post('/api/sessions/me/age-gate', { age: 32 }, { token: session.token });
  assert.equal(res.body.result, 'adult');
  assert.equal(res.body.requiresGuardianConsent, false);
  assert.equal(res.body.session.stage, 'consent');
});

test('age gate routes a 16 year old to the guardian path', async () => {
  const session = await newSession();
  const res = await post('/api/sessions/me/age-gate', { age: 16 }, { token: session.token });
  assert.equal(res.body.result, 'minor');
  assert.equal(res.body.requiresGuardianConsent, true);
  assert.equal(res.body.session.isMinor, true);
});

test('age gate screens out below 15 and above 50', async () => {
  for (const age of [12, 14, 51, 70]) {
    const session = await newSession();
    const res = await post('/api/sessions/me/age-gate', { age }, { token: session.token });
    assert.equal(res.body.result, 'screened_out', `age ${age}`);
    assert.equal(res.body.eligible, false);
  }
});

test('age gate rejects nonsense input', async () => {
  const session = await newSession();
  for (const age of ['abc', -3, 500, null]) {
    const res = await post('/api/sessions/me/age-gate', { age }, { token: session.token });
    assert.equal(res.status, 400, `age ${age}`);
  }
});

// --- consent documents -----------------------------------------------------

test('all three consent documents are served and carry required items', async () => {
  for (const type of ['adult', 'minor_assent', 'guardian']) {
    const res = await get(`/api/consent/${type}`);
    assert.equal(res.status, 200, type);
    assert.ok(res.body.items.length > 0, type);
    assert.ok(res.body.infoSheet.sections.length > 0, type);
    assert.ok(res.body.items.some((i) => i.required), type);
  }
});

test('guardian wording is authored separately, not derived from the participant text', async () => {
  const adult = (await get('/api/consent/adult')).body;
  const guardian = (await get('/api/consent/guardian')).body;

  const adultLlm = adult.items.find((i) => i.key === 'llm_processing').text;
  const guardianLlm = guardian.items.find((i) => i.key === 'llm_processing').text;

  assert.notEqual(adultLlm, guardianLlm);
  // The failure mode this guards against: first-person participant wording
  // leaking onto a form a parent signs about their child.
  assert.match(guardianLlm, /my child/i);
  assert.doesNotMatch(guardianLlm, /\bmy answers\b/i);
});

test('unknown consent document type is a 400', async () => {
  const res = await get('/api/consent/nonsense');
  assert.equal(res.status, 400);
});

// --- adult consent ---------------------------------------------------------

test('adult consent is refused when a required item is unticked', async () => {
  const session = await newSession();
  await post('/api/sessions/me/age-gate', { age: 30 }, { token: session.token });

  const doc = (await get('/api/consent/adult')).body;
  const responses = allRequired(doc.items);
  delete responses.voluntary;

  const res = await post('/api/consent/adult', { responses }, { token: session.token });
  assert.equal(res.status, 400);
  assert.deepEqual(res.body.error.details.missing, ['voluntary']);

  // and nothing was written
  const count = getDb()
    .prepare(`SELECT COUNT(*) n FROM consent_records WHERE session_id = ?`)
    .get(session.sessionId).n;
  assert.equal(count, 0);
});

test('adult consent stores the exact text of every item shown', async () => {
  const session = await consentedAdultSession();
  const doc = (await get('/api/consent/adult')).body;

  const record = getDb()
    .prepare(`SELECT * FROM consent_records WHERE session_id = ?`)
    .get(session.sessionId);
  assert.equal(record.consent_type, 'adult');
  assert.equal(record.agreed, 1);

  const items = getDb()
    .prepare(`SELECT * FROM consent_items WHERE consent_record_id = ?`)
    .all(record.id);

  for (const item of items) {
    const source = doc.items.find((i) => i.key === item.item_key);
    assert.equal(item.item_text, source.text, `text drift on ${item.item_key}`);
  }
});

test('a minor cannot take the adult consent path', async () => {
  const session = await newSession();
  await post('/api/sessions/me/age-gate', { age: 16 }, { token: session.token });
  const doc = (await get('/api/consent/adult')).body;
  const res = await post(
    '/api/consent/adult',
    { responses: allRequired(doc.items) },
    { token: session.token }
  );
  assert.equal(res.status, 403);
});

// --- guardian handoff ------------------------------------------------------

async function minorSessionAwaitingGuardian() {
  const session = await newSession();
  await post('/api/sessions/me/age-gate', { age: 16 }, { token: session.token });
  const res = await post('/api/guardian/requests', {}, { token: session.token });
  assert.equal(res.status, 201);
  return { session, request: res.body };
}

test('guardian request returns a code and a link to the frontend, not the API', async () => {
  const { request } = await minorSessionAwaitingGuardian();
  assert.match(request.shortCode, /^[A-Z2-9]{6}$/);
  assert.ok(request.guardianUrl.startsWith('http://localhost:5173/guardian/'));
  assert.equal(request.status, 'pending');
});

test('the code alphabet excludes characters a guardian would mistype', async () => {
  for (let i = 0; i < 40; i += 1) {
    const { request } = await minorSessionAwaitingGuardian();
    assert.doesNotMatch(request.shortCode, /[IO01]/, `ambiguous character in ${request.shortCode}`);
  }
});

test('refreshing the waiting screen reuses the live code rather than stranding it', async () => {
  const { session, request } = await minorSessionAwaitingGuardian();
  const again = await post('/api/guardian/requests', {}, { token: session.token });
  assert.equal(again.body.shortCode, request.shortCode);
});

test('an adult session cannot open a guardian request', async () => {
  const session = await consentedAdultSession();
  const res = await post('/api/guardian/requests', {}, { token: session.token });
  assert.equal(res.status, 403);
});

test('opening the guardian page marks the request viewed', async () => {
  const { session, request } = await minorSessionAwaitingGuardian();

  const view = await get(`/api/guardian/by-code/${request.shortCode}`);
  assert.equal(view.status, 200);
  assert.equal(view.body.status, 'viewed');

  const status = await get('/api/guardian/requests/status', { token: session.token });
  assert.equal(status.body.status, 'viewed');
});

test('the guardian page reveals nothing about the young person', async () => {
  const { request } = await minorSessionAwaitingGuardian();
  const view = await get(`/api/guardian/by-code/${request.shortCode}`);
  const keys = Object.keys(view.body);
  for (const leaky of ['sessionId', 'session_id', 'participantCode', 'declaredAge', 'age', 'firstName']) {
    assert.ok(!keys.includes(leaky), `guardian payload leaked ${leaky}`);
  }
});

test('an unknown guardian code is a 404', async () => {
  const res = await get('/api/guardian/by-code/ZZZZZZ');
  assert.equal(res.status, 404);
});

test('guardian consent is refused when a required item is unticked, leaving status unresolved', async () => {
  const { request } = await minorSessionAwaitingGuardian();
  const doc = (await get('/api/consent/guardian')).body;
  const responses = allRequired(doc.items);
  delete responses.give_permission;

  const res = await post(`/api/guardian/by-code/${request.shortCode}/consent`, {
    responses,
    guardianName: 'A Parent',
    guardianRelationship: 'mother',
  });
  assert.equal(res.status, 400);

  // The request must not be left marked consented after a rejected submission.
  const row = getDb()
    .prepare(`SELECT status FROM guardian_requests WHERE short_code = ?`)
    .get(request.shortCode);
  assert.notEqual(row.status, 'consented');
});

test('guardian consent requires a name and a stated relationship', async () => {
  const { request } = await minorSessionAwaitingGuardian();
  const doc = (await get('/api/consent/guardian')).body;
  const responses = allRequired(doc.items);

  const noName = await post(`/api/guardian/by-code/${request.shortCode}/consent`, {
    responses,
    guardianName: '',
    guardianRelationship: 'father',
  });
  assert.equal(noName.status, 400);

  const noRelationship = await post(`/api/guardian/by-code/${request.shortCode}/consent`, {
    responses,
    guardianName: 'A Parent',
  });
  assert.equal(noRelationship.status, 400);
});

test('guardian consent unlocks assent but does not by itself consent the session', async () => {
  const { session, request } = await minorSessionAwaitingGuardian();
  const doc = (await get('/api/consent/guardian')).body;

  const res = await post(`/api/guardian/by-code/${request.shortCode}/consent`, {
    responses: allRequired(doc.items),
    guardianName: 'A Parent',
    guardianRelationship: 'mother',
  });
  assert.equal(res.status, 201);

  const status = await get('/api/guardian/requests/status', { token: session.token });
  assert.equal(status.body.status, 'consented');
  // The young person has still not agreed themselves.
  assert.equal(status.body.session.status, 'awaiting_guardian');
  assert.equal(status.body.session.stage, 'assent');
});

test('a guardian cannot answer the same request twice', async () => {
  const { request } = await minorSessionAwaitingGuardian();
  const doc = (await get('/api/consent/guardian')).body;
  const payload = {
    responses: allRequired(doc.items),
    guardianName: 'A Parent',
    guardianRelationship: 'mother',
  };

  assert.equal((await post(`/api/guardian/by-code/${request.shortCode}/consent`, payload)).status, 201);
  assert.equal((await post(`/api/guardian/by-code/${request.shortCode}/consent`, payload)).status, 400);
});

test('assent is refused until a guardian has consented', async () => {
  const { session } = await minorSessionAwaitingGuardian();
  const doc = (await get('/api/consent/minor_assent')).body;
  const res = await post(
    '/api/consent/assent',
    { responses: allRequired(doc.items) },
    { token: session.token }
  );
  assert.equal(res.status, 403);
});

test('assent after guardian consent completes the minor consent path', async () => {
  const { session, request } = await minorSessionAwaitingGuardian();
  const guardianDoc = (await get('/api/consent/guardian')).body;
  await post(`/api/guardian/by-code/${request.shortCode}/consent`, {
    responses: allRequired(guardianDoc.items),
    guardianName: 'A Parent',
    guardianRelationship: 'father',
  });

  const assentDoc = (await get('/api/consent/minor_assent')).body;
  const res = await post(
    '/api/consent/assent',
    { responses: allRequired(assentDoc.items) },
    { token: session.token }
  );
  assert.equal(res.status, 201);
  assert.equal(res.body.session.status, 'consented');

  const types = getDb()
    .prepare(`SELECT consent_type FROM consent_records WHERE session_id = ? ORDER BY agreed_at`)
    .all(session.sessionId)
    .map((r) => r.consent_type);
  assert.deepEqual(types, ['guardian', 'minor_assent']);
});

test('a declining guardian screens the session out', async () => {
  const { session, request } = await minorSessionAwaitingGuardian();
  const res = await post(`/api/guardian/by-code/${request.shortCode}/decline`, {
    reason: 'Not right now',
  });
  assert.equal(res.status, 200);

  const status = await get('/api/guardian/requests/status', { token: session.token });
  assert.equal(status.body.status, 'declined');
  assert.equal(status.body.session.status, 'screened_out');
});

test('an expired request cannot be consented to', async () => {
  const { request } = await minorSessionAwaitingGuardian();
  getDb()
    .prepare(`UPDATE guardian_requests SET expires_at = datetime('now', '-1 hour') WHERE short_code = ?`)
    .run(request.shortCode);

  const view = await get(`/api/guardian/by-code/${request.shortCode}`);
  assert.equal(view.body.status, 'expired');

  const doc = (await get('/api/consent/guardian')).body;
  const res = await post(`/api/guardian/by-code/${request.shortCode}/consent`, {
    responses: allRequired(doc.items),
    guardianName: 'A Parent',
    guardianRelationship: 'mother',
  });
  assert.equal(res.status, 410);
});

// --- demographics ----------------------------------------------------------

test('demographics schema is served with four steps', async () => {
  const res = await get('/api/demographics/schema');
  assert.equal(res.status, 200);
  assert.equal(res.body.steps.length, 4);
  assert.ok(res.body.steps.every((s) => s.fields.length > 0));
});

test('demographics is refused before consent', async () => {
  const session = await newSession();
  await post('/api/sessions/me/age-gate', { age: 30 }, { token: session.token });
  const res = await post('/api/demographics', { answers: { age: 30 } }, { token: session.token });
  assert.equal(res.status, 403);
});

test('demographics maps analysis columns and keeps the raw submission verbatim', async () => {
  const session = await consentedAdultSession();
  const answers = {
    first_name: 'Asha',
    age: 34,
    gender: 'woman',
    country: 'India',
    city: 'Bengaluru',
    settlement_type: 'metro',
    household_size: 4,
    household_composition: ['partner', 'children', 'parents'],
    has_children: true,
    children_count: 2,
    employment_status: 'employed_full',
    occupation_category: 'it_software',
    work_hours_per_week: 45,
    daily_screen_hours: 3.5,
    income_confidence: 'comfortable',
    // A field with no column yet. It must survive in raw_payload.
    future_field_not_yet_columned: 'still recorded',
  };

  const res = await post(
    '/api/demographics',
    { answers, completedSteps: 4, durationMs: 184000 },
    { token: session.token }
  );
  assert.equal(res.status, 201);
  assert.equal(res.body.session.status, 'demographics_done');

  const row = getDb()
    .prepare(`SELECT * FROM demographics WHERE session_id = ?`)
    .get(session.sessionId);

  assert.equal(row.first_name, 'Asha');
  assert.equal(row.age, 34);
  assert.equal(row.age_band, '25_34');
  assert.equal(row.household_size, 4);
  assert.equal(row.has_children, 1);
  assert.equal(row.daily_screen_hours, 3.5);
  assert.equal(row.household_composition, 'partner,children,parents');

  const raw = JSON.parse(row.raw_payload);
  assert.equal(raw.answers.future_field_not_yet_columned, 'still recorded');
});

test('demographics can be resubmitted and updates in place', async () => {
  const session = await consentedAdultSession();
  await post('/api/demographics', { answers: { age: 22, city: 'Pune' } }, { token: session.token });
  const second = await post(
    '/api/demographics',
    { answers: { age: 23, city: 'Mumbai' } },
    { token: session.token }
  );
  assert.equal(second.status, 200);

  const rows = getDb()
    .prepare(`SELECT * FROM demographics WHERE session_id = ?`)
    .all(session.sessionId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].city, 'Mumbai');
  assert.equal(rows[0].age, 23);
});

test('demographics requires an age', async () => {
  const session = await consentedAdultSession();
  const res = await post('/api/demographics', { answers: { city: 'Delhi' } }, { token: session.token });
  assert.equal(res.status, 400);
});

// --- telemetry -------------------------------------------------------------

test('telemetry accepts a batch and rejects an oversized one', async () => {
  const session = await consentedAdultSession();

  const ok = await post(
    '/api/telemetry',
    {
      events: [
        { type: 'page_view', page: 'landing', clientTs: new Date().toISOString() },
        { type: 'field_focus', page: 'demographics', payload: { field: 'age' } },
      ],
    },
    { token: session.token }
  );
  assert.equal(ok.body.accepted, 2);

  const tooMany = await post(
    '/api/telemetry',
    { events: Array.from({ length: 201 }, () => ({ type: 'noise' })) },
    { token: session.token }
  );
  assert.equal(tooMany.status, 400);
});

// --- withdrawal ------------------------------------------------------------

test('withdrawing deletes the participant data but keeps an audit stub', async () => {
  const session = await consentedAdultSession();
  await post('/api/demographics', { answers: { age: 40, city: 'Chennai' } }, { token: session.token });

  const res = await post('/api/withdrawal/me', { reason: 'changed my mind' }, { token: session.token });
  assert.equal(res.status, 200);

  const db = getDb();
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM demographics WHERE session_id = ?`).get(session.sessionId).n, 0);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM consent_records WHERE session_id = ?`).get(session.sessionId).n, 0);

  const stub = db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(session.sessionId);
  assert.equal(stub.status, 'withdrawn');
  assert.equal(stub.ip_hash, null);
  // The code stays reserved so it is never reissued to someone else.
  assert.equal(stub.participant_code, session.participantCode);

  const withdrawal = db
    .prepare(`SELECT * FROM withdrawals WHERE session_id = ?`)
    .get(session.sessionId);
  assert.equal(withdrawal.participant_code, session.participantCode);
  assert.ok(withdrawal.hard_deleted_at);
});

test('withdrawing destroys the credential, not just the data', async () => {
  const session = await consentedAdultSession();
  await post('/api/withdrawal/me', {}, { token: session.token });

  // The token row is deleted outright, so the browser is holding a string that
  // no longer resolves to anything. That is why this is 401 and not 410: there
  // is no session left to report as gone.
  const rows = getDb()
    .prepare(`SELECT COUNT(*) n FROM session_tokens WHERE session_id = ?`)
    .get(session.sessionId).n;
  assert.equal(rows, 0);

  const res = await post('/api/telemetry', { events: [{ type: 'x' }] }, { token: session.token });
  assert.equal(res.status, 401);
});

test('withdrawal by code answers identically for real and unknown codes', async () => {
  const session = await consentedAdultSession();
  const real = await post('/api/withdrawal/by-code', { participantCode: session.participantCode });
  const fake = await post('/api/withdrawal/by-code', { participantCode: 'P999999' });
  assert.equal(real.status, fake.status);
  assert.equal(real.body.withdrawn, fake.body.withdrawn);
});

// --- admin -----------------------------------------------------------------

async function adminToken(username = 'viti') {
  const password =
    username === 'viti' ? process.env.ADMIN_VITI_PASSWORD : process.env.ADMIN_SANKAR_PASSWORD;
  const res = await post('/api/admin/login', { username, password });
  assert.equal(res.status, 200);
  return res.body.token;
}

test('admin login rejects a wrong password and accepts the right one', async () => {
  assert.equal((await post('/api/admin/login', { username: 'viti', password: 'wrong' })).status, 401);
  assert.equal((await post('/api/admin/login', { username: 'nobody', password: 'wrong' })).status, 401);

  const res = await post('/api/admin/login', {
    username: 'viti',
    password: process.env.ADMIN_VITI_PASSWORD,
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.user.displayName, 'Viti Mehra');
});

test('admin routes reject a participant token', async () => {
  const session = await consentedAdultSession();
  const res = await get('/api/admin/stats', { token: session.token });
  assert.equal(res.status, 401);
});

test('admin stats and session list are readable', async () => {
  const token = await adminToken();
  const stats = await get('/api/admin/stats', { token });
  assert.equal(stats.status, 200);
  assert.ok(stats.body.sessions.total > 0);

  const list = await get('/api/admin/sessions?limit=10', { token });
  assert.equal(list.status, 200);
  assert.ok(Array.isArray(list.body.sessions));
});

test('the export excludes withdrawn participants entirely', async () => {
  const keep = await consentedAdultSession();
  await post('/api/demographics', { answers: { age: 29, city: 'Kolkata' } }, { token: keep.token });

  const drop = await consentedAdultSession();
  await post('/api/demographics', { answers: { age: 31, city: 'Jaipur' } }, { token: drop.token });
  await post('/api/withdrawal/me', {}, { token: drop.token });

  const token = await adminToken();
  const res = await get('/api/admin/export.json', { token });
  assert.equal(res.status, 200);

  const ids = res.body.data.sessions.map((s) => s.id);
  assert.ok(ids.includes(keep.sessionId), 'active participant missing from export');
  assert.ok(!ids.includes(drop.sessionId), 'withdrawn participant present in export');

  const demoSessions = res.body.data.demographics.map((d) => d.session_id);
  assert.ok(!demoSessions.includes(drop.sessionId));

  // The withdrawal itself is still recorded, which is the point of the stub.
  assert.ok(res.body.data.withdrawals.some((w) => w.session_id === drop.sessionId));
});

test('CSV export works per table and refuses an unknown one', async () => {
  const token = await adminToken();
  const csv = await get('/api/admin/export/sessions.csv', { token });
  assert.equal(csv.status, 200);
  assert.ok(csv.text.split('\r\n')[0].includes('participant_code'));

  const bad = await get('/api/admin/export/admin_users.csv', { token });
  assert.equal(bad.status, 400, 'admin credentials must not be exportable');
});

test('admin actions are written to the audit log with the actor named', async () => {
  const token = await adminToken('sankar');
  await get('/api/admin/export.json', { token });

  const res = await get('/api/admin/audit', { token });
  const entry = res.body.entries.find((e) => e.action === 'admin.export.json');
  assert.ok(entry);
  assert.equal(entry.actor_label, 'Sankar Balasubramanian');
});

test('a researcher-initiated withdrawal is audited after the data is gone', async () => {
  const victim = await consentedAdultSession();
  const token = await adminToken();

  const res = await post(
    `/api/admin/sessions/${victim.sessionId}/withdraw`,
    { reason: 'participant emailed us' },
    { token }
  );
  assert.equal(res.status, 200);

  const audit = await get('/api/admin/audit', { token });
  const entry = audit.body.entries.find(
    (e) => e.action === 'admin.session.withdraw' && e.target_id === victim.sessionId
  );
  assert.ok(entry, 'withdrawal was not audited');
  assert.match(entry.details_json, /participant emailed us/);
});

test('logging out revokes the admin token', async () => {
  const token = await adminToken();
  assert.equal((await post('/api/admin/logout', {}, { token })).status, 200);
  assert.equal((await get('/api/admin/stats', { token })).status, 401);
});
