import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { useStore } from '../state/store.jsx';
import SearchBox from '../components/SearchBox.jsx';
import { clusterCss } from '../utils/colors.js';

const TOOLS = [
  ['path', 'Path', 'The shortest chain of near-synonyms between two verbs.'],
  ['walk', 'Serendipity walk', 'Wander the web from one verb and land somewhere connected but far.'],
  ['analogy', 'Analogy', 'Vector arithmetic: rise − sun + moon → ?'],
  ['compare', 'Compare', 'Two verbs side by side: score, shared strands, overlap.'],
];

function Chain({ nodes, edges, onPick }) {
  return (
    <ol className="chain">
      {nodes.map((n, i) => (
        <li key={n.id}>
          <button className="chain__node" style={{ borderColor: clusterCss(n.cluster_id) }} onClick={() => onPick(n.lemma)}>
            {n.lemma}
          </button>
          {i < edges.length && <span className="chain__edge mono">{edges[i].sim.toFixed(2)}</span>}
        </li>
      ))}
    </ol>
  );
}

function PathTool() {
  const { pathEnds, setPathEnds, select, notify } = useStore();
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (!pathEnds.from || !pathEnds.to) return;
    setBusy(true);
    try {
      setResult(await api.path(pathEnds.from, pathEnds.to));
    } catch (e) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (pathEnds.from && pathEnds.to) run();
  }, [pathEnds.from, pathEnds.to]);

  return (
    <div className="tool">
      <div className="tool__form">
        <SearchBox compact placeholder="from…" value={pathEnds.from} onChange={(v) => setPathEnds((p) => ({ ...p, from: v }))} onPick={(r) => setPathEnds((p) => ({ ...p, from: r.lemma }))} />
        <span className="muted">→</span>
        <SearchBox compact placeholder="to…" value={pathEnds.to} onChange={(v) => setPathEnds((p) => ({ ...p, to: v }))} onPick={(r) => setPathEnds((p) => ({ ...p, to: r.lemma }))} />
        <button className="btn" onClick={run} disabled={busy || !pathEnds.from || !pathEnds.to}>{busy ? '…' : 'Find path'}</button>
      </div>
      {result && !result.found && <p className="notice notice--warn">No path: those verbs sit in disconnected parts of the web.</p>}
      {result?.found && (
        <>
          <p className="muted small">{result.hops} hops · total dissimilarity {result.cost.toFixed(2)}. Each number is the similarity of that strand.</p>
          <Chain nodes={result.nodes} edges={result.edges} onPick={select} />
        </>
      )}
    </div>
  );
}

function WalkTool() {
  const { selected, select, includeUnverified, notify } = useStore();
  const [start, setStart] = useState(selected?.lemma || '');
  const [steps, setSteps] = useState(6);
  const [temp, setTemp] = useState(0.5);
  const [avoid, setAvoid] = useState(true);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (selected?.lemma && !start) setStart(selected.lemma);
  }, [selected?.lemma]);

  const run = async () => {
    if (!start) return;
    setBusy(true);
    try {
      setResult(await api.walk(start, steps, temp, avoid, includeUnverified, undefined));
    } catch (e) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="tool">
      <div className="tool__form">
        <SearchBox compact placeholder="start from…" value={start} onChange={setStart} onPick={(r) => setStart(r.lemma)} />
        <label className="inline">steps <input type="range" min="2" max="20" value={steps} onChange={(e) => setSteps(Number(e.target.value))} /> <span className="mono">{steps}</span></label>
        <label className="inline" title="Low: hug the closest strands. High: wander freely.">wander <input type="range" min="0.1" max="2" step="0.1" value={temp} onChange={(e) => setTemp(Number(e.target.value))} /> <span className="mono">{temp.toFixed(1)}</span></label>
        <label className="toggle"><input type="checkbox" checked={avoid} onChange={(e) => setAvoid(e.target.checked)} /><span>leave the region</span></label>
        <button className="btn" onClick={run} disabled={busy || !start}>{busy ? '…' : result ? 'Walk again' : 'Walk'}</button>
      </div>
      <p className="muted small">
        This is the ideation mechanic. Start from a phenomenon you know; end on one you did not think to connect it to.
        &ldquo;Leave the region&rdquo; nudges the walk out of the starting verb&rsquo;s own cluster, where the surprising analogies live.
      </p>
      {result && (
        <>
          <Chain nodes={result.nodes} edges={result.edges} onPick={select} />
          <p className="muted small">
            Landed on <strong>{result.nodes[result.nodes.length - 1].lemma}</strong>, whose direct similarity to <strong>{result.nodes[0].lemma}</strong> is{' '}
            <span className="mono">{result.end_similarity_to_start.toFixed(3)}</span> — connected by the chain, far by the vector.
          </p>
        </>
      )}
    </div>
  );
}

