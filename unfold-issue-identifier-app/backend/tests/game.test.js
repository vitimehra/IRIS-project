/**
 * Phases 2 to 5: the day board, the Saboteur, forced choice, extraction,
 * rating, the post-questionnaire and the debrief.
 *
 * The model is not called here. LLM_ENABLED is false, so extraction takes the
 * rule-based path — which is exactly the path a pilot or a demo runs on, and so
 * is worth testing directly. The model-response handling is covered by unit
 * tests over the parser and normaliser instead.
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TEST_DB = path.join(os.tmpdir(), `unfold-game-${Date.now()}-${process.pid}.sqlite`);

process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = TEST_DB;
process.env.IP_HASH_SALT = 'test-salt';
process.env.PUBLIC_APP_URL = 'http://localhost:5173';
process.env.LLM_ENABLED = 'false';
delete process.env.ANTHROPIC_API_KEY;

const { migrate } = await import('../src/db/migrate.js');
const { createApp } = await import('../src/app.js');
const { getDb, closeDb } = await import('../src/db/index.js');
const { newId } = await import('../src/services/ids.js');
const bcrypt = (await import('bcryptjs')).default;
const { parseModelJson, normaliseIssues, fallbackExtraction } = await import(
  '../src/services/extraction.js'
);
const { selectFoils } = await import('../src/content/foils.js');
const { selectStarterEpisodes, buildPairs, EMOTION_TOKENS } = await import('../src/content/game.js');

let server;
let base;

before(async () => {
  migrate();
  getDb()
    .prepare(
      `INSERT INTO admin_users (id, username, display_name, password_hash, role)
       VALUES (?, 'viti', 'Viti Mehra', ?, 'researcher')`
    )
    .run(newId(), bcrypt.hashSync('test-password-viti-1234', 4));

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
const put = (u, b, o) => api('PUT', u, { body: b, ...o });
const del = (u, o) => api('DELETE', u, o);

function allRequired(items) {
  return Object.fromEntries(items.filter((i) => i.required).map((i) => [i.key, true]));
}

/** A participant carried all the way to the start of the game. */
async function participantReadyToPlay(answers = {}) {
  const created = (await post('/api/sessions', { client: {} })).body;
  const token = created.token;

  await post('/api/sessions/me/age-gate', { age: 30 }, { token });
  const consentDoc = (await get('/api/consent/adult')).body;
  await post('/api/consent/adult', { responses: allRequired(consentDoc.items) }, { token });
  await post(
    '/api/demographics',
    {
      answers: {
        age: 30,
        employment_status: 'employed_full',
        work_arrangement: 'onsite',
        primary_transport: 'two_wheeler',
        commute_minutes_each_way: 40,
        household_size: 3,
        domestic_help: 'none',
        ...answers,
      },
    },
    { token }
  );

  return { ...created, token };
}

/** Plays a full day: episodes, tags, Saboteur, forced choice, complete. */
async function playFullGame(token, { negativeTokens = ['rushed', 'waiting'] } = {}) {
  const started = (await post('/api/game/start', { anchorIsTypical: true }, { token })).body;
  const episodes = started.episodes;

  // Tag the first three negatively and one positively, which is roughly what a
  // real participant does.
  for (const episode of episodes.slice(0, 3)) {
    await put(`/api/game/episodes/${episode.id}/tags`, { tokens: negativeTokens }, { token });
  }
  if (episodes[3]) {
    await put(`/api/game/episodes/${episodes[3].id}/tags`, { tokens: ['fine'] }, { token });
  }

  const plan = (await post('/api/game/saboteur/plan', {}, { token })).body;
  for (const round of plan.rounds) {
    await post(
      `/api/game/saboteur/${round.id}/responses`,
      {
        responses: [
          { text: 'Make the water heater take even longer to warm up', responseMs: 4200 },
          { text: 'Hide the keys somewhere different every morning', responseMs: 6100 },
        ],
      },
      { token }
    );
  }

  const pairs = (await post('/api/game/pairwise/plan', {}, { token })).body;
  for (const round of pairs.rounds) {
    await post(`/api/game/pairwise/${round.id}/choice`, { chosenSide: 'left', responseMs: 2100 }, { token });
  }

  await post('/api/game/complete', { durationMs: 540000 }, { token });
  return { episodes, saboteurRounds: plan.rounds, pairs: pairs.rounds };
}

async function adminToken() {
  const res = await post('/api/admin/login', {
    username: 'viti',
    password: 'test-password-viti-1234',
  });
  assert.equal(res.status, 200);
  return res.body.token;
}

// --- content ---------------------------------------------------------------

