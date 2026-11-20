import SearchBox from './SearchBox.jsx';
import { useStore } from '../state/store.jsx';
import { api } from '../api/client.js';

const MODES = [
  ['web', 'Web'],
  ['map', 'Map'],
  ['clusters', 'Clusters'],
  ['tools', 'Tools'],
];

export default function TopBar() {
  const { meta, mode, setMode, includeUnverified, setIncludeUnverified, select, notify } = useStore();

  const surprise = async () => {
    try {
      const v = await api.random(includeUnverified);
      await select(v.lemma);
      setMode('web');
    } catch (e) {
      notify(e.message);
    }
  };

  return (
    <header className="topbar">
      <div className="brand">
        <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true" className="brand__web">
          <g fill="none" stroke="currentColor" strokeWidth="1">
            {[4, 7.5, 11].map((r) => <circle key={r} cx="13" cy="13" r={r} />)}
            {[0, 45, 90, 135].map((a) => (
              <line key={a} x1="13" y1="1" x2="13" y2="25" transform={`rotate(${a} 13 13)`} />
            ))}
          </g>
          <circle cx="13" cy="13" r="1.8" fill="var(--accent)" />
        </svg>
        <span className="brand__name">Inspider Web</span>
        {meta && (
          <span className="brand__meta mono">
            {meta.verbs.toLocaleString()} verbs · k={meta.k}
          </span>
        )}
        {meta?.dev_embeddings && (
          <span className="badge badge--warn" title="Built with EMBEDDING_PROVIDER=dev. Neighbours are not meaningful. Set your OpenAI key and rebuild.">
            dev embeddings
          </span>
        )}
      </div>

      <div className="topbar__search">
        <SearchBox />
      </div>

      <nav className="modes" role="tablist">
        {MODES.map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={mode === key}
            className={`mode ${mode === key ? 'mode--on' : ''}`}
            onClick={() => setMode(key)}
          >
            {label}
          </button>
        ))}
      </nav>

      <div className="topbar__right">
        <button className="btn btn--ghost" onClick={surprise} title="A random frequent verb">Surprise me</button>
        <label className="toggle" title="Verbs found in one source and unknown to WordNet are hidden by default.">
          <input type="checkbox" checked={includeUnverified} onChange={(e) => setIncludeUnverified(e.target.checked)} />
          <span>unverified</span>
        </label>
      </div>
    </header>
  );
}
