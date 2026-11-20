import { useEffect, useMemo, useState } from 'react';
import DeckGL from '@deck.gl/react';
import { OrthographicView } from '@deck.gl/core';
import { ScatterplotLayer, TextLayer, LineLayer } from '@deck.gl/layers';
import { api } from '../api/client.js';
import { useStore } from '../state/store.jsx';
import { clusterRgb } from '../utils/colors.js';

/**
 * Every verb as a point on the UMAP projection, WebGL-rendered so a hundred
 * thousand points pan and zoom smoothly. Labels are semantic-zoom: at low zoom
 * only the most frequent verbs and the cluster names show; zooming in reveals
 * more. Selecting a verb draws its strands over the map.
 */

const INITIAL_VIEW = { target: [0, 0, 0], zoom: 1.6 };

export default function MapView() {
  const { selected, select, includeUnverified, notify, setMode } = useStore();
  const [points, setPoints] = useState(null);
  const [clusters, setClusters] = useState([]);
  const [viewState, setViewState] = useState(INITIAL_VIEW);
  const [ego, setEgo] = useState(null);
  const [hover, setHover] = useState(null);
  const [viewSize, setViewSize] = useState([1200, 800]);

  useEffect(() => {
    let dead = false;
    Promise.all([api.map(includeUnverified), api.clusters()])
      .then(([m, c]) => {
        if (dead) return;
        const data = m.ids.map((id, i) => ({
          id,
          lemma: m.lemmas[i],
          x: m.x[i],
          y: m.y[i],
          cluster: m.cluster[i],
          size: m.size[i],
          zipf: m.zipf[i],
        }));
        setPoints(data);
        setClusters(c.clusters);
      })
      .catch((e) => notify(e.message));
    return () => {
      dead = true;
    };
  }, [includeUnverified]);

  useEffect(() => {
    if (!selected) {
      setEgo(null);
      return;
    }
    api.ego(selected.lemma, 25, 1, 0, includeUnverified).then(setEgo).catch(() => setEgo(null));
    // fly to the selected verb
    setViewState((v) => ({ ...v, target: [selected.x, selected.y, 0], zoom: Math.max(v.zoom, 3.2), transitionDuration: 500 }));
  }, [selected?.id, includeUnverified]);

  const byId = useMemo(() => {
    const m = new Map();
    for (const p of points || []) m.set(p.id, p);
    return m;
  }, [points]);

  const egoIds = useMemo(() => new Set(ego ? ego.nodes.map((n) => n.id) : []), [ego]);

  // Label budget: only verbs inside the viewport, most frequent first, capped
  // by a count that grows with zoom. A threshold alone floods the map at
  // moderate zoom; a count cap keeps it legible at every level.
  const [vw, vh] = viewSize;
  const labelData = useMemo(() => {
    if (!points) return [];
    const scale = Math.pow(2, viewState.zoom); // pixels per world unit
    const [tx, ty] = viewState.target;
    const halfW = (vw / scale) * 0.55;
    const halfH = (vh / scale) * 0.55;
    const inView = points.filter(
      (p) => p.x > tx - halfW && p.x < tx + halfW && p.y > ty - halfH && p.y < ty + halfH
    );
    const cap = Math.round(40 * Math.pow(viewState.zoom, 2.2));
    const ranked = inView.slice().sort((a, b) => b.zipf - a.zipf);
    const chosen = ranked.slice(0, cap);
    const chosenIds = new Set(chosen.map((p) => p.id));
    for (const p of inView) if (egoIds.has(p.id) && !chosenIds.has(p.id)) chosen.push(p);
    return chosen;
  }, [points, viewState.zoom, viewState.target, vw, vh, egoIds]);

  const layers = useMemo(() => {
    if (!points) return [];
    const dim = (p) => (egoIds.size > 0 && !egoIds.has(p.id) ? 70 : 210);

    return [
      new ScatterplotLayer({
        id: 'verbs',
        data: points,
        getPosition: (d) => [d.x, d.y],
        getRadius: (d) => 0.18 + d.size * 0.12,
        radiusUnits: 'common',
        radiusMinPixels: 1.5,
        radiusMaxPixels: 14,
        getFillColor: (d) => [...clusterRgb(d.cluster), dim(d)],
        getLineColor: [10, 12, 20, 200],
        lineWidthMinPixels: selected ? 0 : 0,
        pickable: true,
        onHover: (info) => setHover(info.object || null),
        onClick: (info) => info.object && select(info.object.lemma),
        updateTriggers: { getFillColor: [egoIds] },
      }),
      ego &&
        new LineLayer({
          id: 'strands',
          data: ego.edges.filter((e) => !e.cross),
          getSourcePosition: (e) => {
            const p = byId.get(e.source);
            return p ? [p.x, p.y] : [0, 0];
          },
          getTargetPosition: (e) => {
            const p = byId.get(e.target);
            return p ? [p.x, p.y] : [0, 0];
          },
          getColor: (e) => [255, 159, 28, 60 + Math.round(e.sim * 160)],
          getWidth: 1.2,
          widthUnits: 'pixels',
        }),
      selected &&
        new ScatterplotLayer({
          id: 'selected',
          data: [selected],
          getPosition: (d) => [d.x, d.y],
          getRadius: 0.6,
          radiusUnits: 'common',
          radiusMinPixels: 7,
          getFillColor: [255, 159, 28, 255],
          getLineColor: [10, 12, 20, 255],
          lineWidthMinPixels: 2,
          stroked: true,
        }),
      new TextLayer({
        id: 'cluster-names',
        data: clusters,
        getPosition: (c) => [c.cx, c.cy],
        getText: (c) => c.name,
        getSize: 13,
        sizeUnits: 'pixels',
        getColor: [232, 230, 223, viewState.zoom < 3.5 ? 170 : 60],
        fontFamily: 'Space Grotesk, sans-serif',
        fontWeight: 600,
        getTextAnchor: 'middle',
        getAlignmentBaseline: 'center',
        background: false,
        updateTriggers: { getColor: [viewState.zoom] },
      }),
      new TextLayer({
        id: 'labels',
        data: labelData,
        getPosition: (d) => [d.x, d.y],
        getText: (d) => d.lemma,
        getSize: (d) => (egoIds.has(d.id) ? 13 : 11),
        sizeUnits: 'pixels',
        getPixelOffset: [0, -10],
        getColor: (d) => (egoIds.size > 0 && !egoIds.has(d.id) ? [232, 230, 223, 90] : [232, 230, 223, 220]),
        fontFamily: 'IBM Plex Sans, sans-serif',
        getTextAnchor: 'middle',
        getAlignmentBaseline: 'bottom',
        updateTriggers: { getColor: [egoIds], getSize: [egoIds] },
      }),
    ].filter(Boolean);
  }, [points, clusters, ego, egoIds, byId, selected, labelData, viewState.zoom]);

  if (!points) {
    return (
      <div className="stage stage--empty">
        <p className="muted">Loading the map…</p>
      </div>
    );
  }

  return (
    <div className="stage stage--map">
      <DeckGL
        views={new OrthographicView({ id: 'ortho', flipY: false })}
        viewState={viewState}
        onViewStateChange={({ viewState: vs }) => setViewState(vs)}
        controller={{ dragRotate: false, minZoom: 0.5, maxZoom: 8 }}
        layers={layers}
        getCursor={({ isHovering }) => (isHovering ? 'pointer' : 'grab')}
        style={{ position: 'absolute', inset: 0 }}
        onResize={({ width, height }) => setViewSize([width, height])}
      />
      <div className="controls controls--overlay">
        <span className="muted small">{points.length.toLocaleString()} verbs · {clusters.length} regions · zoom {viewState.zoom.toFixed(1)}</span>
        <button className="btn btn--ghost btn--sm" onClick={() => setViewState({ ...INITIAL_VIEW, transitionDuration: 400 })}>fit all</button>
        {selected && (
          <button className="btn btn--sm" onClick={() => setMode('web')}>open {selected.lemma} in web</button>
        )}
      </div>
      {hover && (
        <div className="hovercard hovercard--map">
          <strong>{hover.lemma}</strong>
          <div className="muted small">
            {clusters.find((c) => c.cluster_id === hover.cluster)?.name} · zipf {hover.zipf}
          </div>
        </div>
      )}
    </div>
  );
}
