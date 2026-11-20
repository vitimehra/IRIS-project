/**
 * Render tests for the game, rating, questionnaire and debrief screens.
 *
 * These check what the participant actually sees and can do — particularly the
 * two places where the design has a claim to defend: that rejecting an issue is
 * no harder than accepting it, and that nothing on the client reveals which
 * cards are foils.
 */
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import globalJsdom from 'global-jsdom';

let cleanupDom;
let render;
let screen;
let waitFor;
let cleanup;
let act;
let fireEvent;
let MemoryRouter;
let SessionProvider;

// --- mocked backend --------------------------------------------------------

const TOKENS = [
  { key: 'rushed', label: 'Rushed', negative: true, hint: 'Not enough time for it' },
  { key: 'waiting', label: 'Waiting', negative: true, hint: 'Stuck waiting' },
  { key: 'stuck', label: 'Stuck', negative: true, hint: 'Could not get it to work' },
  { key: 'fine', label: 'Fine', negative: false, hint: 'Went as expected' },
  { key: 'good', label: 'Good', negative: false, hint: 'Actually enjoyed it' },
];

const TIME_BANDS = [
  { key: 'dawn', label: 'Early morning', window: '5am – 7am' },
  { key: 'morning', label: 'Morning', window: '7am – 11am' },
  { key: 'evening', label: 'Evening', window: '6pm – 10pm' },
];

const GAME_CONTENT = {
  version: '1.0.0',
  tokens: TOKENS,
  timeBands: TIME_BANDS,
  domains: [
    { key: 'morning_routine', label: 'Getting ready' },
    { key: 'food', label: 'Food and cooking' },
  ],
  templates: [
    {
      id: 'breakfast',
      timeBand: 'morning',
      domain: 'food',
      label: 'Breakfast',
      description: 'Making it',
    },
  ],
  limits: { saboteurRounds: 5, saboteurResponses: 3, pairwiseRounds: 8 },
};

let episodes = [];

function makeEpisodes() {
  return [
    {
      id: 'ep1',
      ordinal: 0,
      timeBand: 'dawn',
      domain: 'morning_routine',
      label: 'Waking up',
      description: 'Getting out of bed',
      source: 'template',
      tags: [],
    },
    {
      id: 'ep2',
      ordinal: 1,
      timeBand: 'morning',
      domain: 'food',
      label: 'Breakfast',
      description: 'Making it',
      source: 'template',
      tags: [],
    },
    {
      id: 'ep3',
      ordinal: 2,
      timeBand: 'evening',
      domain: 'food',
      label: 'Dinner',
      description: 'Cooking it',
      source: 'template',
      tags: [],
    },
  ];
}

const ISSUES = [
  {
    id: 'i1',
    headline: 'The geyser takes twelve minutes to heat',
    cause: 'the geyser takes about twelve minutes to heat water',
    affect: 'the participant feels impatient and stuck',
    effect: 'the morning routine is pushed back and they leave rushed',
    domain: 'morning_routine',
    time_band: 'dawn',
    display_rank: 0,
  },
  {
    id: 'i2',
    headline: 'Deciding what to cook takes longer than cooking',
    cause: 'there is no plan for what to cook in the evening',
    affect: 'the participant feels drained by the decision',
    effect: 'dinner starts later than intended',
    domain: 'food',
    time_band: 'evening',
    display_rank: 1,
  },
];

const QUESTIONNAIRE = {
  version: '1.0.0',
  questions: [
    {
      key: 'recognised_own_day',
      type: 'scale',
      text: 'The day I rebuilt felt like an accurate picture of yesterday.',
      options: [
        { value: '1', label: 'Strongly disagree' },
        { value: '5', label: 'Strongly agree' },
      ],
      required: true,
    },
    {
      key: 'missed_something',
      type: 'text',
      text: 'Is there anything that bothered you yesterday that we did not pick up?',
      required: false,
      maxLength: 1000,
    },
  ],
};

