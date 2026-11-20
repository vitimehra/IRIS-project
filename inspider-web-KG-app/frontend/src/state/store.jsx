import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';

const Ctx = createContext(null);

const PINS_KEY = 'inspider.pins';
const UNVERIFIED_KEY = 'inspider.unverified';

function loadJson(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}
function saveJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

export function StoreProvider({ children }) {
  const [meta, setMeta] = useState(null);
  const [metaError, setMetaError] = useState(null);
  const [mode, setMode] = useState('web'); // web | map | clusters | tools
  const [tool, setTool] = useState('path'); // path | analogy | compare | walk
  const [selected, setSelected] = useState(null); // full verb detail
  const [history, setHistory] = useState([]); // lemmas visited in the web
  const [includeUnverified, setIncludeUnverified] = useState(() => loadJson(UNVERIFIED_KEY, false));
  const [pins, setPins] = useState(() => loadJson(PINS_KEY, []));
  const [toast, setToast] = useState(null);
  const [pathEnds, setPathEnds] = useState({ from: '', to: '' });
  const [webSettings, setWebSettings] = useState({ k: 20, depth: 1, minSim: 0 });

  useEffect(() => {
    api.meta().then(setMeta).catch((e) => setMetaError(e.message));
  }, []);

  useEffect(() => saveJson(PINS_KEY, pins), [pins]);
  useEffect(() => saveJson(UNVERIFIED_KEY, includeUnverified), [includeUnverified]);

  const notify = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2600);
  }, []);

  /** Select a verb by lemma or id; fetches the full detail. */
  const select = useCallback(
    async (term, { pushHistory = true } = {}) => {
      if (!term && term !== 0) return null;
      try {
        const v = await api.verb(String(term));
        setSelected(v);
        if (pushHistory) {
          setHistory((h) => (h[h.length - 1] === v.lemma ? h : [...h.slice(-49), v.lemma]));
        }
        return v;
      } catch (e) {
        notify(e.message);
        return null;
      }
    },
    [notify]
  );

  const back = useCallback(() => {
    setHistory((h) => {
      if (h.length < 2) return h;
      const next = h.slice(0, -1);
      select(next[next.length - 1], { pushHistory: false });
      return next;
    });
  }, [select]);

  const togglePin = useCallback(
    (v) => {
      setPins((p) => {
        const exists = p.some((x) => x.id === v.id);
        notify(exists ? `Unpinned ${v.lemma}` : `Pinned ${v.lemma}`);
        return exists ? p.filter((x) => x.id !== v.id) : [...p, { id: v.id, lemma: v.lemma, cluster_id: v.cluster_id }];
      });
    },
    [notify]
  );

  const isPinned = useCallback((id) => pins.some((p) => p.id === id), [pins]);

  const value = useMemo(
    () => ({
      meta,
      metaError,
      mode,
      setMode,
      tool,
      setTool,
      selected,
      select,
      history,
      back,
      includeUnverified,
      setIncludeUnverified,
      pins,
      togglePin,
      isPinned,
      clearPins: () => setPins([]),
      toast,
      notify,
      pathEnds,
      setPathEnds,
      webSettings,
      setWebSettings,
    }),
    [meta, metaError, mode, tool, selected, select, history, back, includeUnverified, pins, togglePin, isPinned, toast, notify, pathEnds, webSettings]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useStore outside StoreProvider');
  return ctx;
}
