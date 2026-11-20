import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { useStore } from '../state/store.jsx';
import { clusterCss } from '../utils/colors.js';

/**
 * Typo-tolerant search with keyboard navigation. `onPick` receives the verb
 * brief; when omitted it selects the verb and opens it in the web.
 */
export default function SearchBox({ placeholder = 'Search a verb…  ( / )', onPick, autoFocus = false, compact = false, value: controlled, onChange }) {
  const { includeUnverified, select, setMode } = useStore();
  const [q, setQ] = useState(controlled ?? '');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(-1);
  const inputRef = useRef(null);
  const timer = useRef(null);

  useEffect(() => {
    if (controlled !== undefined) setQ(controlled);
  }, [controlled]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === '/' && !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName) && !compact) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [compact]);

  const update = (text) => {
    setQ(text);
    onChange?.(text);
    setCursor(-1);
    clearTimeout(timer.current);
    if (!text.trim()) {
      setResults([]);
      setOpen(false);
      return;
    }
    timer.current = setTimeout(async () => {
      try {
        const r = await api.search(text, includeUnverified, 10);
        setResults(r.results);
        setOpen(true);
      } catch {
        setResults([]);
      }
    }, 120);
  };

  const pick = async (item) => {
    setOpen(false);
    setResults([]);
    if (onPick) {
      setQ(item.lemma);
      onChange?.(item.lemma);
      onPick(item);
      return;
    }
    setQ('');
    await select(item.lemma);
    setMode('web');
  };

  const onKeyDown = (e) => {
    if (!open || results.length === 0) {
      if (e.key === 'Enter' && q.trim()) {
        // exact/first result on Enter
        api.search(q, includeUnverified, 1).then((r) => r.results[0] && pick(r.results[0]));
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.min(results.length - 1, c + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => Math.max(-1, c - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(results[cursor >= 0 ? cursor : 0]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div className={`search ${compact ? 'search--compact' : ''}`}>
      <input
        ref={inputRef}
        className="search__input"
        value={q}
        placeholder={placeholder}
        onChange={(e) => update(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => results.length && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        autoFocus={autoFocus}
        autoComplete="off"
        spellCheck="false"
        aria-label="Search verbs"
      />
      {open && results.length > 0 && (
        <ul className="search__results" role="listbox">
          {results.map((r, i) => (
            <li
              key={r.id}
              role="option"
              aria-selected={i === cursor}
              className={`search__item ${i === cursor ? 'search__item--active' : ''}`}
              onMouseDown={() => pick(r)}
              onMouseEnter={() => setCursor(i)}
            >
              <span className="dot" style={{ background: clusterCss(r.cluster_id) }} />
              <span className="search__lemma">{r.lemma}</span>
              <span className="search__why">{r.match}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