test('game content exposes the agreed ten emotion tokens', async () => {
  const res = await get('/api/game/content');
  assert.equal(res.status, 200);

  const keys = res.body.tokens.map((t) => t.key);
  assert.deepEqual(keys, [
    'rushed',
    'waiting',
    'stuck',
    'repeating',
    'cleaning_up',
    'interrupted',
    'confused',
    'put_off',
    'fine',
    'good',
  ]);
  assert.equal(res.body.tokens.filter((t) => t.negative).length, 8);
});

test('starter episodes adapt to the participant background', async () => {
  const remote = selectStarterEpisodes({
    work_arrangement: 'remote',
    primary_transport: 'rarely_travel',
    employment_status: 'employed_full',
  });
  assert.ok(!remote.some((e) => e.domain === 'commute'), 'remote worker offered a commute');

  const commuter = selectStarterEpisodes({
    work_arrangement: 'onsite',
    primary_transport: 'bus',
    employment_status: 'employed_full',
  });
  assert.ok(commuter.some((e) => e.domain === 'commute'));

  const parent = selectStarterEpisodes({ has_children: 1, employment_status: 'employed_full' });
  assert.ok(parent.some((e) => e.templateId === 'get_others_ready'));
});

test('starter set covers the whole day without overwhelming it', async () => {
  const episodes = selectStarterEpisodes({ employment_status: 'employed_full' });
  assert.ok(episodes.length >= 8 && episodes.length <= 12, `got ${episodes.length}`);
  const bands = new Set(episodes.map((e) => e.timeBand));
  assert.ok(bands.size >= 5, 'starter day does not span the day');
});

test('pair building is reproducible and bounded', async () => {
  const items = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, label: id }));
  const first = buildPairs(items, 8);
  const second = buildPairs(items, 8);
  assert.deepEqual(first, second, 'pairing is not reproducible');
  assert.ok(first.length <= 8);
  assert.equal(buildPairs([{ id: 'only' }], 8).length, 0);
});

// --- the day board ---------------------------------------------------------

test('starting the game seeds a day the participant can edit', async () => {
  const p = await participantReadyToPlay();
  const res = await post('/api/game/start', { anchorIsTypical: true }, { token: p.token });

  assert.equal(res.status, 201);
  assert.ok(res.body.episodes.length >= 8);
  assert.ok(res.body.game.anchorDayOfWeek);
  assert.ok(res.body.episodes.every((e) => e.source === 'template'));
});

test('starting twice resumes rather than duplicating the day', async () => {
  const p = await participantReadyToPlay();
  const first = (await post('/api/game/start', {}, { token: p.token })).body;
  const second = (await post('/api/game/start', {}, { token: p.token })).body;

  assert.equal(second.resumed, true);
  assert.equal(second.game.id, first.game.id);
  assert.equal(second.episodes.length, first.episodes.length);
});

test('the game cannot start before demographics are done', async () => {
  const created = (await post('/api/sessions', { client: {} })).body;
  await post('/api/sessions/me/age-gate', { age: 30 }, { token: created.token });
  const doc = (await get('/api/consent/adult')).body;
  await post('/api/consent/adult', { responses: allRequired(doc.items) }, { token: created.token });

  // Consented but no demographics: status is 'consented', which the game allows,
  // so push a session that has not even consented.
  const other = (await post('/api/sessions', { client: {} })).body;
  await post('/api/sessions/me/age-gate', { age: 30 }, { token: other.token });
  const res = await post('/api/game/start', {}, { token: other.token });
  assert.equal(res.status, 403);
});

test('a participant can add, edit and remove episodes', async () => {
  const p = await participantReadyToPlay();
  await post('/api/game/start', {}, { token: p.token });

  const added = await post(
    '/api/game/episodes',
    {
      label: 'Queueing at the chemist',
      description: 'Waiting for a prescription',
      timeBand: 'afternoon',
      domain: 'health',
    },
    { token: p.token }
  );
  assert.equal(added.status, 201);

  const mine = added.body.episodes.find((e) => e.label === 'Queueing at the chemist');
  assert.ok(mine);
  assert.equal(mine.source, 'participant');

  const edited = await api('PATCH', `/api/game/episodes/${mine.id}`, {
    body: { label: 'Waiting at the chemist' },
    token: p.token,
  });
  const renamed = edited.body.episodes.find((e) => e.id === mine.id);
  assert.equal(renamed.label, 'Waiting at the chemist');
  assert.equal(renamed.wasEdited, true);

  const removed = await del(`/api/game/episodes/${mine.id}`, { token: p.token });
  assert.ok(!removed.body.episodes.some((e) => e.id === mine.id));
});

test('an episode needs a name and a valid time band', async () => {
  const p = await participantReadyToPlay();
  await post('/api/game/start', {}, { token: p.token });

  assert.equal(
    (await post('/api/game/episodes', { label: '', timeBand: 'morning' }, { token: p.token })).status,
    400
  );
  assert.equal(
    (await post('/api/game/episodes', { label: 'Something', timeBand: 'teatime' }, { token: p.token }))
      .status,
    400
  );
});

