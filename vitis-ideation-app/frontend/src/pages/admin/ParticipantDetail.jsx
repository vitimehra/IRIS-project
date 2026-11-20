import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Layout, { Notice, Spinner } from '../../components/Layout.jsx';
import { api } from '../../api/client.js';
import { fmt, usd, CostBreakdown } from './Console.jsx';
import DeleteParticipantDialog from './DeleteParticipantDialog.jsx';

const COND = { traditional: 'Traditional', modern: 'Modern AI', inspider: 'Inspider' };
const ORDERS = [['traditional', 'modern', 'inspider'], ['traditional', 'inspider', 'modern']];

/** Everything about one participant: the summary, every stage, the transcript, every AI call. */
export default function ParticipantDetail({ id, me, logout }) {
  const nav = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('summary');
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(() => api.participantFull(id).then(setData).catch((e) => setError(e.message)), [id]);
  useEffect(() => { load(); }, [load]);

  if (error) return <Layout><Notice tone="warn">{error}</Notice></Layout>;
  if (!data) return <Layout><Spinner label="Loading…" /></Layout>;

  const p = data.participant;
  const s = data.sessions[0] || null;
  const running = s && (s.jobs.concepts?.status === 'running' || s.jobs.renders?.status === 'running');

  const setOrder = async (order) => {
    setBusy(true);
    try { await api.updateParticipant(p.id, { condition_order: order }); await load(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const regen = async () => {
    if (!confirm(`Generate a new passcode for ${p.username}? The old one stops working.`)) return;
    await api.regeneratePasscode(p.id); await load();
  };
  const setStatus = async (status) => { await api.updateParticipant(p.id, { status }); await load(); };

  return (
    <Layout wide right={<span className="row"><span className="muted small">{me.display_name}</span><button className="btn btn--quiet btn--sm" onClick={logout}>Sign out</button></span>}>
      <div className="row row--between">
        <div>
          <p className="eyebrow"><Link to="/console">← all participants</Link></p>
          <h1>{p.username} <span className="muted">{p.name}</span></h1>
        </div>
        <div className="row">
          <span className="tag">{p.status}</span>
          <code className="code">{p.passcode}</code>
          <button className="btn btn--ghost btn--sm" onClick={regen}>New passcode</button>
          {p.status !== 'withdrawn' && <button className="btn btn--ghost btn--sm" onClick={() => setStatus('withdrawn')}>Withdraw</button>}
          <button className="btn btn--danger btn--sm" onClick={() => setDeleting(true)}>Delete</button>
        </div>
      </div>

      <div className="grid2">
        <div className="card">
          <h3>Participant</h3>
          <dl className="kv">
            <dt>Age</dt><dd>{p.age ?? '—'}</dd><dt>Gender</dt><dd>{p.gender || '—'}</dd><dt>Occupation</dt><dd>{p.occupation || '—'}</dd>
            <dt>Education</dt><dd>{p.education || '—'}</dd><dt>Email</dt><dd>{p.email || '—'}</dd>
            {p.demographics && Object.entries(p.demographics).map(([k, v]) => <><dt key={k + 'k'}>{k}</dt><dd key={k + 'v'}>{String(v)}</dd></>)}
            <dt>Consented</dt><dd>{fmt(p.consented_at)}</dd><dt>Created</dt><dd>{fmt(p.created_at)}</dd><dt>Notes</dt><dd>{p.notes || '—'}</dd>
          </dl>
        </div>
        <div className="card">
          <h3>Condition order</h3>
          <p className="muted small">Traditional is always first. The order of the two automatic conditions can be changed until one of them has run.</p>
          <div className="row">
            {ORDERS.map((o) => (
              <button key={o.join()} className={`btn btn--sm ${JSON.stringify(o) === JSON.stringify(p.condition_order) ? '' : 'btn--ghost'}`} disabled={busy} onClick={() => setOrder(o)}>
                {o.map((c) => COND[c]).join(' → ')}
              </button>
            ))}
          </div>
          {s && (
            <>
              <h3 style={{ marginTop: '1rem' }}>Session</h3>
              <dl className="kv">
                <dt>Stage</dt><dd>{s.session.stage}{s.session.substage ? ` / ${s.session.substage}` : ''}</dd>
                <dt>Started</dt><dd>{fmt(s.session.started_at)}</dd><dt>Completed</dt><dd>{fmt(s.session.completed_at)}</dd>
                <dt>Spend so far</dt><dd className={s.cost?.total_usd > 3 ? 'warn' : ''}>{usd(s.cost?.total_usd)}{s.cost?.total_usd > 3 && ' — over the $3 budget'}</dd>
                <dt>Generation</dt><dd>{['phenomena', 'concepts', 'renders'].map((k) => s.jobs[k] ? `${k}: ${s.jobs[k].status} ${s.jobs[k].progress}/${s.jobs[k].total}` : null).filter(Boolean).join(' · ') || '—'}{running && ' (running)'}</dd>
              </dl>
              {(s.jobs.phenomena?.status === 'error' || s.jobs.concepts?.status === 'error' || s.jobs.renders?.status === 'error') && (
                <Notice tone="warn">
                  <div className="row row--between">
                    <span>{s.jobs.phenomena?.error || s.jobs.concepts?.error || s.jobs.renders?.error}</span>
                    <button className="btn btn--sm" disabled={busy} onClick={async () => { setBusy(true); try { await api.retryGeneration(p.id); await load(); } catch (e) { setError(e.message); } finally { setBusy(false); } }}>Retry generation</button>
                  </div>
                </Notice>
              )}
            </>
          )}
        </div>
      </div>

      {!s ? <p className="muted">No session yet — the participant has not logged in.</p> : (
        <>
          <nav className="tabs">
            {[['summary', 'Summary'], ['issue', 'Issue → problem'], ['ideas', 'Ideas'], ['concepts', 'Concepts & renders'], ['inspider', 'Inspider path'], ['transcript', 'Transcript'], ['ai', `AI calls (${s.ai_calls.length})`]].map(([k, l]) => (
              <button key={k} className={`tab ${tab === k ? 'is-on' : ''}`} onClick={() => setTab(k)}>{l}</button>
            ))}
          </nav>

          {tab === 'summary' && <Summary s={s} />}
          {tab === 'issue' && <IssueTab s={s} />}
          {tab === 'ideas' && <IdeasTab s={s} />}
          {tab === 'concepts' && <ConceptsTab s={s} />}
          {tab === 'inspider' && <InspiderTab s={s} />}
          {tab === 'transcript' && <Transcript s={s} />}
          {tab === 'ai' && <AICalls s={s} />}
        </>
      )}
      {deleting && (
        <DeleteParticipantDialog
          participant={p}
          onClose={() => setDeleting(false)}
          onDeleted={() => nav('/console')}
        />
      )}
    </Layout>
  );
}

function Summary({ s }) {
  const conds = ['traditional', 'modern', 'inspider'];
  const types = [['idea', 'Ideas'], ['concept', 'Concepts'], ['render', 'Renders']];
  const has = Object.keys(s.summary).length > 0;
  return (
    <div className="stack">
      <CostBreakdown cost={s.cost} title="Spend by stage" />
      <p className="muted">Mean rating (1–5) by condition. The hypothesis is that the Inspider column is more novel.</p>
      {!has ? <p className="muted">No ratings yet.</p> : (
        <div className="tablewrap"><table className="table table--summary">
          <thead><tr><th /><th>Condition</th><th>n</th><th>Novelty</th><th>Usefulness</th><th>Feasibility</th></tr></thead>
          <tbody>
            {types.map(([t, label]) => conds.map((c, i) => {
              const r = s.summary[c]?.[t];
              return <tr key={t + c} className={c === 'inspider' ? 'is-hl' : ''}>{i === 0 && <td rowSpan={3}><b>{label}</b></td>}<td>{COND[c]}</td><td>{r?.n ?? '—'}</td><td>{r?.novelty ?? '—'}</td><td>{r?.usefulness ?? '—'}</td><td>{r?.feasibility ?? '—'}</td></tr>;
            }))}
          </tbody>
        </table></div>
      )}
      <h3>Stage timings</h3>
      <div className="tablewrap"><table className="table"><thead><tr><th>Stage</th><th>Entered</th><th>Left</th><th>Minutes</th></tr></thead><tbody>
        {Object.entries(s.session.stage_timings || {}).map(([k, v]) => <tr key={k}><td>{k}</td><td className="small">{fmt(v.entered)}</td><td className="small">{fmt(v.left)}</td><td>{v.entered && v.left ? ((new Date(v.left) - new Date(v.entered)) / 60000).toFixed(1) : '—'}</td></tr>)}
      </tbody></table></div>
    </div>
  );
}

function IssueTab({ s }) {
  const sel = s.problems.find((p) => p.selected);
  return (
    <div className="stack">
      <div className="card"><h3>What they said</h3>{s.issue_inputs.map((i) => <p key={i.id} className="quote">{i.text} <span className="muted small">({i.input_mode}{i.duration_ms ? `, ${(i.duration_ms / 1000).toFixed(0)}s` : ''})</span></p>)}</div>
      <h3>CAE issues</h3>
      {s.cae_issues.map((i) => (
        <div key={i.id} className={`card ${i.confirmed ? '' : 'is-removed'}`}>
          <div className="row row--between"><strong>{i.headline}</strong><span className="row">{i.edited && <span className="tag tag--warn">edited by participant</span>}{!i.confirmed && <span className="tag">removed</span>}</span></div>
          <Cae c={i.cause} a={i.affect} e={i.effect} />
          {i.edited && i.ai_version && <details><summary className="small muted">AI's original</summary><Cae c={i.ai_version.cause} a={i.ai_version.affect} e={i.ai_version.effect} /></details>}
        </div>
      ))}
      <h3>Problems</h3>
      {s.problems.map((p) => (
        <div key={p.id} className={`card ${p.selected ? 'is-hl' : ''}`}>
          <div className="row row--between"><strong>{p.statement}</strong>{p.selected && <span className="tag tag--ok">selected</span>}</div>
          <p className="muted small">{p.rationale}</p>
          {p.selected && <div className="strip"><span><b>Action</b> {p.action}</span><span><b>Object</b> {p.object}</span><span><b>Party</b> {p.party}</span><span><b>Context</b> {p.context}</span>{p.aopc_edited && <span className="tag tag--warn">edited</span>}</div>}
        </div>
      ))}
      {!sel && <p className="muted">No problem selected yet.</p>}
    </div>
  );
}

function Cae({ c, a, e }) {
  return <div className="cae-mini"><span><b>Cause</b> {c}</span><span><b>Affect</b> {a}</span><span><b>Effect</b> {e}</span></div>;
}

function Stars({ r }) {
  if (!r) return <span className="muted small">unrated</span>;
  return <span className="mono small">N {r.novelty} · U {r.usefulness} · F {r.feasibility}{r.comment ? ` · “${r.comment}”` : ''}</span>;
}

function IdeasTab({ s }) {
  return (
    <div className="grid3">
      {['traditional', 'modern', 'inspider'].map((c) => (
        <div key={c} className="stack-sm">
          <h3>{COND[c]}</h3>
          {s.ideas.filter((i) => i.condition === c).map((i) => (
            <div key={i.id} className="card card--sm">
              <strong>{i.ordinal}. {i.title}</strong>
              {i.raw_text && <p className="quote small">{i.raw_text}</p>}
              <div className="slot"><span className="slot__label">Principle</span><p className="small">{i.principle}</p></div>
              <div className="slot"><span className="slot__label">Phenomenon</span><p className="small">{i.phenomenon}</p></div>
              {i.inspired_by?.phenomenon_ids?.length > 0 && <p className="muted small">inspired by phenomena {i.inspired_by.phenomenon_ids.join(', ')}{i.inspired_by.transfer ? ` — ${i.inspired_by.transfer}` : ''}</p>}
              <Stars r={i.rating} />
            </div>
          ))}
          {s.ideas.filter((i) => i.condition === c).length === 0 && <p className="muted small">not yet</p>}
        </div>
      ))}
    </div>
  );
}

function ConceptsTab({ s }) {
  return (
    <div className="stack">
      {s.concepts.map((c) => (
        <div key={c.id} className="card">
          <div className="row row--between"><strong>{c.title}</strong><span className="tag">{COND[c.condition]}</span></div>
          <p>{c.object}</p>
          <ul className="small">{(c.characteristics || []).map((x, i) => <li key={i}>{x}</li>)}</ul>
          <p className="muted small">{c.how_it_works}</p>
          <div className="renders renders--sm">
            {c.renders.map((r) => (
              <figure key={r.id}>
                {r.status === 'ok' && r.url ? <img src={api.imageUrl(r.url, 'experimenter')} alt={`${c.title} ${r.kind}`} /> : <div className="img-missing">{r.status}{r.error ? `: ${r.error.slice(0, 80)}` : ''}</div>}
                <figcaption className="muted small">{r.kind} · {r.model}</figcaption>
                <details><summary className="small muted">prompt</summary><p className="small">{r.prompt}</p></details>
              </figure>
            ))}
          </div>
          <div className="row"><span className="small">Concept: <Stars r={c.rating} /></span><span className="small">Render: <Stars r={c.render_rating} /></span></div>
        </div>
      ))}
      {s.concepts.length === 0 && <p className="muted">No concepts yet.</p>}
    </div>
  );
}

function InspiderTab({ s }) {
  const roots = s.keywords.filter((k) => k.source !== 'neighbour');
  const kids = (id) => s.keywords.filter((k) => k.parent_keyword_id === id);
  const phenFor = (kid) => s.phenomena.filter((p) => p.keyword_id === kid);
  if (roots.length === 0) return <p className="muted">The Inspider condition has not run yet.</p>;
  return (
    <div className="stack">
      {roots.map((k) => (
        <div key={k.id} className={`card ${k.selected ? '' : 'is-removed'}`}>
          <div className="row row--between">
            <div><strong className="big">{k.text}</strong>{k.resolved_lemma && k.resolved_lemma !== k.text && <span className="tag">→ {k.resolved_lemma} ({k.resolution} {k.resolution_score?.toFixed(2)})</span>} <span className="tag">{k.source}</span></div>
            {!k.selected ? <span className="tag">not kept</span> : k.final ? <span className="tag tag--ok">searched</span> : <span className="tag">set aside by distance</span>}
          </div>
          <p className="muted small">{k.rationale}</p>
          <PhenList items={phenFor(k.id)} />
          {kids(k.id).map((n) => (
            <div key={n.id} className="card card--sm nested">
              <strong>{n.resolved_lemma}</strong> <span className="mono small">sim {n.similarity_to_parent?.toFixed(2)}</span>{' '}{n.final ? <span className="tag tag--ok">searched</span> : <span className="tag">set aside by distance</span>}
              <PhenList items={phenFor(n.id)} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function PhenList({ items }) {
  if (!items.length) return null;
  return <ul className="phen small">{items.map((p) => <li key={p.id}><strong>{p.title}</strong> <span className="tag">{p.domain}</span>{!p.fresh && <span className="tag tag--muted">inherited</span>}<br />{p.description}{p.source_url && <> <a href={p.source_url} target="_blank" rel="noreferrer">source</a></>}</li>)}</ul>;
}

function Transcript({ s }) {
  return (
    <ol className="transcript">
      {s.transcript.map((ev) => (
        <li key={ev.id} className={`tr tr--${ev.actor}`}>
          <div className="tr__meta"><span className="tag">{ev.actor}</span> <b>{ev.kind}</b> <span className="muted small">{ev.stage} · {fmt(ev.created_at)}</span></div>
          {ev.payload && <pre className="pre">{JSON.stringify(ev.payload, null, 1)}</pre>}
        </li>
      ))}
    </ol>
  );
}

function AICalls({ s }) {
  return (
    <div className="stack-sm">
      {s.ai_calls.map((c) => (
        <details key={c.id} className="card card--sm">
          <summary><b>{c.purpose}</b> <span className="muted small">{c.stage} · {c.provider}/{c.model} · {c.status}{c.input_tokens ? ` · ${c.input_tokens}→${c.output_tokens} tok` : ''}{c.response?.search_count ? ` · ${c.response.search_count} searches` : ''}{c.request?.quality ? ` · ${c.request.quality}` : ''} · {c.latency_ms} ms · {fmt(c.created_at)}</span></summary>
          {c.error && <Notice tone="warn">{c.error}</Notice>}
          <h4>Request</h4><pre className="pre">{typeof c.request?.prompt === 'string' ? c.request.prompt : JSON.stringify(c.request, null, 1)}</pre>
          <h4>Response</h4><pre className="pre">{JSON.stringify(c.response?.parsed ?? c.response, null, 1)}</pre>
          {c.response?.searches?.length > 0 && <><h4>Web searches</h4><ul className="small">{c.response.searches.map((q, i) => <li key={i}>{q.query}{q.results && <ul>{q.results.map((r, j) => <li key={j}><a href={r.url} target="_blank" rel="noreferrer">{r.title || r.url}</a></li>)}</ul>}</li>)}</ul></>}
        </details>
      ))}
    </div>
  );
}