const DEBRIEF = {
  participantCode: 'P042',
  day: {
    anchorDayOfWeek: 'Tuesday',
    episodes: [
      { id: 'ep1', timeBand: 'dawn', label: 'Waking up', domain: 'morning_routine', tags: ['rushed'] },
      { id: 'ep3', timeBand: 'evening', label: 'Dinner', domain: 'food', tags: ['stuck'] },
    ],
  },
  issues: [
    { id: 'i1', headline: 'The geyser takes twelve minutes to heat', severity: 4, rejected: 0 },
    { id: 'i2', headline: 'Deciding what to cook', severity: null, rejected: 1 },
  ],
  foils: [
    { id: 'f1', headline: 'The water pressure drops in the evening', foil_family: 'water_pressure', severity: null, rejected: 1 },
    { id: 'f2', headline: 'The lift is out on alternate days', foil_family: 'lift_alternate', severity: 2, rejected: 0 },
    { id: 'f3', headline: 'A bill reminder arrives late', foil_family: 'bill_reminder', severity: null, rejected: 1 },
  ],
};

let routeState = {};
let calls = [];

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function installFetchMock() {
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const method = (init.method || 'GET').toUpperCase();
    const path = url.replace(/^https?:\/\/[^/]+/, '');
    const key = `${method} ${path}`;
    calls.push({ key, body: init.body ? JSON.parse(init.body) : null });

    if (routeState[key]) return routeState[key](init);

    if (path === '/api/study-info') {
      return jsonResponse({
        contacts: { researchers: [{ name: 'Viti Mehra', email: '[REPLACE]' }], ethicsContact: {} },
        ageRange: { min: 15, max: 50 },
      });
    }
    if (path === '/api/sessions/me') {
      return jsonResponse({
        session: {
          sessionId: 's1',
          participantCode: 'P042',
          status: 'demographics_done',
          stage: 'game',
          isMinor: false,
        },
      });
    }
    if (path === '/api/game/content') return jsonResponse(GAME_CONTENT);
    if (path === '/api/game/state') return jsonResponse({ game: null, episodes: [] });
    if (path === '/api/game/start' && method === 'POST') {
      episodes = makeEpisodes();
      return jsonResponse(
        { game: { id: 'g1', anchorDayOfWeek: 'Tuesday' }, episodes, resumed: false },
        201
      );
    }
    if (path.match(/^\/api\/game\/episodes\/[^/]+\/tags$/) && method === 'PUT') {
      const id = path.split('/')[4];
      const tokens = JSON.parse(init.body).tokens;
      episodes = episodes.map((e) => (e.id === id ? { ...e, tags: tokens } : e));
      return jsonResponse({ episodes });
    }
    if (path.match(/^\/api\/game\/episodes\/[^/]+$/) && method === 'DELETE') {
      const id = path.split('/').pop();
      episodes = episodes.filter((e) => e.id !== id);
      return jsonResponse({ episodes });
    }
    if (path === '/api/game/episodes' && method === 'POST') {
      const body = JSON.parse(init.body);
      episodes = [
        ...episodes,
        { id: `new-${episodes.length}`, ...body, source: 'participant', tags: [], ordinal: episodes.length },
      ];
      return jsonResponse({ episodes }, 201);
    }
    if (path === '/api/game/saboteur/plan') {
      return jsonResponse(
        {
          rounds: [
            { id: 'r1', episodeId: 'ep1', promptText: 'You are back at "Waking up". Your job is to ruin it.', ordinal: 0 },
          ],
        },
        201
      );
    }
    if (path.match(/^\/api\/game\/saboteur\/[^/]+\/responses$/)) return jsonResponse({ saved: true }, 201);
    if (path === '/api/game/pairwise/plan') {
      return jsonResponse(
        {
          rounds: [
            {
              id: 'p1',
              ordinal: 0,
              left: { id: 'ep1', text: 'Waking up' },
              right: { id: 'ep3', text: 'Dinner' },
              chosenSide: null,
            },
          ],
        },
        201
      );
    }
    if (path.match(/^\/api\/game\/pairwise\/[^/]+\/choice$/)) return jsonResponse({ saved: true });
    if (path === '/api/game/complete') {
      return jsonResponse({ session: { sessionId: 's1', status: 'game_done', stage: 'rating' } });
    }
    if (path === '/api/issues/extract') {
      return jsonResponse({ issues: ISSUES, extraction: { status: 'fallback' }, reused: false }, 201);
    }
    if (path.match(/^\/api\/issues\/[^/]+\/rating$/)) return jsonResponse({ saved: true });
    if (path === '/api/issues/ratings/complete') {
      return jsonResponse({ session: { sessionId: 's1', status: 'rated', stage: 'post_questionnaire' } });
    }
    if (path === '/api/issues/questionnaire/schema') return jsonResponse(QUESTIONNAIRE);
    if (path === '/api/issues/questionnaire') {
      return jsonResponse({ session: { sessionId: 's1', stage: 'debrief' } }, 201);
    }
    if (path === '/api/issues/debrief') return jsonResponse(DEBRIEF);
    if (path === '/api/issues/debrief/viewed') return jsonResponse({ completed: true, participantCode: 'P042' });
    if (path === '/api/telemetry') return jsonResponse({ accepted: 0 });

    return jsonResponse({ error: { code: 'not_found', message: `unmocked ${key}` } }, 404);
  };
}

