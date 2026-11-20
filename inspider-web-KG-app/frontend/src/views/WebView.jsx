import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { useStore } from '../state/store.jsx';
import { clusterCss, strandStyle } from '../utils/colors.js';

/**
 * The web itself. The selected verb sits at the hub; its neighbours hang on
 * concentric rings by similarity, exactly like the spider web on slide 1 of
 * the session deck. Cross-strands between neighbours that are also close to
 * each other give the web its texture.
 *
 * Layout is computed here rather than by a force simulation: a radial layout
 * encodes similarity as distance from the hub directly, which is the point.
 */

const RING_COUNT = 4;
const R_MIN = 110;
const R_MAX = 420;

function polar(r, theta) {
  return [r * Math.cos(theta), r * Math.sin(theta)];
}

function layout(ego) {
  if (!ego) return { positions: new Map(), rings: [], lo: 0, hi: 1 };
  const byHop = { 1: [], 2: [], 3: [] };
  const simTo = new Map();
  for (const e of ego.edges) {
    if (e.source === ego.center && !e.cross) simTo.set(e.target, e.sim);
    if (e.target === ego.center && !e.cross) simTo.set(e.source, e.sim);
  }
  for (const n of ego.nodes) if (n.hop > 0) byHop[n.hop]?.push(n);

  const hop1 = byHop[1].map((n) => ({ ...n, sim: simTo.get(n.id) ?? 0 })).sort((a, b) => b.sim - a.sim);
  const sims = hop1.map((n) => n.sim);
  const hi = sims.length ? Math.max(...sims) : 1;
  const lo = sims.length ? Math.min(...sims) : 0;
  const span = Math.max(1e-6, hi - lo);

  const positions = new Map();
  positions.set(ego.center, { x: 0, y: 0, r: 0 });

  // Hop 1: radius by similarity, angle spread evenly in rank order so the
  // closest sit together rather than on opposite sides of the hub.
  hop1.forEach((n, i) => {
    const t = (n.sim - lo) / span; // 1 = closest
    const r = R_MIN + (1 - t) * (R_MAX - R_MIN) * 0.72;
    const theta = (i / hop1.length) * Math.PI * 2 - Math.PI / 2;
    const [x, y] = polar(r, theta);
    positions.set(n.id, { x, y, r, theta, sim: n.sim });
  });

  // Hop 2: outside their parent, fanned around the parent's angle.
  const parentOf = new Map();
  for (const e of ego.edges) {
    if (e.cross) continue;
    const a = positions.has(e.source) ? e.source : null;
    const b = positions.has(e.target) ? e.target : null;
    if (a !== null && !positions.has(e.target)) parentOf.set(e.target, a);
    if (b !== null && !positions.has(e.source)) parentOf.set(e.source, b);
  }
  const children = new Map();
  for (const n of byHop[2]) {
    const p = parentOf.get(n.id);
    if (p === undefined) continue;
    if (!children.has(p)) children.set(p, []);
    children.get(p).push(n);
  }
  for (const [p, kids] of children) {
    const pp = positions.get(p);
    const base = pp.theta ?? 0;
    const fan = Math.min(0.9, 0.16 * kids.length);
    kids.forEach((k, i) => {
      const theta = base + (kids.length === 1 ? 0 : -fan / 2 + (i / (kids.length - 1)) * fan);
      const r = R_MAX + 60 + (i % 2) * 40;
      const [x, y] = polar(r, theta);
      positions.set(k.id, { x, y, r, theta });
    });
  }

  const rings = Array.from({ length: RING_COUNT }, (_, i) => {
    const t = (i + 1) / RING_COUNT;
    return { r: R_MIN + (1 - t) * (R_MAX - R_MIN) * 0.72 + (i === RING_COUNT - 1 ? 0 : 0), sim: lo + t * span };
  });

  return { positions, rings, lo, hi };
}