test('tags replace rather than accumulate, and unknown tokens are refused', async () => {
  const p = await participantReadyToPlay();
  const started = (await post('/api/game/start', {}, { token: p.token })).body;
  const episode = started.episodes[0];

  await put(`/api/game/episodes/${episode.id}/tags`, { tokens: ['rushed', 'waiting'] }, { token: p.token });
  let state = (await get('/api/game/state', { token: p.token })).body;
  assert.deepEqual(state.episodes.find((e) => e.id === episode.id).tags.sort(), ['rushed', 'waiting']);

  await put(`/api/game/episodes/${episode.id}/tags`, { tokens: ['good'] }, { token: p.token });
  state = (await get('/api/game/state', { token: p.token })).body;
  assert.deepEqual(state.episodes.find((e) => e.id === episode.id).tags, ['good']);

  const bad = await put(
    `/api/game/episodes/${episode.id}/tags`,
    { tokens: ['furious'] },
    { token: p.token }
  );
  assert.equal(bad.status, 400);
});

test('negative and positive tokens are recorded distinctly', async () => {
  const p = await participantReadyToPlay();
  const started = (await post('/api/game/start', {}, { token: p.token })).body;

  await put(`/api/game/episodes/${started.episodes[0].id}/tags`, { tokens: ['stuck'] }, { token: p.token });
  await put(`/api/game/episodes/${started.episodes[1].id}/tags`, { tokens: ['good'] }, { token: p.token });

  const rows = getDb()
    .prepare(
      `SELECT token_key, is_negative FROM episode_tags WHERE episode_id IN (?, ?)`
    )
    .all(started.episodes[0].id, started.episodes[1].id);

  assert.equal(rows.find((r) => r.token_key === 'stuck').is_negative, 1);
  assert.equal(rows.find((r) => r.token_key === 'good').is_negative, 0);
});

// --- the Saboteur ----------------------------------------------------------

test('the Saboteur fires only at negatively tagged episodes', async () => {
  const p = await participantReadyToPlay();
  const started = (await post('/api/game/start', {}, { token: p.token })).body;

  await put(`/api/game/episodes/${started.episodes[0].id}/tags`, { tokens: ['stuck'] }, { token: p.token });
  await put(`/api/game/episodes/${started.episodes[1].id}/tags`, { tokens: ['good'] }, { token: p.token });

  const plan = await post('/api/game/saboteur/plan', {}, { token: p.token });
  assert.equal(plan.status, 201);
  assert.equal(plan.body.rounds.length, 1);
  assert.equal(plan.body.rounds[0].episodeId, started.episodes[0].id);
  // The prompt names the moment, so the participant is sabotaging their own day.
  assert.match(plan.body.rounds[0].promptText, new RegExp(started.episodes[0].label));
});

test('the Saboteur is capped so it cannot eat the time budget', async () => {
  const p = await participantReadyToPlay();
  const started = (await post('/api/game/start', {}, { token: p.token })).body;
  for (const episode of started.episodes) {
    await put(`/api/game/episodes/${episode.id}/tags`, { tokens: ['rushed'] }, { token: p.token });
  }

  const plan = (await post('/api/game/saboteur/plan', {}, { token: p.token })).body;
  assert.ok(plan.rounds.length <= 5, `got ${plan.rounds.length} rounds`);
});

test('Saboteur responses save with their latency, and replace on resubmit', async () => {
  const p = await participantReadyToPlay();
  const started = (await post('/api/game/start', {}, { token: p.token })).body;
  await put(`/api/game/episodes/${started.episodes[0].id}/tags`, { tokens: ['rushed'] }, { token: p.token });
  const plan = (await post('/api/game/saboteur/plan', {}, { token: p.token })).body;
  const round = plan.rounds[0];

  await post(
    `/api/game/saboteur/${round.id}/responses`,
    { responses: [{ text: 'Move the switch somewhere else', responseMs: 3400 }] },
    { token: p.token }
  );
  await post(
    `/api/game/saboteur/${round.id}/responses`,
    {
      responses: [
        { text: 'Move the switch somewhere else', responseMs: 3400 },
        { text: 'Make it beep once and stop', responseMs: 5200 },
      ],
    },
    { token: p.token }
  );

  const rows = getDb()
    .prepare(`SELECT * FROM saboteur_responses WHERE saboteur_round_id = ? ORDER BY ordinal`)
    .all(round.id);
  assert.equal(rows.length, 2, 'responses accumulated instead of replacing');
  assert.equal(rows[0].response_ms, 3400);
});

