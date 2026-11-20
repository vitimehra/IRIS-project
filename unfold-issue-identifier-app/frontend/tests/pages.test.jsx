/**
 * Render tests.
 *
 * A passing build only proves the modules parse. These mount every page against
 * a mocked API and assert the participant actually sees the right thing, which
 * is where crashes and wrong routing actually show up.
 */
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import globalJsdom from 'global-jsdom';

let cleanupDom;
let React;
let render;
let screen;
let waitFor;
let cleanup;
let act;
let fireEvent;
let MemoryRouter;
let Routes;
let Route;
let SessionProvider;

// --- mocked backend --------------------------------------------------------

const CONSENT_DOCS = {
  adult: {
    consentType: 'adult',
    version: '1.0.0',
    contacts: {
      researchers: [
        { name: 'Viti Mehra', email: '[REPLACE-WITH-EMAIL]' },
        { name: 'Sankar Balasubramanian', email: '[REPLACE-WITH-EMAIL]' },
      ],
      affiliation: '[REPLACE-WITH-DEPARTMENT-AND-INSTITUTE]',
      ethicsContact: { label: 'Institutional Human Ethics Committee', email: '[REPLACE]' },
      approvalNumber: '[REPLACE]',
    },
    infoSheet: {
      title: 'Before you begin',
      sections: [{ heading: 'What this study is about', body: 'Everyday frictions.' }],
    },
    items: [
      { key: 'age_confirm', required: true, text: 'I confirm that I am 18 years of age or older.' },
      { key: 'voluntary', required: true, text: 'I understand that taking part is voluntary.' },
      { key: 'recontact', required: false, text: 'Optional: I am willing to be contacted.' },
    ],
  },
  guardian: {
    consentType: 'guardian',
    version: '1.0.0',
    contacts: { researchers: [], ethicsContact: {} },
    infoSheet: {
      title: 'Permission for your child to take part in a research study',
      sections: [{ heading: 'Why you are seeing this', body: 'A young person asked you.' }],
    },
    items: [
      { key: 'relationship', required: true, text: 'I confirm that I am the parent or legal guardian.' },
      { key: 'give_permission', required: true, text: 'I give permission for my child to take part.' },
    ],
  },
  minor_assent: {
    consentType: 'minor_assent',
    version: '1.0.0',
    contacts: { researchers: [], ethicsContact: {} },
    infoSheet: { title: 'Before you start', sections: [{ heading: 'What this is', body: 'A study.' }] },
    items: [{ key: 'willing', required: true, text: 'I want to take part.' }],
  },
};

const DEMOGRAPHICS_SCHEMA = {
  version: '1.0.0',
  steps: [
    {
      key: 'about_you',
      title: 'About you',
      blurb: 'Nothing here identifies you.',
      fields: [
        { key: 'first_name', label: 'First name', type: 'text', optional: true },
        { key: 'age', label: 'Age', type: 'number', min: 15, max: 50, required: true },
        {
          key: 'gender',
          label: 'Gender',
          type: 'select',
          options: [{ value: 'woman', label: 'Woman' }],
        },
      ],
    },
    {
      key: 'living',
      title: 'Where and how you live',
      fields: [
        { key: 'country', label: 'Country', type: 'text', default: 'India' },
        { key: 'has_children', label: 'Do you have children?', type: 'boolean' },
        {
          key: 'children_count',
          label: 'How many?',
          type: 'number',
          showIf: { field: 'has_children', equals: true },
        },
      ],
    },
  ],
};

let routeState = {};

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

    if (routeState[key]) return routeState[key]();

    if (path === '/api/study-info') {
      return jsonResponse({
        contacts: CONSENT_DOCS.adult.contacts,
        ageRange: { min: 15, max: 50 },
        minorThreshold: 18,
      });
    }
    if (path === '/api/sessions' && method === 'POST') {
      return jsonResponse(
        { sessionId: 'sess-1', participantCode: 'P042', token: 'tok-1' },
        201
      );
    }
    if (path === '/api/sessions/me') {
      return jsonResponse({
        session: {
          sessionId: 'sess-1',
          participantCode: 'P042',
          status: 'consented',
          stage: 'demographics',
          isMinor: false,
        },
      });
    }
    if (path.startsWith('/api/consent/')) {
      const type = path.split('/').pop();
      if (CONSENT_DOCS[type]) return jsonResponse(CONSENT_DOCS[type]);
    }
    if (path === '/api/demographics/schema') return jsonResponse(DEMOGRAPHICS_SCHEMA);
    if (path === '/api/demographics/me') return jsonResponse({ answers: null });
    if (path === '/api/guardian/requests' && method === 'POST') {
      return jsonResponse(
        {
          shortCode: 'K7RMQ4',
          status: 'pending',
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
          guardianUrl: 'http://localhost:5173/guardian/K7RMQ4',
        },
        201
      );
    }
    if (path === '/api/guardian/requests/status') return jsonResponse({ status: 'pending' });
    if (path.startsWith('/api/guardian/by-code/')) {
      return jsonResponse({ shortCode: 'K7RMQ4', status: 'viewed', alreadyResolved: false });
    }
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

  // jsdom does not implement fetch, and global-jsdom replaces the globals that
  // Node's built-in fetch lives on. Install the mock after the DOM exists.
  installFetchMock();
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;

  React = (await import('react')).default;
  ({ render, screen, waitFor, cleanup, act, fireEvent } = await import('@testing-library/react'));
  ({ MemoryRouter, Routes, Route } = await import('react-router-dom'));
  ({ SessionProvider } = await import('../src/state/SessionContext.jsx'));
});

