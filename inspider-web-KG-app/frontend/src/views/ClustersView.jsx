import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { useStore } from '../state/store.jsx';
import { clusterCss } from '../utils/colors.js';

/** Regions of the web: Leiden communities on the k-NN graph, named by their hubs. */
export default function ClustersView() {
  const { selected, select, includeUnverified, setMode, notify } = useStore();
  const [clusters, setClusters] = useState([]);
  const [open, setOpen] = useState(null);
  const [members, setMembers] = useState([]);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    api.clusters().then((c) => setClusters(c.clusters)).catch((e) => notify(e.message));
  }, []);

  useEffect(() => {
    const target = open ?? selected?.cluster_id;
    if (target === undefined || target === null) return;
    setOpen(target);
    api.cluster(target, 400, includeUnverified).then((c) => setMembers(c.members)).catch(() => setMembers([]));
  }, [open, selected?.cluster_id, includeUnverified]);

  const shown = clusters.filter((c) => !filter || c.name.includes(filter.toLowerCase()) || c.top_verbs.some((v) => v.includes(filter.toLowerCase())));
  const current = clusters.find((c) => c.cluster_id === open);

  return (
    <div className="stage stage--split">
      <div className="list">
        <div className="list__head">
          <h2>Regions of the web</h2>
          <input className="input" placeholder="filter regions…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <p className="muted small">{clusters.length} regions, found by Leiden community detection on the strands. Named by their most central verbs.</p>
        </div>
        <ul className="clusters">
          {shown.map((c) => (
            <li key={c.cluster_id} className={`cluster ${open === c.cluster_id ? 'cluster--on' : ''}`} onClick={() => setOpen(c.cluster_id)}>
              <span className="dot dot--lg" style={{ background: clusterCss(c.cluster_id) }} />
              <div className="cluster__body">
                <div className="cluster__name">{c.name}</div>
                <div className="muted small">{c.size.toLocaleString()} verbs · {c.top_verbs.slice(3, 5).join(', ')}</div>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="list list--members">
        {current ? (
          <>
            <div className="list__head">
              <div className="eyebrow"><span className="dot" style={{ background: clusterCss(current.cluster_id) }} /> region {current.cluster_id}</div>
              <h2>{current.name}</h2>
              <p className="muted small">{current.size.toLocaleString()} verbs · showing the {members.length} most central{current.name_source === 'gpt' ? ' · named by GPT' : ''}</p>
            </div>
            <div className="chips">
              {members.map((m) => (
                <button
                  key={m.id}
                  className={`chip ${selected?.id === m.id ? 'chip--on' : ''}`}
                  onClick={() => select(m.lemma)}
                  onDoubleClick={() => { select(m.lemma); setMode('web'); }}
                  title="click to select · double-click to open in web"
                >
                  {m.lemma}
                </button>
              ))}
            </div>
          </>
        ) : (
          <p className="muted">Pick a region.</p>
        )}
      </div>
    </div>
  );
}