test('a skipped Saboteur round is recorded as skipped', async () => {
  const p = await participantReadyToPlay();
  const started = (await post('/api/game/start', {}, { token: p.token })).body;
  await put(`/api/game/episodes/${started.episodes[0].id}/tags`, { tokens: ['rushed'] }, { token: p.token });
  const plan = (await post('/api/game/saboteur/plan', {}, { token: p.token })).body;

  await post(
    `/api/game/saboteur/${plan.rounds[0].id}/responses`,
    { responses: [], skipped: true },
    { token: p.token }
  );

  const row = getDb().prepare(`SELECT * FROM saboteur_rounds WHERE id = ?`).get(plan.rounds[0].id);
  assert.equal(row.skipped, 1);
  assert.ok(row.ended_at);
});

// --- forced choice ---------------------------------------------------------

test('forced choice pairs only negatively tagged episodes, and records the choice', async () => {
  const p = await participantReadyToPlay();
  const started = (await post('/api/game/start', {}, { token: p.token })).body;
  for (const episode of started.episodes.slice(0, 4)) {
    await put(`/api/game/episodes/${episode.id}/tags`, { tokens: ['waiting'] }, { token: p.token });
  }

  const plan = (await post('/api/game/pairwise/plan', {}, { token: p.token })).body;
  assert.ok(plan.rounds.length > 0);

  const negativeIds = new Set(started.episodes.slice(0, 4).map((e) => e.id));
  for (const round of plan.rounds) {
    assert.ok(negativeIds.has(round.left.id) && negativeIds.has(round.right.id));
    assert.notEqual(round.left.id, round.right.id);
  }

  await post(`/api/game/pairwise/${plan.rounds[0].id}/choice`, { chosenSide: 'right', responseMs: 1800 }, { token: p.token });
  const row = getDb().prepare(`SELECT * FROM pairwise_rounds WHERE id = ?`).get(plan.rounds[0].id);
  assert.equal(row.chosen_side, 'right');
  assert.equal(row.response_ms, 1800);

  const bad = await post(
    `/api/game/pairwise/${plan.rounds[0].id}/choice`,
    { chosenSide: 'maybe' },
    { token: p.token }
  );
  assert.equal(bad.status, 400);
});

// --- extraction ------------------------------------------------------------

test('completing the game moves the participant to rating', async () => {
  const p = await participantReadyToPlay();
  await playFullGame(p.token);

  const session = (await get('/api/sessions/me', { token: p.token })).body.session;
  assert.equal(session.status, 'game_done');
  assert.equal(session.stage, 'rating');
});

test('extraction cannot run before the game is finished', async () => {
  const p = await participantReadyToPlay();
  await post('/api/game/start', {}, { token: p.token });
  const res = await post('/api/issues/extract', {}, { token: p.token });
  assert.equal(res.status, 403);
});

test('extraction falls back cleanly with no API key, and says so in the run', async () => {
  const p = await participantReadyToPlay();
  await playFullGame(p.token);

  const res = await post('/api/issues/extract', {}, { token: p.token });
  assert.equal(res.status, 201);
  assert.equal(res.body.extraction.status, 'fallback');
  assert.ok(res.body.issues.length > 0);

  const run = getDb()
    .prepare(`SELECT * FROM extraction_runs WHERE session_id = ?`)
    .get(p.sessionId);
  assert.equal(run.status, 'fallback');
  assert.equal(run.model, 'rule-based');
  assert.match(run.error_message, /LLM_ENABLED is false|No ANTHROPIC_API_KEY/);
  // The prompt that would have been sent is stored even on the fallback path,
  // so a pilot run is still auditable.
  assert.match(run.request_json, /CAE format/);
});

test('every stored issue has all three CAE slots filled and stamped', async () => {
  const p = await participantReadyToPlay();
  await playFullGame(p.token);
  await post('/api/issues/extract', {}, { token: p.token });

  const rows = getDb().prepare(`SELECT * FROM issues WHERE session_id = ?`).all(p.sessionId);
  assert.ok(rows.length > 0);

  for (const row of rows) {
    assert.ok(row.cause && row.cause.trim(), 'empty cause');
    assert.ok(row.affect && row.affect.trim(), 'empty affect');
    assert.ok(row.effect && row.effect.trim(), 'empty effect');
    for (const slot of ['cause_provenance', 'affect_provenance', 'effect_provenance']) {
      assert.ok(['participant', 'inferred'].includes(row[slot]), `bad ${slot}: ${row[slot]}`);
    }
  }
});

test('Saboteur answers become participant-grounded causes', async () => {
  const p = await participantReadyToPlay();
  await playFullGame(p.token);
  await post('/api/issues/extract', {}, { token: p.token });

  const grounded = getDb()
    .prepare(
      `SELECT * FROM issues WHERE session_id = ? AND cause_provenance = 'participant'`
    )
    .all(p.sessionId);

  assert.ok(grounded.length > 0, 'no participant-grounded causes from the Saboteur');
  assert.ok(grounded.some((r) => /water heater|keys/i.test(r.cause)));

  // The answer is an imperative about a hypothetical worsening. It must be
  // framed as evidence rather than dropped into the Cause slot raw, or the
  // participant is shown an instruction and asked how severe it is.
  for (const row of grounded) {
    assert.match(row.cause, /^asked what would make .+ worse, the participant immediately reached for: /);
    assert.doesNotMatch(row.headline, /^Make |^Hide |^Add /);
  }
});

