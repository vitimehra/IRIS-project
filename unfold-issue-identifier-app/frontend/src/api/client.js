/**
 * Thin API client.
 *
 * In development VITE_API_BASE_URL is empty and requests go to /api, which the
 * Vite dev proxy forwards to the backend. In production it is the Railway URL.
 */
const BASE = (import.meta.env?.VITE_API_BASE_URL || '').replace(/\/$/, '');

const TOKEN_KEY = 'unfold.session.token';

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    // Private browsing, or storage disabled. The session still works for as
    // long as the tab stays open; it just cannot be resumed after a refresh.
    return memoryToken;
  }
}

let memoryToken = null;

export function setToken(token) {
  memoryToken = token;
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* memory fallback above */
  }
}

export class ApiError extends Error {
  constructor(status, payload) {
    super(payload?.error?.message || `Request failed (${status})`);
    this.status = status;
    this.code = payload?.error?.code || 'unknown';
    this.details = payload?.error?.details;
  }
}

async function request(method, path, { body, auth = true, token } = {}) {
  const activeToken = token ?? (auth ? getToken() : null);

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(activeToken ? { authorization: `Bearer ${activeToken}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  const text = await res.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text };
    }
  }

  if (!res.ok) throw new ApiError(res.status, payload);
  return payload;
}

export const api = {
  get: (path, opts) => request('GET', path, opts),
  post: (path, body, opts) => request('POST', path, { body, ...opts }),
  patch: (path, body, opts) => request('PATCH', path, { body, ...opts }),
  put: (path, body, opts) => request('PUT', path, { body, ...opts }),
  del: (path, opts) => request('DELETE', path, opts),

  studyInfo: () => request('GET', '/api/study-info', { auth: false }),
  health: () => request('GET', '/api/health', { auth: false }),

  createSession: (client) => request('POST', '/api/sessions', { body: { client }, auth: false }),
  me: () => request('GET', '/api/sessions/me'),
  ageGate: (age) => request('POST', '/api/sessions/me/age-gate', { body: { age } }),
  setStage: (stage) => request('PATCH', '/api/sessions/me/stage', { body: { stage } }),

  consentDocument: (type) => request('GET', `/api/consent/${type}`, { auth: false }),
  submitAdultConsent: (responses, signatureName) =>
    request('POST', '/api/consent/adult', { body: { responses, signatureName } }),
  submitAssent: (responses, signatureName) =>
    request('POST', '/api/consent/assent', { body: { responses, signatureName } }),

  createGuardianRequest: () => request('POST', '/api/guardian/requests', { body: {} }),
  guardianStatus: () => request('GET', '/api/guardian/requests/status'),
  guardianByCode: (code) => request('GET', `/api/guardian/by-code/${code}`, { auth: false }),
  guardianConsent: (code, payload) =>
    request('POST', `/api/guardian/by-code/${code}/consent`, { body: payload, auth: false }),
  guardianDecline: (code, reason) =>
    request('POST', `/api/guardian/by-code/${code}/decline`, { body: { reason }, auth: false }),

  demographicsSchema: () => request('GET', '/api/demographics/schema', { auth: false }),
  submitDemographics: (payload) => request('POST', '/api/demographics', { body: payload }),
  myDemographics: () => request('GET', '/api/demographics/me'),

  // --- game (phase 2) ---
  gameContent: () => request('GET', '/api/game/content', { auth: false }),
  gameStart: (body) => request('POST', '/api/game/start', { body }),
  gameState: () => request('GET', '/api/game/state'),
  addEpisode: (episode) => request('POST', '/api/game/episodes', { body: episode }),
  updateEpisode: (id, patch) => request('PATCH', `/api/game/episodes/${id}`, { body: patch }),
  deleteEpisode: (id) => request('DELETE', `/api/game/episodes/${id}`),
  setEpisodeTags: (id, tokens) => request('PUT', `/api/game/episodes/${id}/tags`, { body: { tokens } }),
  saboteurPlan: () => request('POST', '/api/game/saboteur/plan', { body: {} }),
  saboteurResponses: (roundId, body) =>
    request('POST', `/api/game/saboteur/${roundId}/responses`, { body }),
  pairwisePlan: () => request('POST', '/api/game/pairwise/plan', { body: {} }),
  pairwiseChoice: (roundId, body) => request('POST', `/api/game/pairwise/${roundId}/choice`, { body }),
  completeGame: (body) => request('POST', '/api/game/complete', { body }),

  // --- issues, rating, questionnaire, debrief (phases 3 and 4) ---
  extractIssues: (force = false) => request('POST', '/api/issues/extract', { body: { force } }),
  myIssues: () => request('GET', '/api/issues/mine'),
  rateIssue: (issueId, rating) => request('POST', `/api/issues/${issueId}/rating`, { body: rating }),
  rateIssues: (ratings) => request('POST', '/api/issues/ratings', { body: { ratings } }),
  completeRatings: () => request('POST', '/api/issues/ratings/complete', { body: {} }),
  questionnaireSchema: () => request('GET', '/api/issues/questionnaire/schema', { auth: false }),
  submitQuestionnaire: (body) => request('POST', '/api/issues/questionnaire', { body }),
  debrief: () => request('GET', '/api/issues/debrief'),
  debriefViewed: (body) => request('POST', '/api/issues/debrief/viewed', { body }),

  sendTelemetry: (events) => request('POST', '/api/telemetry', { body: { events } }),

  withdrawMe: (reason) => request('POST', '/api/withdrawal/me', { body: { reason } }),
  withdrawByCode: (participantCode, reason) =>
    request('POST', '/api/withdrawal/by-code', {
      body: { participantCode, reason },
      auth: false,
    }),

  adminLogin: (username, password) =>
    request('POST', '/api/admin/login', { body: { username, password }, auth: false }),
  adminMe: (token) => request('GET', '/api/admin/me', { token }),
  adminStats: (token) => request('GET', '/api/admin/stats', { token }),
  adminSessions: (token, { limit = 100, offset = 0 } = {}) =>
    request('GET', `/api/admin/sessions?limit=${limit}&offset=${offset}`, { token }),
  adminAudit: (token, limit = 50) => request('GET', `/api/admin/audit?limit=${limit}`, { token }),
  adminAnalysis: (token) => request('GET', '/api/admin/analysis', { token }),
  adminIssues: (token, { limit = 200, foils = false } = {}) =>
    request('GET', `/api/admin/issues?limit=${limit}&foils=${foils}`, { token }),
  adminSessionLog: (token, id) => request('GET', `/api/admin/sessions/${id}`, { token }),
  adminDeleteSession: (token, id, reason) =>
    request('POST', `/api/admin/sessions/${id}/delete`, {
      body: { reason: reason || 'Deleted by researcher' },
      token,
    }),
  adminLogout: (token) => request('POST', '/api/admin/logout', { body: {}, token }),
  adminExportUrl: () => `${BASE}/api/admin/export.json`,
  adminCsvUrl: (table) => `${BASE}/api/admin/export/${table}.csv`,
};
