import { api } from '../api/client.js';
import { useStore } from '../state/store.jsx';
import { clusterCss } from '../utils/colors.js';

/** Bookmarked verbs, and export of the subgraph they span. */
export default function PinsPanel() {
  const { pins, select, togglePin, clearPins } = useStore();
  if (pins.length === 0) return null;

  const ids = pins.map((p) => p.id);
  const download = (format) => {
    const a = document.createElement('a');
    a.href = api.exportUrl(ids, format);
    a.download = '';
    a.click();
  };

  return (
    <aside className="pins">
      <div className="pins__head">
        <strong>Pinned</strong> <span className="muted small">{pins.length}</span>
        <button className="link small" onClick={clearPins}>clear</button>
      </div>
      <div className="chips">
        {pins.map((p) => (
          <span key={p.id} className="chip chip--pin" style={{ borderColor: clusterCss(p.cluster_id) }}>
            <button className="chip__label" onClick={() => select(p.lemma)}>{p.lemma}</button>
            <button className="chip__x" onClick={() => togglePin(p)} aria-label={`unpin ${p.lemma}`}>×</button>
          </span>
        ))}
      </div>
      <div className="pins__export">
        <span className="muted small">export the web between them:</span>
        <button className="btn btn--ghost btn--sm" onClick={() => download('csv')}>CSV</button>
        <button className="btn btn--ghost btn--sm" onClick={() => download('graphml')}>GraphML</button>
        <button className="btn btn--ghost btn--sm" onClick={() => download('json')}>JSON</button>
      </div>
    </aside>
  );
}