// --- setup -----------------------------------------------------------------

before(async () => {
  cleanupDom = globalJsdom('<!doctype html><html><body></body></html>', {
    url: 'http://localhost:5173/',
    pretendToBeVisual: true,
  });
  installFetchMock();
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;

  ({ render, screen, waitFor, cleanup, act, fireEvent } = await import('@testing-library/react'));
  ({ MemoryRouter } = await import('react-router-dom'));
  ({ SessionProvider } = await import('../src/state/SessionContext.jsx'));

  try {
    localStorage.setItem('unfold.session.token', 'tok-1');
  } catch {
    /* ignore */
  }
});

beforeEach(() => {
  cleanup?.();
  routeState = {};
  calls = [];
  episodes = makeEpisodes();
});

after(() => {
  cleanup?.();
  cleanupDom?.();
  process.exit(process.exitCode || 0);
});

async function mount(element, { path = '/' } = {}) {
  const result = render(
    <MemoryRouter initialEntries={[path]}>
      <SessionProvider>{element}</SessionProvider>
    </MemoryRouter>
  );
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  return result;
}

const click = async (el) => {
  await act(async () => {
    fireEvent.click(el);
    await new Promise((r) => setTimeout(r, 0));
  });
};

// --- day board -------------------------------------------------------------

test('the day board anchors to yesterday rather than a typical day', async () => {
  const DayBoard = (await import('../src/pages/game/DayBoard.jsx')).default;
  await mount(<DayBoard content={GAME_CONTENT} onDone={() => {}} />);

  await waitFor(() => screen.getByRole('heading', { level: 1 }));
  assert.match(document.body.textContent, /start with yesterday/i);
  assert.match(document.body.textContent, /not a typical day/i);
  assert.ok(screen.getByRole('button', { name: /yes, let us use yesterday/i }));
});

test('an unusual day can still be used, and is recorded as unusual', async () => {
  const DayBoard = (await import('../src/pages/game/DayBoard.jsx')).default;
  await mount(<DayBoard content={GAME_CONTENT} onDone={() => {}} />);

  await waitFor(() => screen.getByRole('button', { name: /no, but use it anyway/i }));
  await click(screen.getByRole('button', { name: /no, but use it anyway/i }));

  const start = calls.find((c) => c.key === 'POST /api/game/start');
  assert.equal(start.body.anchorIsTypical, false);
});

test('the seeded day is laid out by time band and can be edited', async () => {
  const DayBoard = (await import('../src/pages/game/DayBoard.jsx')).default;
  await mount(<DayBoard content={GAME_CONTENT} onDone={() => {}} />);

  await click(screen.getByRole('button', { name: /yes, let us use yesterday/i }));
  await waitFor(() => screen.getByText('Waking up'));

  assert.ok(screen.getByRole('heading', { name: /Early morning/i }));
  assert.ok(screen.getByRole('heading', { name: /^Evening$/i }));
  assert.ok(screen.getByRole('button', { name: /remove waking up/i }));
});

test('removing an episode takes it off the board', async () => {
  const DayBoard = (await import('../src/pages/game/DayBoard.jsx')).default;
  await mount(<DayBoard content={GAME_CONTENT} onDone={() => {}} />);

  await click(screen.getByRole('button', { name: /yes, let us use yesterday/i }));
  await waitFor(() => screen.getByText('Waking up'));

  await click(screen.getByRole('button', { name: /remove waking up/i }));
  await waitFor(() => assert.equal(screen.queryByText('Waking up'), null));
});