function AnalogyTool() {
  const { select, includeUnverified, notify, meta } = useStore();
  const [pos, setPos] = useState([]);
  const [neg, setNeg] = useState([]);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (!pos.length) return;
    setBusy(true);
    try {
      setResult(await api.analogy(pos, neg, 12, includeUnverified));
    } catch (e) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  };

  const Chips = ({ items, setItems, tone }) => (
    <div className="chips chips--inline">
      {items.map((v) => (
        <button key={v} className={`chip chip--${tone}`} onClick={() => setItems(items.filter((x) => x !== v))} title="remove">{v} ×</button>
      ))}
    </div>
  );

  return (
    <div className="tool">
      <div className="tool__form tool__form--stack">
        <div className="row">
          <span className="label label--pos">+</span>
          <Chips items={pos} setItems={setPos} tone="pos" />
          <SearchBox compact placeholder="add a positive verb…" value="" onPick={(r) => setPos((p) => (p.includes(r.lemma) ? p : [...p, r.lemma]))} />
        </div>
        <div className="row">
          <span className="label label--neg">−</span>
          <Chips items={neg} setItems={setNeg} tone="neg" />
          <SearchBox compact placeholder="add a negative verb…" value="" onPick={(r) => setNeg((p) => (p.includes(r.lemma) ? p : [...p, r.lemma]))} />
        </div>
        <button className="btn" onClick={run} disabled={busy || !pos.length}>{busy ? '…' : 'Solve'}</button>
      </div>
      <p className="muted small">
        Adds the positive vectors, subtracts the negative ones, and finds the verbs nearest the result. The inputs themselves are excluded.
        {meta?.dev_embeddings && ' With dev embeddings this is meaningless.'}
      </p>
      {result && (
        <ul className="ranked">
          {result.results.map((r, i) => (
            <li key={r.id}>
              <span className="mono muted">{i + 1}</span>
              <button className="link link--big" onClick={() => select(r.lemma)}>{r.lemma}</button>
              <span className="mono">{r.sim.toFixed(3)}</span>
              <span className="dot" style={{ background: clusterCss(r.cluster_id) }} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CompareTool() {
  const { selected, select, notify } = useStore();
  const [a, setA] = useState(selected?.lemma || '');
  const [b, setB] = useState('');
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (!a || !b) return;
    api.compare(a, b).then(setResult).catch((e) => notify(e.message));
  }, [a, b]);

  return (
    <div className="tool">
      <div className="tool__form">
        <SearchBox compact placeholder="first verb…" value={a} onChange={setA} onPick={(r) => setA(r.lemma)} />
        <span className="muted">vs</span>
        <SearchBox compact placeholder="second verb…" value={b} onChange={setB} onPick={(r) => setB(r.lemma)} />
      </div>
      {result && (
        <div className="compare">
          <div className="compare__score">
            <div className="big mono">{result.similarity.toFixed(3)}</div>
            <div className="muted small">cosine similarity · {result.same_cluster ? 'same region' : 'different regions'} · Jaccard of neighbourhoods {result.jaccard.toFixed(2)}</div>
          </div>
          <div className="compare__cols">
            {[result.a, result.b].map((v) => (
              <div key={v.id} className="compare__col">
                <button className="link link--big" onClick={() => select(v.lemma)}>{v.lemma}</button>
                <p className="small">{v.gloss || <span className="muted">no definition</span>}</p>
                <p className="muted small">{v.cluster_name}</p>
              </div>
            ))}
          </div>
          <h3>Shared strands ({result.shared_neighbours.length})</h3>
          {result.shared_neighbours.length === 0 ? (
            <p className="muted small">No neighbour in common among each verb&rsquo;s top 50.</p>
          ) : (
            <ul className="ranked">
              {result.shared_neighbours.slice(0, 20).map((n) => (
                <li key={n.id}>
                  <button className="link" onClick={() => select(n.lemma)}>{n.lemma}</button>
                  <span className="mono small">{n.sim_a.toFixed(2)} / {n.sim_b.toFixed(2)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export default function ToolsView() {
  const { tool, setTool } = useStore();
  return (
    <div className="stage stage--tools">
      <nav className="subnav">
        {TOOLS.map(([key, label, blurb]) => (
          <button key={key} className={`subnav__item ${tool === key ? 'subnav__item--on' : ''}`} onClick={() => setTool(key)} title={blurb}>
            {label}
          </button>
        ))}
      </nav>
      <p className="muted">{TOOLS.find((t) => t[0] === tool)?.[2]}</p>
      {tool === 'path' && <PathTool />}
      {tool === 'walk' && <WalkTool />}
      {tool === 'analogy' && <AnalogyTool />}
      {tool === 'compare' && <CompareTool />}
    </div>
  );
}