beforeEach(() => {
  cleanup?.();
  routeState = {};
  try {
    localStorage.clear();
    sessionStorage.clear();
  } catch {
    /* ignore */
  }
});

after(() => {
  cleanup?.();
  cleanupDom?.();
  // The telemetry interval and the guardian poll keep the event loop alive.
  setTimeout(() => process.exit(process.exitCode || 0), 50).unref?.();
  process.exit(process.exitCode || 0);
});

async function mount(element, { path = '/' } = {}) {
  const result = render(
    <MemoryRouter initialEntries={[path]}>
      <SessionProvider>{element}</SessionProvider>
    </MemoryRouter>
  );
  // Let the provider's study-info and session bootstrap settle.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  return result;
}

async function mountRoute(Component, { path, pattern }) {
  return mount(
    <Routes>
      <Route path={pattern} element={<Component />} />
    </Routes>,
    { path }
  );
}

// --- tests -----------------------------------------------------------------

test('the landing page renders the invitation and a start control', async () => {
  const Landing = (await import('../src/pages/Landing.jsx')).default;
  await mount(<Landing />);

  await waitFor(() => screen.getByRole('heading', { level: 1 }));
  assert.match(screen.getByRole('heading', { level: 1 }).textContent, /got in your way/i);
  assert.ok(screen.getByRole('button', { name: /start/i }));
});

test('the landing page states the age range and the 20 minute estimate', async () => {
  const Landing = (await import('../src/pages/Landing.jsx')).default;
  await mount(<Landing />);
  await waitFor(() => screen.getByRole('heading', { level: 1 }));

  const text = document.body.textContent;
  assert.match(text, /20 minutes/i);
  assert.match(text, /15 and 50/);
});

test('the footer names both researchers on every page', async () => {
  const Landing = (await import('../src/pages/Landing.jsx')).default;
  await mount(<Landing />);
  await waitFor(() => screen.getByRole('heading', { level: 1 }));

  const footer = document.querySelector('.site-footer');
  assert.match(footer.textContent, /Viti Mehra/);
  assert.match(footer.textContent, /Sankar Balasubramanian/);
  const admin = footer.querySelector('a[href="/admin"]');
  assert.ok(admin);
  assert.match(admin.textContent, /Admin/);
});