test('the board will not advance with fewer than three moments', async () => {
  const DayBoard = (await import('../src/pages/game/DayBoard.jsx')).default;
  await mount(<DayBoard content={GAME_CONTENT} onDone={() => {}} />);

  await click(screen.getByRole('button', { name: /yes, let us use yesterday/i }));
  await waitFor(() => screen.getByText('Waking up'));

  await click(screen.getByRole('button', { name: /remove waking up/i }));
  await click(screen.getByRole('button', { name: /remove breakfast/i }));

  await waitFor(() => screen.getByRole('button', { name: /add at least three/i }));
  assert.equal(screen.getByRole('button', { name: /add at least three/i }).disabled, true);
});

test('tagging shows all ten tokens with both negative and positive options', async () => {
  const DayBoard = (await import('../src/pages/game/DayBoard.jsx')).default;
  await mount(<DayBoard content={GAME_CONTENT} onDone={() => {}} />);

  await click(screen.getByRole('button', { name: /yes, let us use yesterday/i }));
  await waitFor(() => screen.getByText('Waking up'));
  await click(screen.getByRole('button', { name: /that looks right/i }));

  await waitFor(() => screen.getByRole('heading', { level: 1, name: 'Waking up' }));
  for (const token of TOKENS) {
    assert.ok(screen.getByText(token.label), `missing token ${token.label}`);
  }
  // Leaving a moment untagged has to be an available answer, or the board
  // manufactures friction that was not there.
  assert.match(document.body.textContent, /Leaving one blank is a real answer/i);
});

test('selecting a token saves it against the episode', async () => {
  const DayBoard = (await import('../src/pages/game/DayBoard.jsx')).default;
  await mount(<DayBoard content={GAME_CONTENT} onDone={() => {}} />);

  await click(screen.getByRole('button', { name: /yes, let us use yesterday/i }));
  await waitFor(() => screen.getByText('Waking up'));
  await click(screen.getByRole('button', { name: /that looks right/i }));
  await waitFor(() => screen.getByText('Rushed'));

  await click(screen.getByText('Rushed'));

  const tagCall = calls.find((c) => c.key.startsWith('PUT /api/game/episodes/'));
  assert.ok(tagCall, 'no tag call was made');
  assert.deepEqual(tagCall.body.tokens, ['rushed']);
});

// --- Saboteur --------------------------------------------------------------

test('the Saboteur asks the participant to make their own moment worse', async () => {
  const Saboteur = (await import('../src/pages/game/Saboteur.jsx')).default;
  await mount(<Saboteur onDone={() => {}} />);

  await waitFor(() => screen.getByText(/your job is to ruin it/i));
  assert.match(document.body.textContent, /Waking up/);
  assert.ok(screen.getByRole('heading', { level: 1, name: /make it worse/i }));
});

test('the Saboteur allows an honest blank without penalty', async () => {
  let done = false;
  const Saboteur = (await import('../src/pages/game/Saboteur.jsx')).default;
  await mount(<Saboteur onDone={() => { done = true; }} />);

  await waitFor(() => screen.getByRole('button', { name: /nothing comes to mind/i }));
  await click(screen.getByRole('button', { name: /nothing comes to mind/i }));

  const call = calls.find((c) => c.key.includes('/responses'));
  assert.equal(call.body.skipped, true);
  assert.equal(done, true);
});

test('the Saboteur records a latency alongside each answer', async () => {
  const Saboteur = (await import('../src/pages/game/Saboteur.jsx')).default;
  await mount(<Saboteur onDone={() => {}} />);

  const input = await waitFor(() => screen.getByLabelText(/idea 1/i));
  await act(async () => {
    fireEvent.change(input, { target: { value: 'Move the switch somewhere else' } });
  });
  await click(screen.getByRole('button', { name: /^done$|^next$/i }));

  const call = calls.find((c) => c.key.includes('/responses'));
  assert.equal(call.body.responses.length, 1);
  assert.match(call.body.responses[0].text, /Move the switch/);
  assert.ok('responseMs' in call.body.responses[0]);
});

// --- forced choice ---------------------------------------------------------

test('forced choice offers two real moments and a tie option', async () => {
  const Pairwise = (await import('../src/pages/game/Pairwise.jsx')).default;
  await mount(<Pairwise onDone={() => {}} />);

  await waitFor(() => screen.getByRole('button', { name: 'Waking up' }));
  assert.ok(screen.getByRole('button', { name: 'Dinner' }));
  assert.ok(screen.getByRole('button', { name: /about the same/i }));
  assert.match(document.body.textContent, /rather never do again/i);
});