test('re-running extraction replaces the deck instead of duplicating it', async () => {
  const p = await participantReadyToPlay();
  await playFullGame(p.token);

  const first = (await post('/api/issues/extract', {}, { token: p.token })).body;
  const reused = (await post('/api/issues/extract', {}, { token: p.token })).body;
  assert.equal(reused.reused, true);
  assert.equal(reused.issues.length, first.issues.length);

  await post('/api/issues/extract', { force: true }, { token: p.token });
  const runs = getDb()
    .prepare(`SELECT COUNT(*) n FROM extraction_runs WHERE session_id = ?`)
    .get(p.sessionId).n;
  const decks = getDb()
    .prepare(`SELECT COUNT(*) n FROM issues WHERE session_id = ? AND shown_to_participant = 1`)
    .get(p.sessionId).n;

  assert.equal(runs, 2, 'forced re-run did not record a second run');
  assert.ok(decks <= 21, `deck grew to ${decks} after a re-run`);
});

// --- foils -----------------------------------------------------------------

test('three foils are seeded, from domains the day did not cover', async () => {
  const p = await participantReadyToPlay();
  await playFullGame(p.token);
  await post('/api/issues/extract', {}, { token: p.token });

  const foils = getDb()
    .prepare(`SELECT * FROM issues WHERE session_id = ? AND is_foil = 1`)
    .all(p.sessionId);
  assert.equal(foils.length, 3);
  assert.ok(foils.every((f) => f.foil_family));

  const realDomains = new Set(
    getDb()
      .prepare(
        `SELECT DISTINCT domain FROM issues WHERE session_id = ? AND is_foil = 0 AND shown_to_participant = 1`
      )
      .all(p.sessionId)
      .map((r) => r.domain)
      .filter(Boolean)
  );
  for (const foil of foils) {
    assert.ok(!realDomains.has(foil.domain), `foil overlaps a real domain: ${foil.domain}`);
  }
});

test('foils are spread through the deck rather than blocked at the end', async () => {
  const p = await participantReadyToPlay();
  await playFullGame(p.token);
  await post('/api/issues/extract', {}, { token: p.token });

  const deck = getDb()
    .prepare(
      `SELECT is_foil, display_rank FROM issues
       WHERE session_id = ? AND shown_to_participant = 1 ORDER BY display_rank`
    )
    .all(p.sessionId);

  const foilPositions = deck.map((d, i) => (d.is_foil ? i : -1)).filter((i) => i >= 0);
  assert.equal(foilPositions.length, 3);
  // If they were appended, all three would sit in the final three slots.
  const tailStart = deck.length - 3;
  assert.ok(
    !foilPositions.every((pos) => pos >= tailStart),
    `foils are bunched at the end: ${foilPositions.join(',')} of ${deck.length}`
  );
});

test('the rating deck never tells the browser which cards are foils', async () => {
  const p = await participantReadyToPlay();
  await playFullGame(p.token);
  await post('/api/issues/extract', {}, { token: p.token });

  const res = await get('/api/issues/mine', { token: p.token });
  assert.equal(res.status, 200);
  assert.ok(res.body.issues.length > 0);
  assert.doesNotMatch(res.text, /is_foil|foil_family|isFoil/);
});

test('foil selection avoids domains already used', async () => {
  const picked = selectFoils(['morning_routine', 'commute', 'food'], 3);
  assert.equal(picked.length, 3);
  for (const foil of picked) {
    assert.ok(!['morning_routine', 'commute', 'food'].includes(foil.domain));
  }
  // Even when every domain is used, the design still calls for three.
  const allDomains = [...new Set(['morning_routine', 'commute', 'food', 'work_study', 'devices', 'admin', 'chores', 'evening_sleep', 'health', 'money_shopping'])];
  assert.equal(selectFoils(allDomains, 3).length, 3);
});

// --- rating ----------------------------------------------------------------

test('ratings save, update in place, and reject invalid severity', async () => {
  const p = await participantReadyToPlay();
  await playFullGame(p.token);
  const deck = (await post('/api/issues/extract', {}, { token: p.token })).body.issues;

  const first = deck[0];
  assert.equal(
    (await post(`/api/issues/${first.id}/rating`, { severity: 4, recognised: true, responseMs: 3300 }, { token: p.token }))
      .status,
    200
  );
  assert.equal(
    (await post(`/api/issues/${first.id}/rating`, { severity: 2, recognised: true }, { token: p.token })).status,
    200
  );

  const rows = getDb().prepare(`SELECT * FROM issue_ratings WHERE issue_id = ?`).all(first.id);
  assert.equal(rows.length, 1, 'rating duplicated instead of updating');
  assert.equal(rows[0].severity, 2);

  assert.equal(
    (await post(`/api/issues/${first.id}/rating`, { severity: 9 }, { token: p.token })).status,
    400
  );
  assert.equal(
    (await post(`/api/issues/${first.id}/rating`, { severity: 2.5 }, { token: p.token })).status,
    400
  );
});

