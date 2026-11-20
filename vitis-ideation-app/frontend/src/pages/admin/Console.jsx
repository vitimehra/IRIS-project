import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import Layout, { Notice, Spinner } from '../../components/Layout.jsx';
import { api, tokens } from '../../api/client.js';
import ParticipantDetail from './ParticipantDetail.jsx';
import DeleteParticipantDialog from './DeleteParticipantDialog.jsx';

export function ConsoleLogin() {
  const nav = useNavigate();
  const [u, setU] = useState('');
  const [p, setP] = useState('');
  const [error, setError] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    try {
      const r = await api.adminLogin(u, p);
      tokens.set('experimenter', r.token);
      nav('/console');
    } catch (err) {
      setError(err.message);
    }
  };
  return (
    <Layout>
      <form className="narrow stack" onSubmit={submit}>
        <p className="eyebrow">Experimenter</p>
        <h1>Console sign-in</h1>
        <label className="field"><span>Username</span><input className="input" value={u} onChange={(e) => setU(e.target.value)} autoComplete="username" /></label>
        <label className="field"><span>Password</span><input className="input" type="password" value={p} onChange={(e) => setP(e.target.value)} autoComplete="current-password" /></label>
        {error && <Notice tone="warn">{error}</Notice>}
        <button className="btn" disabled={!u || !p}>Sign in</button>
      </form>
    </Layout>
  );
}

function useAdmin() {
  const nav = useNavigate();
  const [me, setMe] = useState(null);
  useEffect(() => {
    if (!tokens.get('experimenter')) { nav('/console/login'); return; }
    api.adminMe().then(setMe).catch(() => nav('/console/login'));
  }, [nav]);
  const logout = async () => {
    try { await api.adminLogout(); } catch { /* discarding anyway */ }
    tokens.set('experimenter', null);
    nav('/console/login');
  };
  return { me, logout };
}

const CONDITION_LABEL = { traditional: 'Traditional', modern: 'Modern AI', inspider: 'Inspider' };