test('a forced choice is recorded with its side and latency', async () => {
  const Pairwise = (await import('../src/pages/game/Pairwise.jsx')).default;
  await mount(<Pairwise onDone={() => {}} />);

  await waitFor(() => screen.getByRole('button', { name: 'Dinner' }));
  await click(screen.getByRole('button', { name: 'Dinner' }));

  const call = calls.find((c) => c.key.includes('/choice'));
  assert.equal(call.body.chosenSide, 'right');
  assert.ok(typeof call.body.responseMs === 'number');
});

// --- rating ----------------------------------------------------------------

test('the rating screen shows the issue in CAE form', async () => {
  const Rating = (await import('../src/pages/Rating.jsx')).default;
  await mount(<Rating />);

  await waitFor(() => screen.getByText(/twelve minutes to heat water/i));
  assert.ok(screen.getByText('Because'));
  assert.ok(screen.getByText('You feel'));
  assert.ok(screen.getByText('And so'));
  assert.match(document.body.textContent, /impatient and stuck/i);
});

test('the rating screen offers the full one to five scale', async () => {
  const Rating = (await import('../src/pages/Rating.jsx')).default;
  await mount(<Rating />);

  await waitFor(() => screen.getByText(/Not at all severe/i));
  assert.ok(screen.getByText(/Definitely severe/i));
  for (const n of ['1', '2', '3', '4', '5']) {
    assert.ok(screen.getByText(n), `missing severity point ${n}`);
  }
});

test('rejecting an issue is as easy as rating it', async () => {
  const Rating = (await import('../src/pages/Rating.jsx')).default;
  await mount(<Rating />);

  await waitFor(() => screen.getByRole('button', { name: /this one is not me/i }));
  await click(screen.getByRole('button', { name: /this one is not me/i }));

  const call = calls.find((c) => c.key.startsWith('POST /api/issues/i1/rating'));
  assert.equal(call.body.rejected, true);
  assert.equal(call.body.recognised, false);
});

test('choosing a severity records it with a latency', async () => {
  const Rating = (await import('../src/pages/Rating.jsx')).default;
  await mount(<Rating />);

  await waitFor(() => screen.getByText(/Quite/i));
  await click(screen.getByText(/Quite/i).closest('button'));

  const call = calls.find((c) => c.key.startsWith('POST /api/issues/i1/rating'));
  assert.equal(call.body.severity, 4);
  assert.equal(call.body.recognised, true);
  assert.ok(typeof call.body.responseMs === 'number');
});

test('the participant can rewrite an issue in their own words', async () => {
  const Rating = (await import('../src/pages/Rating.jsx')).default;
  await mount(<Rating />);

  await waitFor(() => screen.getByRole('button', { name: /got the wording wrong/i }));
  await click(screen.getByRole('button', { name: /got the wording wrong/i }));

  await waitFor(() => screen.getByLabelText(/what actually happens/i));
  assert.ok(screen.getByLabelText(/how it makes you feel/i));
  assert.ok(screen.getByLabelText(/what it does to your day/i));
});

test('nothing on the rating screen reveals which cards are foils', async () => {
  const Rating = (await import('../src/pages/Rating.jsx')).default;
  await mount(<Rating />);

  await waitFor(() => screen.getByText(/twelve minutes to heat water/i));
  const html = document.body.innerHTML;
  assert.doesNotMatch(html, /foil/i);
  assert.doesNotMatch(document.body.textContent, /fabricated|invented|made up/i);
});

test('an extraction failure is explained rather than left blank', async () => {
  routeState['POST /api/issues/extract'] = () =>
    jsonResponse({ error: { code: 'internal_error', message: 'Something went wrong on our side.' } }, 500);

  const Rating = (await import('../src/pages/Rating.jsx')).default;
  await mount(<Rating />);

  await waitFor(() => screen.getByRole('heading', { level: 1, name: /went wrong/i }));
  assert.ok(screen.getByRole('button', { name: /try again/i }));
});

// --- post-questionnaire ----------------------------------------------------