test('a rejected issue stores no severity', async () => {
  const p = await participantReadyToPlay();
  await playFullGame(p.token);
  const deck = (await post('/api/issues/extract', {}, { token: p.token })).body.issues;

  await post(
    `/api/issues/${deck[0].id}/rating`,
    { rejected: true, recognised: false, editNote: 'Not something I run into' },
    { token: p.token }
  );

  const row = getDb().prepare(`SELECT * FROM issue_ratings WHERE issue_id = ?`).get(deck[0].id);
  assert.equal(row.rejected, 1);
  assert.equal(row.severity, null);
  assert.equal(row.edit_note, 'Not something I run into');
});

test('a participant can correct the wording of an issue', async () => {
  const p = await participantReadyToPlay();
  await playFullGame(p.token);
  const deck = (await post('/api/issues/extract', {}, { token: p.token })).body.issues;

  await post(
    `/api/issues/${deck[0].id}/rating`,
    {
      severity: 5,
      editedHeadline: 'The geyser takes twelve minutes to heat',
      editedCause: 'the geyser needs twelve minutes before there is hot water',
      editedAffect: 'I feel stuck waiting with nothing useful to do',
      editedEffect: 'the whole morning shifts later and I leave in a rush',
    },
    { token: p.token }
  );

  const row = getDb().prepare(`SELECT * FROM issue_ratings WHERE issue_id = ?`).get(deck[0].id);
  assert.match(row.edited_headline, /twelve minutes/);
  assert.match(row.edited_effect, /leave in a rush/);
  // The original text is untouched, so you can compare what was offered against
  // what the participant actually meant.
  const original = getDb().prepare(`SELECT * FROM issues WHERE id = ?`).get(deck[0].id);
  assert.notEqual(original.headline, row.edited_headline);
});

test('ratings cannot be written against another participant deck', async () => {
  const a = await participantReadyToPlay();
  await playFullGame(a.token);
  const deck = (await post('/api/issues/extract', {}, { token: a.token })).body.issues;

  const b = await participantReadyToPlay();
  const res = await post(`/api/issues/${deck[0].id}/rating`, { severity: 5 }, { token: b.token });
  assert.equal(res.status, 400);
});

test('a batch of ratings saves in one call', async () => {
  const p = await participantReadyToPlay();
  await playFullGame(p.token);
  const deck = (await post('/api/issues/extract', {}, { token: p.token })).body.issues;

  const res = await post(
    '/api/issues/ratings',
    { ratings: deck.slice(0, 5).map((i, n) => ({ issueId: i.id, severity: (n % 5) + 1 })) },
    { token: p.token }
  );
  assert.equal(res.body.saved, 5);
  assert.equal(res.body.errors.length, 0);
});

// --- questionnaire and debrief --------------------------------------------

test('the post-questionnaire enforces only its required items', async () => {
  const p = await participantReadyToPlay();
  await playFullGame(p.token);
  await post('/api/issues/extract', {}, { token: p.token });
  await post('/api/issues/ratings/complete', {}, { token: p.token });

  const schema = (await get('/api/issues/questionnaire/schema')).body;
  assert.ok(schema.questions.length >= 6);

  const missing = await post('/api/issues/questionnaire', { answers: {} }, { token: p.token });
  assert.equal(missing.status, 400);
  assert.ok(missing.body.error.details.missing.includes('would_not_have_recalled'));

  const required = Object.fromEntries(
    schema.questions.filter((q) => q.required).map((q) => [q.key, '4'])
  );
  const ok = await post(
    '/api/issues/questionnaire',
    { answers: { ...required, missed_something: 'The lift is always busy' } },
    { token: p.token }
  );
  assert.equal(ok.status, 201);
  assert.equal(ok.body.session.stage, 'debrief');
});

test('the questionnaire stores the wording shown alongside each answer', async () => {
  const p = await participantReadyToPlay();
  await playFullGame(p.token);
  await post('/api/issues/extract', {}, { token: p.token });
  await post('/api/issues/ratings/complete', {}, { token: p.token });

  const schema = (await get('/api/issues/questionnaire/schema')).body;
  const required = Object.fromEntries(
    schema.questions.filter((q) => q.required).map((q) => [q.key, '5'])
  );
  await post('/api/issues/questionnaire', { answers: required }, { token: p.token });

  const row = getDb()
    .prepare(
      `SELECT * FROM post_questionnaire_responses WHERE session_id = ? AND question_key = 'would_not_have_recalled'`
    )
    .get(p.sessionId);
  assert.match(row.question_text, /would not have thought of/i);
  assert.equal(row.response_value, '5');
});

