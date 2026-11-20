import { useStore } from '../state/store.jsx';
import { clusterCss } from '../utils/colors.js';

/** The selected verb. Everything a researcher would want to know at a glance. */
export default function DetailPanel() {
  const { selected, setMode, setTool, setPathEnds, togglePin, isPinned, history, back, notify } = useStore();

  if (!selected) {
    return (
      <aside className="panel panel--empty">
        <p className="muted">Search a verb, or press <kbd>/</kbd>.</p>
        <p className="muted small">Every node is an English verb. Every strand is a cosine similarity between two verbs&rsquo; embeddings. The web is what world phenomena look like when laid next to each other.</p>
      </aside>
    );
  }

  const v = selected;
  const freqPct = Math.round((Math.min(v.zipf_frequency, 7) / 7) * 100);

  return (
    <aside className="panel">
      <div className="panel__head">
        <div>
          <div className="eyebrow">
            <span className="dot" style={{ background: clusterCss(v.cluster_id) }} />
            <button className="link" onClick={() => setMode('clusters')} title="Open cluster">
              {v.cluster_name}
            </button>
          </div>
          <h1 className="panel__title">{v.lemma}</h1>
        </div>
        <button className={`iconbtn ${isPinned(v.id) ? 'iconbtn--on' : ''}`} onClick={() => togglePin(v)} title={isPinned(v.id) ? 'Unpin' : 'Pin'}>
          {isPinned(v.id) ? '★' : '☆'}
        </button>
      </div>

      {v.unverified && (
        <div className="notice notice--warn">
          Unverified: found in one source and unknown to WordNet. Probably scrape noise.
        </div>
      )}

      <p className="panel__gloss">
        {v.gloss || <span className="muted">No definition available.</span>}
        {v.gloss_source && v.gloss_source !== 'none' && <span className="tag">{v.gloss_source}</span>}
      </p>

      <dl className="facts">
        <dt>Frequency</dt>
        <dd>
          <span className="bar"><span className="bar__fill" style={{ width: `${freqPct}%` }} /></span>
          <span className="mono">{v.zipf_frequency.toFixed(2)} zipf</span>
        </dd>
        <dt>Hubness</dt>
        <dd className="mono">{v.in_degree} verbs count this among their closest</dd>
        {v.forms.length > 0 && (
          <>
            <dt>Forms</dt>
            <dd className="forms">{v.forms.slice(0, 12).join(' · ')}{v.forms.length > 12 ? ' …' : ''}</dd>
          </>
        )}
        {v.verbnet_classes.length > 0 && (
          <>
            <dt>VerbNet</dt>
            <dd className="mono small">{v.verbnet_classes.slice(0, 6).join(', ')}</dd>
          </>
        )}
        <dt>Sources</dt>
        <dd className="small">{v.sources.join(', ')}</dd>
      </dl>

      <div className="actions">
        <button className="btn" onClick={() => setMode('web')}>Open in web</button>
        <button className="btn" onClick={() => setMode('map')}>Show on map</button>
        <button className="btn btn--ghost" onClick={() => { setTool('walk'); setMode('tools'); }}>Walk from here</button>
        <button className="btn btn--ghost" onClick={() => { setPathEnds((p) => ({ ...p, from: v.lemma })); setTool('path'); setMode('tools'); notify(`Path starts at ${v.lemma}`); }}>Path from</button>
        <button className="btn btn--ghost" onClick={() => { setPathEnds((p) => ({ ...p, to: v.lemma })); setTool('path'); setMode('tools'); notify(`Path ends at ${v.lemma}`); }}>Path to</button>
        <button className="btn btn--ghost" onClick={() => { setTool('compare'); setMode('tools'); }}>Compare</button>
      </div>

      {history.length > 1 && (
        <div className="trail">
          <button className="link" onClick={back}>← back</button>
          <span className="muted small"> {history.slice(-6).join(' › ')}</span>
        </div>
      )}
    </aside>
  );
}