export default function Console() {
  const { me, logout } = useAdmin();
  const { id } = useParams();
  const [tab, setTab] = useState('participants');
  const [overview, setOverview] = useState(null);
  const [parts, setParts] = useState([]);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);
  const [justCreated, setJustCreated] = useState(null);
  const [toDelete, setToDelete] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [o, p] = await Promise.all([api.overview(), api.participants()]);
      setOverview(o);
      setParts(p.participants);
    } catch (e) {
      setError(e.message);
    }
  }, []);
  useEffect(() => { if (me) load(); }, [me, load]);

  if (!me) return <Layout><Spinner label="…" /></Layout>;
  if (id) return <ParticipantDetail id={id} me={me} logout={logout} />;

  const right = (
    <span className="row">
      <span className="muted small">{me.display_name}</span>
      <button className="btn btn--quiet btn--sm" onClick={logout}>Sign out</button>
    </span>
  );

  return (
    <Layout right={right} wide>
      <div className="row row--between">
        <div><p className="eyebrow">Experimenter console</p><h1>Study</h1></div>
        <nav className="tabs">
          {[['participants', 'Participants'], ['overview', 'Overview'], ['web', 'Inspider web'], ['export', 'Export'], ['audit', 'Access log']].map(([k, l]) => (
            <button key={k} className={`tab ${tab === k ? 'is-on' : ''}`} onClick={() => setTab(k)}>{l}</button>
          ))}
        </nav>
      </div>
      {error && <Notice tone="warn">{error}</Notice>}
      {overview?.provider === 'mock' && <Notice tone="warn"><b>AI_PROVIDER=mock.</b> The backend is returning canned output and placeholder images. Set real keys before running a participant.</Notice>}
      {overview && !overview.web.imported && <Notice tone="warn">The Inspider web is not imported. The Inspider condition will fail. Check INSPIDER_DATA_DIR and restart the backend.</Notice>}

      {tab === 'participants' && (
        <div className="stack">
          <div className="row row--between">
            <span className="muted">{parts.length} participants</span>
            <button className="btn" onClick={() => setCreating(true)}>+ New participant</button>
          </div>
          {creating && <NewParticipantForm onClose={() => setCreating(false)} onCreated={(p) => { setCreating(false); setJustCreated(p); load(); }} />}
          {justCreated && (
            <Notice tone="ok">
              <div className="row row--between">
                <span>Created <b>{justCreated.username}</b> — passcode <code className="code">{justCreated.passcode}</code>. Give both to the participant.</span>
                <button className="btn btn--quiet btn--sm" onClick={() => setJustCreated(null)}>dismiss</button>
              </div>
            </Notice>
          )}
          <div className="tablewrap">
            <table className="table">
              <thead><tr><th>Code</th><th>Passcode</th><th>Name</th><th>Age</th><th>Order</th><th>Status</th><th>Stage</th><th>Ideas</th><th>Ratings</th><th>Cost</th><th>Last seen</th><th /></tr></thead>
              <tbody>
                {parts.map((p) => (
                  <tr key={p.id}>
                    <td><Link to={`/console/participants/${p.id}`}><b>{p.username}</b></Link></td>
                    <td><code className="code">{p.passcode}</code></td>
                    <td>{p.name || '—'}</td>
                    <td>{p.age ?? '—'}</td>
                    <td className="small">{p.condition_order.map((c) => CONDITION_LABEL[c][0]).join(' → ')}</td>
                    <td><span className={`tag tag--${p.status}`}>{p.status}</span></td>
                    <td className="small">{p.session ? `${p.session.stage}${p.session.substage ? '/' + p.session.substage : ''}` : '—'}</td>
                    <td>{p.counts.ideas}</td>
                    <td>{p.counts.ratings}</td>
                    <td className={`small ${p.cost_usd > 3 ? 'warn' : ''}`}>{usd(p.cost_usd)}</td>
                    <td className="small muted">{fmt(p.last_seen_at)}</td>
                    <td>
                      <span className="row">
                        <Link className="btn btn--ghost btn--sm" to={`/console/participants/${p.id}`}>Open</Link>
                        <button type="button" className="btn btn--danger btn--ghost btn--sm" onClick={() => setToDelete(p)}>Delete</button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small">Order: T = Traditional (always first), M = Modern AI, I = Inspider. Odd-numbered participants get T → M → I, even get T → I → M.</p>
          {toDelete && (
            <DeleteParticipantDialog
              participant={toDelete}
              onClose={() => setToDelete(null)}
              onDeleted={() => { setToDelete(null); load(); }}
            />
          )}
        </div>
      )}

      {tab === 'overview' && overview && (
        <div className="stack">
          <div className="stats">
            <Stat label="Participants" v={overview.participants} />
            <Stat label="Completed" v={overview.by_status.completed || 0} />
            <Stat label="Active" v={overview.by_status.active || 0} />
            <Stat label="Ideas" v={overview.ideas} />
            <Stat label="Ratings" v={overview.ratings} />
            <Stat label="Renders" v={overview.renders} />
            <Stat label="AI calls" v={overview.ai_calls} />
            <Stat label="Tokens in / out" v={`${(overview.tokens.input / 1000).toFixed(0)}k / ${(overview.tokens.output / 1000).toFixed(0)}k`} />
            <Stat label="Total spend" v={usd(overview.cost.total_usd)} />
            <Stat label="Per completed participant" v={overview.cost.per_completed_participant_usd == null ? '—' : `${usd(overview.cost.per_completed_participant_usd)} (max ${usd(overview.cost.max_completed_participant_usd)})`} />
          </div>
          <div className="card">
            <h3>Configuration</h3>
            <dl className="kv">
              <dt>AI provider</dt><dd>{overview.provider}</dd>
              <dt>Creative model</dt><dd>{overview.model} <span className="muted small">({(overview.creative_purposes || []).join(', ')})</span></dd>
              <dt>Fast model</dt><dd>{overview.model_fast} <span className="muted small">(everything else)</span></dd>
              <dt>Web searches per phenomena call</dt><dd>{overview.web_search_max_uses}</dd>
              <dt>Images</dt><dd>{overview.image_model} <span className="muted small">(product {overview.image_quality?.product}, in-use {overview.image_quality?.in_use})</span></dd>
              <dt>In-use scene renders</dt>
              <dd>
                <label className="row" style={{ cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={!!overview.study_settings?.render_in_use}
                    disabled={busy}
                    onChange={async (e) => {
                      setBusy(true);
                      try { await api.putStudySettings({ render_in_use: e.target.checked }); await load(); } catch (err) { setError(err.message); } finally { setBusy(false); }
                    }}
                  />
                  <span>{overview.study_settings?.render_in_use ? 'On — product shot + in-use scene per concept' : 'Off — product shot only'}</span>
                </label>
                <span className="muted small">Applies to participants whose renders have not started yet. Adds about $0.17 and 4 minutes per participant.</span>
              </dd>
            </dl>
          </div>
          <CostBreakdown cost={overview.cost} title="Spend by stage (all participants)" />
          <div className="card">
            <h3>The Inspider web</h3>
            {overview.web.imported ? (
              <dl className="kv">
                <dt>Verbs</dt><dd>{overview.web.verbs.toLocaleString()}</dd>
                <dt>Phenomena appended</dt><dd>{overview.web.phenomena.toLocaleString()} across {overview.web.verbs_with_phenomena} verbs</dd>
                <dt>Embedding model</dt><dd>{overview.web.import.model} · {overview.web.import.dimensions}-d · k={overview.web.import.k}</dd>
                <dt>Imported from</dt><dd className="small">{overview.web.import.source_dir}</dd>
              </dl>
            ) : <p className="muted">Not imported.</p>}
          </div>
        </div>
      )}

      {tab === 'web' && <WebTab />}

      {tab === 'export' && (
        <div className="stack">
          <div className="card">
            <h3>Ratings table (CSV)</h3>
            <p className="muted">One row per rating, with the condition resolved. This is the analysis table: novelty, usefulness and feasibility by condition, per participant.</p>
            <button className="btn" onClick={() => download(api.exportCsvUrl(), 'vitis-ratings.csv')}>Download CSV</button>
          </div>
          <div className="card">
            <h3>Everything (JSON)</h3>
            <p className="muted">Every participant, every stage, every AI call with its exact prompt and response, every rating, every image path.</p>
            <button className="btn btn--ghost" onClick={() => download(api.exportJsonUrl(), 'vitis-export.json')}>Download JSON</button>
          </div>
        </div>
      )}

      {tab === 'audit' && <AuditTab />}
    </Layout>
  );
}

export function usd(v) {
  if (v == null) return '—';
  return `$${Number(v).toFixed(2)}`;
}

export function CostBreakdown({ cost, title }) {
  if (!cost) return null;
  const stages = Object.entries(cost.by_stage || {}).sort((a, b) => b[1].usd - a[1].usd);
  const models = Object.entries(cost.by_model || {}).sort((a, b) => b[1].usd - a[1].usd);
  if (!stages.length) return null;
  return (
    <div className="card">
      <h3>{title || 'Spend'} · {usd(cost.total_usd)}</h3>
      <div className="tablewrap">
        <table className="table table--sm">
          <thead><tr><th>Stage</th><th>Calls</th><th>Tokens in → out</th><th>Searches</th><th>USD</th></tr></thead>
          <tbody>
            {stages.map(([k, v]) => (
              <tr key={k}><td>{k}</td><td>{v.calls}</td><td className="small">{v.input_tokens.toLocaleString()} → {v.output_tokens.toLocaleString()}</td><td>{v.searches || '—'}</td><td>{usd(v.usd)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted">By model: {models.map(([m, v]) => `${m} ${usd(v.usd)} (${v.calls} calls)`).join(' · ')}</p>
    </div>
  );
}

function Stat({ label, v }) {
  return <div className="stat"><div className="stat__v">{v}</div><div className="stat__l">{label}</div></div>;
}

export function fmt(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

async function download(url, filename) {
  const res = await fetch(url, { headers: { authorization: `Bearer ${tokens.get('experimenter')}` } });
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function NewParticipantForm({ onClose, onCreated }) {
  const [f, setF] = useState({ name: '', age: '', gender: '', occupation: '', education: '', email: '', notes: '', extra: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const demographics = {};
      for (const line of f.extra.split('\n')) {
        const [k, ...rest] = line.split(':');
        if (k && rest.length) demographics[k.trim()] = rest.join(':').trim();
      }
      const p = await api.createParticipant({ name: f.name || null, age: f.age ? Number(f.age) : null, gender: f.gender || null, occupation: f.occupation || null, education: f.education || null, email: f.email || null, notes: f.notes || null, demographics: Object.keys(demographics).length ? demographics : null });
      onCreated(p);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };
  return (
    <form className="card stack" onSubmit={submit}>
      <div className="row row--between"><h3>New participant</h3><button type="button" className="btn btn--quiet btn--sm" onClick={onClose}>cancel</button></div>
      <p className="muted small">Username and passcode are generated. The condition order is assigned automatically by participant number.</p>
      <div className="grid2">
        <label className="field"><span>Name</span><input className="input" value={f.name} onChange={set('name')} /></label>
        <label className="field"><span>Age</span><input className="input" type="number" min="10" max="99" value={f.age} onChange={set('age')} /></label>
        <label className="field"><span>Gender</span><input className="input" value={f.gender} onChange={set('gender')} /></label>
        <label className="field"><span>Occupation</span><input className="input" value={f.occupation} onChange={set('occupation')} /></label>
        <label className="field"><span>Education</span><input className="input" value={f.education} onChange={set('education')} /></label>
        <label className="field"><span>Email</span><input className="input" type="email" value={f.email} onChange={set('email')} /></label>
      </div>
      <label className="field"><span>Other details <span className="muted">(one per line, key: value)</span></span><textarea className="textarea textarea--sm" rows={2} value={f.extra} onChange={set('extra')} placeholder="city: Bengaluru&#10;design experience: none" /></label>
      <label className="field"><span>Notes</span><input className="input" value={f.notes} onChange={set('notes')} /></label>
      {error && <Notice tone="warn">{error}</Notice>}
      <button className="btn" disabled={busy}>Create and generate code</button>
    </form>
  );
}

function WebTab() {
  const [q, setQ] = useState('');
  const [res, setRes] = useState(null);
  const [phen, setPhen] = useState([]);
  const [error, setError] = useState(null);
  useEffect(() => { api.webPhenomena().then((r) => setPhen(r.phenomena)).catch(() => {}); }, []);
  const search = async (e) => {
    e.preventDefault();
    setError(null);
    try { setRes(await api.webSearch(q)); } catch (err) { setError(err.message); setRes(null); }
  };
  return (
    <div className="stack">
      <form className="row" onSubmit={search}>
        <input className="input" placeholder="look up a verb in the web…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn btn--ghost">Search</button>
      </form>
      {error && <Notice tone="warn">{error}</Notice>}
      {res && (
        <div className="card">
          <div className="row row--between">
            <div><strong className="big">{res.center.lemma}</strong> <span className="muted small">{res.center.gloss}</span></div>
            <span className="muted small">{res.center.cluster_name} · resolved by {res.resolution}</span>
          </div>
          <div className="web-row">
            {res.neighbours.map((n) => <button key={n.node_id} type="button" className="strand" style={{ '--sim': n.sim }} onClick={() => { setQ(n.lemma); api.webSearch(n.lemma).then(setRes); }}><span>{n.lemma}</span><span className="mono small">{n.sim.toFixed(2)}</span>{n.phenomenon_count > 0 && <span className="pip">{n.phenomenon_count}</span>}</button>)}
          </div>
          {res.phenomena.length > 0 && (
            <>
              <h4>Phenomena attached to {res.center.lemma} ({res.phenomena.length})</h4>
              <ul className="small">{res.phenomena.map((p) => <li key={p.id}>{p.title} <span className="tag">{p.domain}</span></li>)}</ul>
            </>
          )}
        </div>
      )}
      <h3>Recently appended phenomena</h3>
      <div className="tablewrap">
        <table className="table">
          <thead><tr><th>Verb</th><th>Phenomenon</th><th>Domain</th><th>By</th><th>When</th></tr></thead>
          <tbody>{phen.map((p) => <tr key={p.id}><td><b>{p.keyword}</b></td><td>{p.title}{p.source_url && <> · <a href={p.source_url} target="_blank" rel="noreferrer" className="small">source</a></>}</td><td><span className="tag">{p.domain}</span></td><td>{p.created_by || '—'}</td><td className="small muted">{fmt(p.created_at)}</td></tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}

function AuditTab() {
  const [rows, setRows] = useState([]);
  useEffect(() => { api.auditLog().then((r) => setRows(r.entries)).catch(() => {}); }, []);
  return (
    <div className="tablewrap">
      <table className="table">
        <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Target</th><th>Details</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.id}><td className="small">{fmt(r.created_at)}</td><td>{r.actor}</td><td>{r.action}</td><td className="small">{r.target_type} {r.target_id}</td><td className="small muted">{r.details ? JSON.stringify(r.details) : ''}</td></tr>)}</tbody>
      </table>
    </div>
  );
}