test('placeholder contact details are not shown to participants', async () => {
  const Landing = (await import('../src/pages/Landing.jsx')).default;
  await mount(<Landing />);
  await waitFor(() => screen.getByRole('heading', { level: 1 }));

  // The contacts block still holds [REPLACE-WITH-...] markers. Those must never
  // reach a participant's screen.
  assert.doesNotMatch(document.body.textContent, /\[REPLACE/);
});

test('the age gate renders an age field', async () => {
  const AgeGate = (await import('../src/pages/AgeGate.jsx')).default;
  await mount(<AgeGate />);
  await waitFor(() => screen.getByLabelText(/your age/i));
});

test('the age gate explains the screen-out rather than just refusing', async () => {
  const AgeGate = (await import('../src/pages/AgeGate.jsx')).default;
  routeState['POST /api/sessions/me/age-gate'] = () =>
    jsonResponse({
      result: 'screened_out',
      eligible: false,
      requiresGuardianConsent: false,
      session: { sessionId: 'sess-1', status: 'screened_out', stage: 'age_gate' },
    });

  await mount(<AgeGate />);
  const input = await waitFor(() => screen.getByLabelText(/your age/i));

  await act(async () => {
    fireEvent.change(input, { target: { value: '12' } });
  });
  await act(async () => {
    fireEvent.submit(input.form);
    await new Promise((r) => setTimeout(r, 0));
  });

  await waitFor(() => assert.match(document.body.textContent, /recruiting people aged 15 to 50/i));
});

test('the adult consent page renders every item, with required ones enforced', async () => {
  const ConsentAdult = (await import('../src/pages/ConsentAdult.jsx')).default;
  await mount(<ConsentAdult />);

  await waitFor(() => screen.getByText(/I confirm that I am 18 years of age or older/i));
  const boxes = document.querySelectorAll('input[type="checkbox"]');
  assert.equal(boxes.length, 3);

  // Submit is disabled until the required items are ticked.
  const submit = screen.getByRole('button', { name: /I agree, continue/i });
  assert.equal(submit.disabled, true);
});

test('ticking only the optional item does not unlock consent', async () => {
  const ConsentAdult = (await import('../src/pages/ConsentAdult.jsx')).default;
  await mount(<ConsentAdult />);
  await waitFor(() => screen.getByText(/taking part is voluntary/i));

  const optional = document.getElementById('consent-recontact');
  await act(async () => {
    optional.click();
  });

  assert.equal(screen.getByRole('button', { name: /I agree, continue/i }).disabled, true);
});

test('ticking all required items unlocks consent', async () => {
  const ConsentAdult = (await import('../src/pages/ConsentAdult.jsx')).default;
  await mount(<ConsentAdult />);
  await waitFor(() => screen.getByText(/taking part is voluntary/i));

  await act(async () => {
    document.getElementById('consent-age_confirm').click();
    document.getElementById('consent-voluntary').click();
  });

  assert.equal(screen.getByRole('button', { name: /I agree, continue/i }).disabled, false);
});

test('the guardian waiting screen shows a code and a QR, and does not leak the code owner', async () => {
  const GuardianWait = (await import('../src/pages/GuardianWait.jsx')).default;
  await mount(<GuardianWait />);

  await waitFor(() => screen.getByText('K7RMQ4'));
  assert.ok(document.querySelector('svg'), 'expected a QR code');
  assert.match(document.body.textContent, /parent or guardian/i);
});

test('the guardian page renders its own document, not the participant wording', async () => {
  const GuardianConsent = (await import('../src/pages/GuardianConsent.jsx')).default;
  await mountRoute(GuardianConsent, { path: '/guardian/K7RMQ4', pattern: '/guardian/:code' });

  await waitFor(() => screen.getByText(/I give permission for my child to take part/i));
  assert.match(document.body.textContent, /Permission for your child/i);
  // The first-person participant item must not appear on a guardian's screen.
  assert.doesNotMatch(document.body.textContent, /I confirm that I am 18 years of age/i);
});

test('the guardian page asks who is giving permission', async () => {
  const GuardianConsent = (await import('../src/pages/GuardianConsent.jsx')).default;
  await mountRoute(GuardianConsent, { path: '/guardian/K7RMQ4', pattern: '/guardian/:code' });

  await waitFor(() => screen.getByLabelText(/your full name/i));
  assert.ok(screen.getByLabelText(/your relationship to them/i));
  assert.ok(screen.getByRole('button', { name: /I do not give permission/i }));
});

test('the guardian page falls back to code entry when no code is in the URL', async () => {
  const GuardianConsent = (await import('../src/pages/GuardianConsent.jsx')).default;
  await mountRoute(GuardianConsent, { path: '/guardian', pattern: '/guardian' });

  await waitFor(() => screen.getByLabelText(/permission code/i));
});

test('the assent page renders the young person document', async () => {
  const MinorAssent = (await import('../src/pages/MinorAssent.jsx')).default;
  await mount(<MinorAssent />);

  await waitFor(() => screen.getByRole('button', { name: /yes, i want to take part/i }));
  assert.ok(screen.getByLabelText(/^I want to take part\.$/i));
  assert.match(document.body.textContent, /still entirely your choice/i);
});

test('demographics renders the first step and not the later ones', async () => {
  const Demographics = (await import('../src/pages/Demographics.jsx')).default;
  await mount(<Demographics />);

  await waitFor(() => screen.getByLabelText(/^Age$/i));
  assert.ok(screen.getByRole('heading', { name: /about you/i }));
  assert.equal(screen.queryByLabelText(/country/i), null);
});

test('demographics blocks advancing when a required field is empty', async () => {
  const Demographics = (await import('../src/pages/Demographics.jsx')).default;
  await mount(<Demographics />);
  await waitFor(() => screen.getByLabelText(/^Age$/i));

  await act(async () => {
    screen.getByRole('button', { name: /next/i }).click();
  });

  await waitFor(() => screen.getByRole('alert'));
  assert.match(screen.getByRole('alert').textContent, /needed to continue/i);
  // Still on step one.
  assert.ok(screen.getByRole('heading', { name: /about you/i }));
});

test('demographics marks optional fields as optional', async () => {
  const Demographics = (await import('../src/pages/Demographics.jsx')).default;
  await mount(<Demographics />);
  await waitFor(() => screen.getByLabelText(/first name/i));

  const label = [...document.querySelectorAll('.field__label')].find((l) =>
    /first name/i.test(l.textContent)
  );
  assert.match(label.textContent, /optional/i);
});

test('the withdrawal page requires confirmation before deleting', async () => {
  const Withdraw = (await import('../src/pages/Withdraw.jsx')).default;
  await mount(<Withdraw />);

  const input = await waitFor(() => screen.getByLabelText(/participant code/i));
  await act(async () => {
    fireEvent.change(input, { target: { value: 'P042' } });
  });

  await act(async () => {
    screen.getByRole('button', { name: /^delete my data$/i }).click();
  });

  await waitFor(() => screen.getByRole('button', { name: /yes, delete everything/i }));
  assert.match(document.body.textContent, /cannot be undone/i);
});

test('the about page is readable without a session', async () => {
  const About = (await import('../src/pages/About.jsx')).default;
  await mount(<About />);

  await waitFor(() => screen.getByRole('heading', { level: 1, name: /what happens to your answers/i }));
  assert.match(document.body.textContent, /What this study is about/i);
});

test('the admin dashboard shows a login form and no data before authentication', async () => {
  const Admin = (await import('../src/pages/Admin.jsx')).default;
  await mount(<Admin />);

  await waitFor(() => screen.getByLabelText(/username/i));
  assert.ok(screen.getByLabelText(/password/i));
  assert.equal(screen.queryByText(/sessions started/i), null);
});

test('the admin dashboard renders stats once authenticated', async () => {
  const Admin = (await import('../src/pages/Admin.jsx')).default;

  routeState['GET /api/admin/me'] = () =>
    jsonResponse({ user: { username: 'viti', displayName: 'Viti Mehra', role: 'researcher' } });
  routeState['GET /api/admin/stats'] = () =>
    jsonResponse({
      sessions: { total: 12, consented: 9, completed: 7, screenedOut: 1, withdrawn: 1, minors: 3, started: 2 },
      guardian: { requested: 3, consented: 2, declined: 1 },
      demographics: { submitted: 8 },
      issues: { extracted: 40, foils: 6, rated: 30 },
      funnel: [{ status: 'completed', n: 7 }],
    });
  routeState['GET /api/admin/sessions?limit=200&offset=0'] = () =>
    jsonResponse({ sessions: [], total: 0, limit: 200, offset: 0 });
  routeState['GET /api/admin/audit?limit=50'] = () => jsonResponse({ entries: [] });
  routeState['GET /api/admin/analysis'] = () =>
    jsonResponse({
      foils: {
        perSession: [],
        summary: {
          sessionsRated: 0,
          meanRealSeverity: null,
          meanFoilSeverity: null,
          meanGap: null,
          foilRejectionRate: null,
          realRejectionRate: null,
          flaggedSessions: 0,
        },
      },
      friction: { byDomain: [], byBand: [], byToken: [] },
      provenance: { total: 0, cause: { rate: null }, affect: { rate: null }, effect: { rate: null } },
      extraction: { byStatus: [], tokens: { input: 0, output: 0 }, recentErrors: [] },
      completion: { medianSessionMs: null, medianGameMs: null, completedWithTiming: 0, byStage: [] },
      questionnaire: { scales: [], freeText: [] },
    });
  routeState['GET /api/admin/issues?limit=300&foils=true'] = () =>
    jsonResponse({ issues: [], limit: 300, offset: 0 });

  sessionStorage.setItem('unfold.admin.token', 'admin-tok');

  await mount(<Admin />);

  await waitFor(() => screen.getByText('Viti Mehra'));
  await waitFor(() => screen.getByText(/sessions started/i));
  assert.match(document.body.textContent, /12/);
});

test('a participant token is not accepted as an admin token', async () => {
  const Admin = (await import('../src/pages/Admin.jsx')).default;
  routeState['GET /api/admin/me'] = () =>
    jsonResponse({ error: { code: 'unauthorized', message: 'nope' } }, 401);

  sessionStorage.setItem('unfold.admin.token', 'participant-token');
  await mount(<Admin />);

  await waitFor(() => screen.getByLabelText(/username/i));
  assert.equal(sessionStorage.getItem('unfold.admin.token'), null);
});
