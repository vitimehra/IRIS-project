const BASE = (import.meta.env?.VITE_API_BASE_URL || '').replace(/\/$/, '');

const KEYS = { participant: 'vitis.participant.token', experimenter: 'vitis.experimenter.token' };

export const tokens = {
  get: (role) => {
    try {
      return localStorage.getItem(KEYS[role]);
    } catch {
      return null;
    }
  },
  set: (role, value) => {
    try {
      value ? localStorage.setItem(KEYS[role], value) : localStorage.removeItem(KEYS[role]);
    } catch {
      /* ignore */
    }
  },
};

export class ApiError extends Error {
  constructor(status, detail) {
    super(typeof detail === 'string' ? detail : JSON.stringify(detail));
    this.status = status;
  }
}

async function request(method, path, { body, role } = {}) {
  const token = role ? tokens.get(role) : null;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { detail: text };
  }
  if (!res.ok) throw new ApiError(res.status, payload?.detail || `Request failed (${res.status})`);
  return payload;
}

const P = { role: 'participant' };
const E = { role: 'experimenter' };

export const api = {
  health: () => request('GET', '/api/health'),
  imageUrl: (url, role) => `${BASE}${url}?t=${encodeURIComponent(tokens.get(role) || '')}`,

  // participant
  participantLogin: (username, passcode) => request('POST', '/api/participant/login', { body: { username, passcode } }),
  consent: () => request('GET', '/api/consent'),
  giveConsent: (agreed) => request('POST', '/api/participant/consent', { body: { agreed }, ...P }),
  state: () => request('GET', '/api/study/state', P),
  submitIssue: (body) => request('POST', '/api/study/issue', { body, ...P }),
  confirmCae: (issues) => request('POST', '/api/study/cae/confirm', { body: { issues }, ...P }),
  selectProblem: (problem_id) => request('POST', '/api/study/problems/select', { body: { problem_id }, ...P }),
  confirmAopc: (body) => request('POST', '/api/study/aopc/confirm', { body, ...P }),
  submitTraditional: (ideas) => request('POST', '/api/study/traditional', { body: { ideas }, ...P }),
  proposeKeywords: () => request('POST', '/api/study/inspider/keywords/propose', P),
  addKeyword: (text) => request('POST', '/api/study/inspider/keywords/add', { body: { text }, ...P }),
  confirmKeywords: (keyword_ids) => request('POST', '/api/study/inspider/keywords/confirm', { body: { keyword_ids }, ...P }),
  confirmNeighbours: (picks) => request('POST', '/api/study/inspider/neighbours/confirm', { body: { picks }, ...P }),
  swapKeyword: (out_id, in_id) => request('POST', '/api/study/inspider/select/swap', { body: { out_id, in_id }, ...P }),
  confirmSelection: () => request('POST', '/api/study/inspider/select/confirm', P),
  history: () => request('GET', '/api/study/history', P),
  runPhenomena: () => request('POST', '/api/study/inspider/phenomena/run', P),
  confirmPhenomena: () => request('POST', '/api/study/inspider/phenomena/confirm', P),
  rate: (body) => request('POST', '/api/study/rate', { body, ...P }),
  rateComplete: () => request('POST', '/api/study/rate/complete', P),

  // experimenter
  adminLogin: (username, password) => request('POST', '/api/admin/login', { body: { username, password } }),
  adminLogout: () => request('POST', '/api/admin/logout', E),
  adminMe: () => request('GET', '/api/admin/me', E),
  overview: () => request('GET', '/api/admin/overview', E),
  putStudySettings: (body) => request('PUT', '/api/admin/study-settings', { body, ...E }),
  participants: () => request('GET', '/api/admin/participants', E),
  createParticipant: (body) => request('POST', '/api/admin/participants', { body, ...E }),
  updateParticipant: (id, body) => request('PATCH', `/api/admin/participants/${id}`, { body, ...E }),
  regeneratePasscode: (id) => request('POST', `/api/admin/participants/${id}/regenerate-passcode`, E),
  retryGeneration: (id) => request('POST', `/api/admin/participants/${id}/retry-generation`, E),
  deleteParticipant: (id, username) => request('DELETE', `/api/admin/participants/${id}`, { body: { username }, ...E }),
  participantFull: (id) => request('GET', `/api/admin/participants/${id}/full`, E),
  webSearch: (q) => request('GET', `/api/admin/web/search?q=${encodeURIComponent(q)}`, E),
  webPhenomena: () => request('GET', '/api/admin/web/phenomena', E),
  auditLog: () => request('GET', '/api/admin/audit', E),
  exportJsonUrl: () => `${BASE}/api/admin/export.json`,
  exportCsvUrl: () => `${BASE}/api/admin/export/ratings.csv`,
};