test('the debrief is refused until rating is complete', async () => {
  const p = await participantReadyToPlay();
  await playFullGame(p.token);
  await post('/api/issues/extract', {}, { token: p.token });

  const early = await get('/api/issues/debrief', { token: p.token });
  assert.equal(early.status, 403);
});

test('the debrief shows the day, the issues, and names the foils', async () => {
  const p = await participantReadyToPlay();
  await playFullGame(p.token);
  const deck = (await post('/api/issues/extract', {}, { token: p.token })).body.issues;
  for (const issue of deck) {
    await post(`/api/issues/${issue.id}/rating`, { severity: 3 }, { token: p.token });
  }
  await post('/api/issues/ratings/complete', {}, { token: p.token });

  const res = await get('/api/issues/debrief', { token: p.token });
  assert.equal(res.status, 200);

  assert.ok(res.body.day.episodes.length > 0, 'debrief did not return the reconstructed day');
  assert.ok(res.body.issues.length > 0);
  assert.equal(res.body.foils.length, 3);
  assert.ok(res.body.foils.every((f) => f.foil_family));
  assert.equal(res.body.participantCode, p.participantCode);
});

test('viewing the debrief completes the session and records the total duration', async () => {
  const p = await participantReadyToPlay();
  await playFullGame(p.token);
  const deck = (await post('/api/issues/extract', {}, { token: p.token })).body.issues;
  await post(
    '/api/issues/ratings',
    { ratings: deck.map((i) => ({ issueId: i.id, severity: 3 })) },
    { token: p.token }
  );
  await post('/api/issues/ratings/complete', {}, { token: p.token });

  const res = await post(
    '/api/issues/debrief/viewed',
    { foilsRevealed: true, dayShown: true, durationMs: 42000 },
    { token: p.token }
  );
  assert.equal(res.body.completed, true);

  const session = getDb().prepare(`SELECT * FROM sessions WHERE id = ?`).get(p.sessionId);
  assert.equal(session.status, 'completed');
  assert.equal(session.stage, 'complete');
  assert.ok(session.completed_at);
  assert.ok(session.total_duration_ms >= 0);
});

// --- model response handling (unit) ---------------------------------------

test('model JSON survives fences and surrounding prose', async () => {
  const shape = '{"issues":[{"headline":"h","cause":"c","affect":"a","effect":"e"}]}';
  assert.ok(parseModelJson(shape));
  assert.ok(parseModelJson('```json\n' + shape + '\n```'));
  assert.ok(parseModelJson('Here you go:\n' + shape + '\nHope that helps.'));
  assert.equal(parseModelJson('not json at all'), null);
  assert.equal(parseModelJson(''), null);
});

test('normalising fills empty slots and forces their provenance to inferred', async () => {
  const [issue] = normaliseIssues({
    issues: [
      {
        headline: 'The geyser takes twelve minutes',
        cause: 'the geyser takes twelve minutes to heat',
        cause_provenance: 'participant',
        affect: '',
        effect: null,
        domain: 'morning_routine',
        time_band: 'dawn',
        confidence: 0.8,
      },
    ],
  });

  assert.equal(issue.cause_provenance, 'participant');
  assert.ok(issue.affect.length > 0);
  assert.equal(issue.affect_provenance, 'inferred');
  assert.ok(issue.effect.length > 0);
  assert.equal(issue.effect_provenance, 'inferred');
  assert.equal(issue.confidence, 0.8);
});

test('normalising rejects invented domains, bands, episode ids and confidences', async () => {
  const [issue] = normaliseIssues(
    {
      issues: [
        {
          headline: 'h',
          cause: 'c',
          affect: 'a',
          effect: 'e',
          domain: 'astrology',
          time_band: 'teatime',
          source_episode_id: 'not-a-real-episode',
          confidence: 7,
          cause_provenance: 'guessed',
        },
      ],
    },
    { episodeIds: new Set(['real-episode']) }
  );

  assert.equal(issue.domain, null);
  assert.equal(issue.time_band, null);
  assert.equal(issue.source_episode_id, null);
  assert.equal(issue.confidence, 0.5);
  assert.equal(issue.cause_provenance, 'inferred');
});

test('normalising drops entries with nothing to show', async () => {
  const issues = normaliseIssues({
    issues: [null, {}, { affect: 'only an affect' }, { headline: 'keep me', cause: 'because' }],
  });
  assert.equal(issues.length, 1);
  assert.equal(issues[0].headline, 'keep me');
});