test('the post-questionnaire renders its questions and marks optional ones', async () => {
  const PostQuestionnaire = (await import('../src/pages/PostQuestionnaire.jsx')).default;
  await mount(<PostQuestionnaire />);

  await waitFor(() => screen.getByText(/accurate picture of yesterday/i));
  assert.match(document.body.textContent, /did not pick up/i);
  assert.match(document.body.textContent, /optional/i);
});

test('the post-questionnaire blocks on an unanswered required question', async () => {
  const PostQuestionnaire = (await import('../src/pages/PostQuestionnaire.jsx')).default;
  await mount(<PostQuestionnaire />);

  await waitFor(() => screen.getByRole('button', { name: /finish/i }));
  await click(screen.getByRole('button', { name: /finish/i }));

  await waitFor(() => screen.getByRole('alert'));
  assert.match(screen.getByRole('alert').textContent, /answer this one/i);
  assert.ok(!calls.some((c) => c.key === 'POST /api/issues/questionnaire'));
});

test('answering the required question lets the questionnaire submit', async () => {
  const PostQuestionnaire = (await import('../src/pages/PostQuestionnaire.jsx')).default;
  await mount(<PostQuestionnaire />);

  await waitFor(() => screen.getByRole('button', { name: /strongly agree/i }));
  await click(screen.getByRole('button', { name: /strongly agree/i }));
  await click(screen.getByRole('button', { name: /finish/i }));

  const call = calls.find((c) => c.key === 'POST /api/issues/questionnaire');
  assert.ok(call, 'questionnaire was not submitted');
  assert.equal(call.body.answers.recognised_own_day, '5');
});

// --- debrief ---------------------------------------------------------------

test('the debrief discloses the foils without being asked', async () => {
  const Debrief = (await import('../src/pages/Debrief.jsx')).default;
  await mount(<Debrief />);

  await waitFor(() => screen.getByRole('heading', { level: 1, name: /thank you/i }));
  // The disclosure is on the page by default; only the list of which three is
  // behind a control.
  assert.match(document.body.textContent, /were not drawn from your day/i);
  assert.match(document.body.textContent, /we wrote them ourselves/i);
});

test('the debrief names the three foils on request', async () => {
  const Debrief = (await import('../src/pages/Debrief.jsx')).default;
  await mount(<Debrief />);

  await waitFor(() => screen.getByRole('button', { name: /show me which three/i }));
  await click(screen.getByRole('button', { name: /show me which three/i }));

  await waitFor(() => screen.getByText(/water pressure drops/i));
  assert.ok(screen.getByText(/lift is out on alternate days/i));
  assert.ok(screen.getByText(/bill reminder arrives late/i));
});

test('the debrief shows the participant their reconstructed day', async () => {
  const Debrief = (await import('../src/pages/Debrief.jsx')).default;
  await mount(<Debrief />);

  await waitFor(() => screen.getByRole('heading', { name: /the day you rebuilt/i }));
  assert.match(document.body.textContent, /Waking up/);
  assert.match(document.body.textContent, /Dinner/);
});

test('the debrief shows the participant code prominently and how to withdraw', async () => {
  const Debrief = (await import('../src/pages/Debrief.jsx')).default;
  await mount(<Debrief />);

  await waitFor(() => {
    const display = document.querySelector('.code-display');
    assert.ok(display, 'no code display on the debrief');
    assert.equal(display.textContent.trim(), 'P042');
  });
  assert.match(document.body.textContent, /only way to ask us to delete/i);
  assert.ok(document.querySelector('a[href="/withdraw"]'));
});

test('the debrief marks the session complete exactly once', async () => {
  const Debrief = (await import('../src/pages/Debrief.jsx')).default;
  await mount(<Debrief />);

  await waitFor(() => assert.ok(document.querySelector('.code-display')));
  const viewed = calls.filter((c) => c.key === 'POST /api/issues/debrief/viewed');
  assert.equal(viewed.length, 1);
  assert.equal(viewed[0].body.foilsRevealed, true);
});

test('the debrief separates what the participant kept from what they rejected', async () => {
  const Debrief = (await import('../src/pages/Debrief.jsx')).default;
  await mount(<Debrief />);

  await waitFor(() => screen.getByRole('heading', { name: /actually gets in your way/i }));
  assert.match(document.body.textContent, /twelve minutes to heat/i);
  assert.match(document.body.textContent, /rejected 1 more/i);
});
