/** Thin client. In dev, Vite proxies /api to FastAPI. In production, set VITE_API_BASE. */

const API_BASE = String(import.meta.env.VITE_API_BASE || "").replace(/\/$/, "");

async function request(method, path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text };
  }
  if (!res.ok) {
    const msg =
      payload?.detail || payload?.raw || `Request failed (${res.status})`;
    const err = new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
    err.status = res.status;
    throw err;
  }
  return payload;
}

const qs = (params) => {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") u.set(k, String(v));
  }
  const s = u.toString();
  return s ? `?${s}` : "";
};

export const api = {
  meta: () => request("GET", "/api/meta"),
  search: (q, unverified, limit = 12) =>
    request("GET", `/api/search${qs({ q, unverified, limit })}`),
  verb: (term) => request("GET", `/api/verbs/${encodeURIComponent(term)}`),
  random: (unverified) =>
    request("GET", `/api/verbs/random${qs({ unverified })}`),
  neighbours: (term, k, min_sim, unverified) =>
    request(
      "GET",
      `/api/verbs/${encodeURIComponent(term)}/neighbours${qs({ k, min_sim, unverified })}`,
    ),
  ego: (term, k, depth, min_sim, unverified) =>
    request("GET", `/api/ego${qs({ term, k, depth, min_sim, unverified })}`),
  compare: (a, b, k = 50) => request("GET", `/api/compare${qs({ a, b, k })}`),
  similarity: (a, b) => request("GET", `/api/similarity${qs({ a, b })}`),
  analogy: (positive, negative, k, unverified) =>
    request("POST", "/api/analogy", { positive, negative, k, unverified }),
  path: (from, to) => request("GET", `/api/path${qs({ from, to })}`),
  walk: (start, steps, temperature, avoid_cluster, unverified, seed) =>
    request(
      "GET",
      `/api/walk${qs({ start, steps, temperature, avoid_cluster, unverified, seed })}`,
    ),
  clusters: () => request("GET", "/api/clusters"),
  cluster: (id, limit, unverified) =>
    request("GET", `/api/clusters/${id}${qs({ limit, unverified })}`),
  map: (unverified) => request("GET", `/api/map${qs({ unverified })}`),
  exportUrl: (ids, format) =>
    `${API_BASE}/api/export/subgraph${qs({ ids: ids.join(","), format })}`,
};