test('the fallback produces valid CAE from tags and Saboteur answers', async () => {
  const issues = fallbackExtraction({
    episodes: [
      {
        id: 'e1',
        label: 'Morning shower',
        domain: 'morning_routine',
        time_band: 'dawn',
        tags: [{ token_key: 'waiting' }, { token_key: 'good' }],
      },
    ],
    saboteur: [
      {
        episode_id: 'e1',
        responses: [{ response_text: 'Cut the hot water halfway through' }],
      },
    ],
  });

  // 'good' is not a friction token, so it contributes nothing.
  assert.equal(issues.length, 2);
  assert.ok(issues.every((i) => i.cause && i.affect && i.effect));
  const fromSaboteur = issues.find((i) => i.cause_provenance === 'participant');
  assert.match(fromSaboteur.cause, /hot water/);
  // Reframed, not copied: the raw answer survives only in the evidence field.
  assert.match(fromSaboteur.cause, /reached for/);
  assert.equal(fromSaboteur.source_evidence, 'Cut the hot water halfway through');
});

// --- analysis --------------------------------------------------------------

test('the analysis endpoint reports the foil check and friction breakdown', async () => {
  const p = await participantReadyToPlay();
  await playFullGame(p.token);
  const deck = (await post('/api/issues/extract', {}, { token: p.token })).body.issues;
  await post(
    '/api/issues/ratings',
    { ratings: deck.map((i) => ({ issueId: i.id, severity: 4 })) },
    { token: p.token }
  );

  const token = await adminToken();
  const res = await get('/api/admin/analysis', { token });
  assert.equal(res.status, 200);

  assert.ok(res.body.foils.summary.sessionsRated > 0);
  assert.ok(Array.isArray(res.body.friction.byDomain));
  assert.ok(Array.isArray(res.body.friction.byToken));
  assert.ok(res.body.provenance.total > 0);
  assert.ok(Array.isArray(res.body.extraction.byStatus));
  assert.ok(res.body.completion.byStage.length > 0);
});

test('a participant who rates foils as highly as real issues is flagged', async () => {
  const p = await participantReadyToPlay();
  await playFullGame(p.token);
  const deck = (await post('/api/issues/extract', {}, { token: p.token })).body.issues;

  // Uniform 5s across the whole deck: the textbook yea-sayer.
  await post(
    '/api/issues/ratings',
    { ratings: deck.map((i) => ({ issueId: i.id, severity: 5 })) },
    { token: p.token }
  );

  const token = await adminToken();
  const analysis = (await get('/api/admin/analysis', { token })).body;
  const row = analysis.foils.perSession.find((r) => r.participantCode === p.participantCode);

  assert.ok(row, 'participant missing from the foil analysis');
  assert.equal(row.gap, 0);
  assert.equal(row.flagged, true);
});

test('the admin issue list can include or exclude foils', async () => {
  const token = await adminToken();

  const without = (await get('/api/admin/issues?limit=500', { token })).body;
  assert.ok(without.issues.length > 0);
  assert.ok(without.issues.every((i) => i.is_foil === 0));

  const withFoils = (await get('/api/admin/issues?limit=500&foils=true', { token })).body;
  assert.ok(withFoils.issues.some((i) => i.is_foil === 1));
});

test('the full export carries the game, issues and ratings', async () => {
  const token = await adminToken();
  const res = await get('/api/admin/export.json', { token });
  assert.equal(res.status, 200);

  for (const table of [
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
  ]) {
    assert.ok(res.body.data[table], `${table} missing from export`);
    assert.ok(res.body.data[table].length > 0, `${table} is empty in the export`);
  }

  // The CAE columns and their provenance stamps must reach the export, since
  // that is what the analysis is actually done on.
  const issue = res.body.data.issues[0];
  for (const column of [
    'cause',
    'cause_provenance',
    'affect',
    'affect_provenance',
    'effect',
    'effect_provenance',
    'is_foil',
    'confidence',
  ]) {
    assert.ok(column in issue, `issues.${column} missing from export`);
  }
});

test('a withdrawn participant disappears from the game tables too', async () => {
  const p = await participantReadyToPlay();
  await playFullGame(p.token);
  await post('/api/issues/extract', {}, { token: p.token });
  await post('/api/withdrawal/me', {}, { token: p.token });

  const db = getDb();
  const gameId = db.prepare(`SELECT id FROM game_sessions WHERE session_id = ?`).get(p.sessionId);
  assert.equal(gameId, undefined);
  assert.equal(
    db.prepare(`SELECT COUNT(*) n FROM issues WHERE session_id = ?`).get(p.sessionId).n,
    0
  );

  const token = await adminToken();
  const exported = (await get('/api/admin/export.json', { token })).body;
  assert.ok(!exported.data.sessions.some((s) => s.id === p.sessionId));
  assert.ok(!exported.data.episodes.some((e) => e.game_session_id === gameId));
});