export default function WebView() {
  const { selected, select, webSettings, setWebSettings, includeUnverified, notify } = useStore();
  const [ego, setEgo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [hover, setHover] = useState(null);
  const [view, setView] = useState({ x: 0, y: 0, z: 1 });
  const dragging = useRef(null);
  const svgRef = useRef(null);

  useEffect(() => {
    if (!selected) return;
    let dead = false;
    setLoading(true);
    api
      .ego(selected.lemma, webSettings.k, webSettings.depth, webSettings.minSim, includeUnverified)
      .then((e) => !dead && setEgo(e))
      .catch((e) => notify(e.message))
      .finally(() => !dead && setLoading(false));
    setView({ x: 0, y: 0, z: 1 });
    return () => {
      dead = true;
    };
  }, [selected?.id, webSettings.k, webSettings.depth, webSettings.minSim, includeUnverified]);

  const { positions, rings, lo, hi } = useMemo(() => layout(ego), [ego]);

  const onWheel = (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    setView((v) => ({ ...v, z: Math.max(0.3, Math.min(4, v.z * factor)) }));
  };
  const onDown = (e) => {
    dragging.current = { sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y };
  };
  const onMove = (e) => {
    if (!dragging.current) return;
    const d = dragging.current;
    setView((v) => ({ ...v, x: d.ox + (e.clientX - d.sx) / v.z, y: d.oy + (e.clientY - d.sy) / v.z }));
  };
  const onUp = () => {
    dragging.current = null;
  };

  if (!selected) {
    return (
      <div className="stage stage--empty">
        <div className="empty">
          <div className="empty__web" aria-hidden="true">
            <svg viewBox="-220 -220 440 440" width="320" height="320">
              <g fill="none" stroke="currentColor" strokeWidth="0.7" opacity="0.5">
                {[50, 95, 140, 185].map((r) => <circle key={r} r={r} />)}
                {Array.from({ length: 12 }, (_, i) => (
                  <line key={i} x1="0" y1="0" x2="0" y2="-200" transform={`rotate(${i * 30})`} />
                ))}
              </g>
            </svg>
          </div>
          <h2>Pick a verb to hang the web from</h2>
          <p className="muted">Search above, or try <button className="link" onClick={() => select('rise')}>rise</button>, <button className="link" onClick={() => select('cook')}>cook</button>, <button className="link" onClick={() => select('wake')}>wake</button>.</p>
        </div>
      </div>
    );
  }

  const nodes = ego?.nodes || [];
  const edges = ego?.edges || [];

  return (
    <div className="stage">
      <div className="controls">
        <label>
          strands <span className="mono">{webSettings.k}</span>
          <input type="range" min="5" max="60" value={webSettings.k} onChange={(e) => setWebSettings((s) => ({ ...s, k: Number(e.target.value) }))} />
        </label>
        <label>
          depth
          <select value={webSettings.depth} onChange={(e) => setWebSettings((s) => ({ ...s, depth: Number(e.target.value) }))}>
            <option value={1}>1 hop</option>
            <option value={2}>2 hops</option>
          </select>
        </label>
        <label>
          min sim <span className="mono">{webSettings.minSim.toFixed(2)}</span>
          <input type="range" min="0" max="0.95" step="0.01" value={webSettings.minSim} onChange={(e) => setWebSettings((s) => ({ ...s, minSim: Number(e.target.value) }))} />
        </label>
        <span className="muted small">{nodes.length} nodes · {edges.length} strands{loading ? ' · loading…' : ''}</span>
        <button className="btn btn--ghost btn--sm" onClick={() => setView({ x: 0, y: 0, z: 1 })}>reset view</button>
      </div>

      <svg
        ref={svgRef}
        className="web"
        viewBox="-560 -420 1120 840"
        onWheel={onWheel}
        onMouseDown={onDown}
        onMouseMove={onMove}
        onMouseUp={onUp}
        onMouseLeave={onUp}
      >
        <g transform={`scale(${view.z}) translate(${view.x} ${view.y})`}>
          {/* ring guides labelled with the similarity they represent */}
          {rings.map((ring, i) => (
            <g key={i} className="ring">
              <circle r={ring.r} />
              <text x={ring.r + 6} y={-4} className="ring__label">{ring.sim.toFixed(2)}</text>
            </g>
          ))}
          {/* radial guide lines, sparse */}
          {Array.from({ length: 8 }, (_, i) => (
            <line key={i} className="spoke" x1="0" y1="0" x2="0" y2={-R_MAX * 0.9} transform={`rotate(${i * 45})`} />
          ))}

          {edges.map((e, i) => {
            const a = positions.get(e.source);
            const b = positions.get(e.target);
            if (!a || !b) return null;
            const st = strandStyle(e.sim, lo, hi);
            const hot = hover && (hover.id === e.source || hover.id === e.target);
            return (
              <line
                key={i}
                className={`strand ${e.cross ? 'strand--cross' : ''} ${hot ? 'strand--hot' : ''}`}
                x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                style={{ strokeOpacity: hot ? 1 : st.opacity * (e.cross ? 0.45 : 1), strokeWidth: st.width }}
              >
                <title>{`${nodes.find((n) => n.id === e.source)?.lemma} — ${nodes.find((n) => n.id === e.target)?.lemma}: ${e.sim.toFixed(3)}`}</title>
              </line>
            );
          })}

          {nodes.map((n) => {
            const p = positions.get(n.id);
            if (!p) return null;
            const isHub = n.id === ego.center;
            const r = isHub ? 14 : 4 + n.size * 2.2 - (n.hop === 2 ? 1.5 : 0);
            return (
              <g
                key={n.id}
                className={`node ${isHub ? 'node--hub' : ''} ${n.unverified ? 'node--unverified' : ''}`}
                transform={`translate(${p.x} ${p.y})`}
                onMouseEnter={() => setHover({ ...n, sim: p.sim })}
                onMouseLeave={() => setHover(null)}
                onClick={(e) => { e.stopPropagation(); if (!isHub) select(n.lemma); }}
              >
                <circle r={r} style={{ fill: clusterCss(n.cluster_id), stroke: isHub ? 'var(--accent)' : 'var(--ground)' }} />
                <text
                  className={`node__label ${isHub ? 'node__label--hub' : ''}`}
                  y={isHub ? 30 : r + 12}
                  textAnchor="middle"
                >
                  {n.lemma}
                </text>
                {!isHub && p.sim !== undefined && (
                  <text className="node__sim" y={r + 24} textAnchor="middle">{p.sim.toFixed(2)}</text>
                )}
              </g>
            );
          })}
        </g>
      </svg>

      {hover && hover.id !== ego?.center && (
        <div className="hovercard">
          <strong>{hover.lemma}</strong>
          {hover.sim !== undefined && <span className="mono"> {hover.sim.toFixed(3)}</span>}
          <div className="muted small">hop {hover.hop} · click to re-centre</div>
        </div>
      )}
    </div>
  );
}
