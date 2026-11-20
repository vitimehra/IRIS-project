import { useEffect, useRef, useState } from "react";
import { Notice, Spinner } from "../../components/Layout.jsx";
import { api } from "../../api/client.js";

/* Each stage: props { st, act } where act(fn) runs an API call, handles errors,
   and replaces the state with what the server returns. */

// --- 1. issue ------------------------------------------------------------------------

export function IssueStage({ act, busy }) {
  const [text, setText] = useState("");
  const [mode, setMode] = useState("typed");
  const [listening, setListening] = useState(false);
  const [supported] = useState(
    () =>
      typeof window !== "undefined" &&
      ("webkitSpeechRecognition" in window || "SpeechRecognition" in window),
  );
  const recRef = useRef(null);
  const startedAt = useRef(Date.now());

  const toggleSpeech = () => {
    if (listening) {
      recRef.current?.stop();
      setListening(false);
      return;
    }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new SR();
    rec.lang = "en-IN";
    rec.continuous = true;
    rec.interimResults = true;
    let finalText = text;
    rec.onresult = (ev) => {
      let interim = "";
      for (let i = ev.resultIndex; i < ev.results.length; i += 1) {
        const r = ev.results[i];
        if (r.isFinal)
          finalText +=
            (finalText && !finalText.endsWith(" ") ? " " : "") +
            r[0].transcript.trim();
        else interim += r[0].transcript;
      }
      setText(finalText + (interim ? " " + interim : ""));
      setMode((m) => (m === "typed" && text ? "mixed" : "speech"));
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    rec.start();
    setListening(true);
  };

  return (
    <div className="stack">
      <p className="eyebrow">Step 1</p>
      <h1>What gets in your way?</h1>
      <p className="lede">
        Think of something small that bothers you in an ordinary day — not a big
        life problem. A wait, a repeat, a thing you always have to hunt for.
        Ramble as much as you like; the more specific, the better.
      </p>
      <textarea
        className="textarea"
        rows={8}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (mode === "speech") setMode("mixed");
        }}
        placeholder="Every morning the geyser takes about twelve minutes to heat up, so I…"
      />
      <div className="row">
        {supported ? (
          <button
            type="button"
            className={`btn btn--ghost ${listening ? "is-live" : ""}`}
            onClick={toggleSpeech}
          >
            {listening ? "● Listening… tap to stop" : "🎤 Speak instead"}
          </button>
        ) : (
          <span className="muted small">Voice input needs Chrome or Edge.</span>
        )}
        <span className="muted small">
          {text.trim().split(/\s+/).filter(Boolean).length} words
        </span>
        <button
          className="btn"
          disabled={busy || text.trim().length < 20}
          onClick={() =>
            act(() =>
              api.submitIssue({
                text,
                input_mode: mode,
                duration_ms: Date.now() - startedAt.current,
              }),
            )
          }
        >
          {busy ? <Spinner label="Structuring…" /> : "Continue"}
        </button>
      </div>
    </div>
  );
}

// --- 2. cae ---------------------------------------------------------------------------

export function CaeStage({ st, act, busy }) {
  const [issues, setIssues] = useState(
    st.issues.map((i) => ({ ...i, remove: false })),
  );
  const set = (id, field, v) =>
    setIssues((xs) => xs.map((x) => (x.id === id ? { ...x, [field]: v } : x)));
  const kept = issues.filter((i) => !i.remove);
  return (
    <div className="stack">
      <p className="eyebrow">Step 2</p>
      <h1>Here is what we heard</h1>
      <p className="lede">
        Each card is one difficulty, split into what triggers it, how it feels,
        and what it does to your day. Fix anything that is wrong; remove
        anything that is not you.
      </p>
      {issues.map((i) => (
        <div key={i.id} className={`card cae ${i.remove ? "is-removed" : ""}`}>
          <div className="row row--between">
            <input
              className="input input--title"
              value={i.headline}
              onChange={(e) => set(i.id, "headline", e.target.value)}
              disabled={i.remove}
            />
            <button
              className="btn btn--quiet btn--sm"
              onClick={() => set(i.id, "remove", !i.remove)}
            >
              {i.remove ? "Restore" : "Not me"}
            </button>
          </div>
          {[
            ["cause", "Because"],
            ["affect", "You feel"],
            ["effect", "And so"],
          ].map(([f, label]) => (
            <label key={f} className="slot">
              <span className="slot__label">{label}</span>
              <textarea
                className="textarea textarea--sm"
                rows={2}
                value={i[f]}
                onChange={(e) => set(i.id, f, e.target.value)}
                disabled={i.remove}
              />
            </label>
          ))}
          {i.evidence && (
            <p className="muted small">From your words: “{i.evidence}”</p>
          )}
        </div>
      ))}
      <button
        className="btn"
        disabled={busy || kept.length === 0}
        onClick={() => act(() => api.confirmCae(issues))}
      >
        {busy ? (
          <Spinner label="Finding the problems…" />
        ) : (
          `These are right (${kept.length})`
        )}
      </button>
    </div>
  );
}

// --- 3. problems -------------------------------------------------------------------------

export function ProblemsStage({ st, act, busy }) {
  const [pick, setPick] = useState(null);
  return (
    <div className="stack">
      <p className="eyebrow">Step 3</p>
      <h1>Which problem matters most?</h1>
      <p className="lede">
        Behind your issues are these design problems. Choose the one you would
        most want solved.
      </p>
      <div className="stack-sm">
        {st.problems.map((p) => (
          <label
            key={p.id}
            className={`choice ${pick === p.id ? "is-on" : ""}`}
          >
            <input
              type="radio"
              name="problem"
              checked={pick === p.id}
              onChange={() => setPick(p.id)}
            />
            <span>
              <strong>{p.statement}</strong>
              {p.rationale && (
                <span className="muted small block">{p.rationale}</span>
              )}
            </span>
          </label>
        ))}
      </div>
      <button
        className="btn"
        disabled={busy || !pick}
        onClick={() => act(() => api.selectProblem(pick))}
      >
        {busy ? <Spinner label="Defining it…" /> : "This one"}
      </button>
    </div>
  );
}

// --- 4. aopc -------------------------------------------------------------------------------

export function AopcStage({ st, act, busy }) {
  const p = st.problem;
  const [v, setV] = useState({
    action: p.action || "",
    object: p.object || "",
    party: p.party || "",
    context: p.context || "",
  });
  return (
    <div className="stack">
      <p className="eyebrow">Step 4</p>
      <h1>The problem, defined</h1>
      <p className="lede">
        Four parts: the action, what it acts on, who is involved, and the
        circumstance. Adjust anything.
      </p>
      <div className="card aopc">
        {[
          ["action", "Action"],
          ["object", "Object"],
          ["party", "Party"],
          ["context", "Context"],
        ].map(([f, label]) => (
          <label key={f} className="slot">
            <span className="slot__label">{label}</span>
            <input
              className="input"
              value={v[f]}
              onChange={(e) => setV({ ...v, [f]: e.target.value })}
            />
          </label>
        ))}
        {p.restated && <p className="muted">“{p.restated}”</p>}
      </div>
      <button
        className="btn"
        disabled={busy}
        onClick={() => act(() => api.confirmAopc(v))}
      >
        Confirm
      </button>
    </div>
  );
}

// --- 5. traditional ---------------------------------------------------------------------------

export function TraditionalStage({ st, act, busy }) {
  const n = st.ideas_required;
  const MIN = 20;
  const [ideas, setIdeas] = useState(Array.from({ length: n }, () => ""));
  const filled = ideas.filter((t) => t.trim().length >= MIN).length;
  return (
    <div className="stack">
      <p className="eyebrow">Step 5 · your own ideas</p>
      <h1>How would you solve it?</h1>
      <ProblemStrip p={st.problem} />
      <p className="lede">
        Write {n} ideas of your own. Any form — a sentence or a paragraph each.
        There are no wrong answers, and you will not see any AI suggestions
        until you are done.
      </p>
      <p className="muted small">
        Type a minimum of 20 characters in each idea to proceed.
      </p>
      {ideas.map((t, i) => (
        <label key={i} className="field">
          <span>
            Idea {i + 1}{" "}
            <em
              className="muted"
              style={{ fontWeight: 400, fontStyle: "normal" }}
            >
              {t.trim().length} / {MIN}
            </em>
          </span>
          <textarea
            className="textarea"
            rows={3}
            value={t}
            onChange={(e) =>
              setIdeas(ideas.map((x, k) => (k === i ? e.target.value : x)))
            }
          />
        </label>
      ))}
      <button
        className="btn"
        disabled={busy || filled < n}
        onClick={() => act(() => api.submitTraditional(ideas))}
      >
        {busy ? (
          <Spinner label="Saving and generating…" />
        ) : (
          `Submit ${filled} / ${n}`
        )}
      </button>
    </div>
  );
}

export function ProblemStrip({ p }) {
  if (!p) return null;
  return (
    <div className="strip">
      <span>
        <b>Action</b> {p.action}
      </span>
      <span>
        <b>Object</b> {p.object}
      </span>
      <span>
        <b>Party</b> {p.party}
      </span>
      <span>
        <b>Context</b> {p.context}
      </span>
    </div>
  );
}

// --- 6. inspider steps -----------------------------------------------------------------------------

const keywordProposeOnce = new Set();

export function KeywordsStep({ st, act, busy }) {
  const [sel, setSel] = useState(
    () =>
      new Set((st.keywords || []).filter((k) => k.node_id).map((k) => k.id)),
  );
  const [extra, setExtra] = useState("");
  useEffect(() => {
    if (st.substage && st.substage !== "keywords") return;
    if (st.keywords?.length) {
      setSel(new Set(st.keywords.filter((k) => k.node_id).map((k) => k.id)));
      return;
    }
    const key = st.session_id ?? "keywords";
    if (keywordProposeOnce.has(key)) return;
    keywordProposeOnce.add(key);
    act(async () => {
      try {
        return await api.proposeKeywords();
      } catch (e) {
        keywordProposeOnce.delete(key);
        throw e;
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st.keywords?.length, st.substage, st.session_id]);

  if (!st.keywords || st.keywords.length === 0)
    return <Spinner label="Proposing keywords…" />;
  return (
    <div className="stack">
      <p className="eyebrow">Inspired ideas · keywords</p>
      <h1>Which actions could lead somewhere?</h1>
      <ProblemStrip p={st.problem} />
      <p className="lede">
        These verbs are doorways into the Inspider web. Keep the ones that feel
        promising, add your own.
      </p>
      <div className="stack-sm">
        {st.keywords.map((k) => (
          <label
            key={k.id}
            className={`choice ${sel.has(k.id) ? "is-on" : ""} ${!k.node_id ? "is-disabled" : ""}`}
          >
            <input
              type="checkbox"
              disabled={!k.node_id}
              checked={sel.has(k.id)}
              onChange={(e) => {
                const s = new Set(sel);
                e.target.checked ? s.add(k.id) : s.delete(k.id);
                setSel(s);
              }}
            />
            <span>
              <strong>{k.text}</strong>
              {k.resolved_lemma && k.resolved_lemma !== k.text && (
                <span className="tag">→ {k.resolved_lemma}</span>
              )}
              {!k.node_id && (
                <span className="tag tag--warn">not in the web</span>
              )}
              {k.source === "user" && <span className="tag">yours</span>}
              {k.rationale && (
                <span className="muted small block">{k.rationale}</span>
              )}
            </span>
          </label>
        ))}
      </div>
      <div className="row">
        <input
          className="input"
          placeholder="add a verb…"
          value={extra}
          onChange={(e) => setExtra(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && extra.trim()) {
              act(() => api.addKeyword(extra));
              setExtra("");
            }
          }}
        />
        <button
          className="btn btn--ghost"
          disabled={busy || !extra.trim()}
          onClick={() => {
            act(() => api.addKeyword(extra));
            setExtra("");
          }}
        >
          Add
        </button>
      </div>
      <button
        className="btn"
        disabled={busy || sel.size === 0}
        onClick={() => act(() => api.confirmKeywords([...sel]))}
      >
        Continue with {sel.size}
      </button>
    </div>
  );
}

export function NeighboursStep({ st, act, busy }) {
  const [picks, setPicks] = useState({});
  const max = st.max_pick;
  const toggle = (kid, nid) =>
    setPicks((p) => {
      const cur = new Set(p[kid] || []);
      if (cur.has(nid)) cur.delete(nid);
      else if (cur.size < max) cur.add(nid);
      return { ...p, [kid]: [...cur] };
    });
  const total = Object.values(picks).reduce((a, b) => a + b.length, 0);
  return (
    <div className="stack">
      <p className="eyebrow">Inspired ideas · the web</p>
      <h1>Follow the strands</h1>
      <p className="lede">
        Each keyword sits at the centre of its web. The verbs around it are its
        closest neighbours by meaning. Pick up to {max} per keyword that feel
        like they could lead somewhere unexpected — or none.
      </p>
      {st.neighbour_options.map((o) => (
        <div key={o.keyword.id} className="card">
          <div className="row row--between">
            <div>
              <strong className="big">{o.keyword.lemma}</strong>{" "}
              <span className="muted small">{o.keyword.gloss}</span>
            </div>
            <span className="muted small">
              {(picks[o.keyword.id] || []).length} / {max}
            </span>
          </div>
          <div className="web-row">
            {o.neighbours.map((n) => {
              const on = (picks[o.keyword.id] || []).includes(n.node_id);
              return (
                <button
                  key={n.node_id}
                  type="button"
                  className={`strand ${on ? "is-on" : ""}`}
                  style={{ "--sim": n.sim }}
                  onClick={() => toggle(o.keyword.id, n.node_id)}
                  title={n.gloss || ""}
                >
                  <span>{n.lemma}</span>
                  <span className="mono small">{n.sim.toFixed(2)}</span>
                  {n.phenomenon_count > 0 && (
                    <span
                      className="pip"
                      title={`${n.phenomenon_count} phenomena already in the web`}
                    >
                      {n.phenomenon_count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <button
        className="btn"
        disabled={busy}
        onClick={() =>
          act(() =>
            api.confirmNeighbours(
              Object.entries(picks).map(([keyword_id, node_ids]) => ({
                keyword_id: Number(keyword_id),
                node_ids,
              })),
            ),
          )
        }
      >
        Continue with {total} extra {total === 1 ? "verb" : "verbs"}
      </button>
    </div>
  );
}

export function SelectStep({ st, act, busy }) {
  const sel = st.selection || { kept: [], dropped: [], k: 0, swaps_left: 0 };
  const [out, setOut] = useState(null); // kept verb chosen for a swap
  const canSwap = sel.swaps_left > 0 && sel.dropped.length > 0;
  const Verb = ({ k, kept }) => (
    <button
      type="button"
      className={`strand ${kept ? "is-on" : ""} ${out === k.id ? "is-out" : ""}`}
      disabled={busy || !canSwap || (!kept && out == null)}
      title={k.gloss || ""}
      onClick={() => {
        if (kept) setOut(out === k.id ? null : k.id);
        else if (out != null) {
          const o = out;
          setOut(null);
          act(() => api.swapKeyword(o, k.id));
        }
      }}
    >
      <span>{k.lemma}</span>
      {k.source === "neighbour" && (
        <span className="mono small" title={`via ${k.parent_lemma}`}>
          ← {k.parent_lemma}
        </span>
      )}
      {k.phenomenon_count > 0 && (
        <span
          className="pip"
          title={`${k.phenomenon_count} phenomena already in the web`}
        >
          {k.phenomenon_count}
        </span>
      )}
    </button>
  );
  return (
    <div className="stack">
      <p className="eyebrow">Inspired ideas · choosing verbs</p>
      <h1>{sel.kept.length} verbs, as different from each other as possible</h1>
      <p className="lede">
        From your {sel.kept.length + sel.dropped.length} verbs, these {sel.k}{" "}
        are the most distant from one another in meaning. The search for
        real-world phenomena runs on these only, and each will inspire one idea.
      </p>
      <div className="card">
        <strong className="big">Kept</strong>
        <div className="web-row">
          {sel.kept.map((k) => (
            <Verb key={k.id} k={k} kept />
          ))}
        </div>
      </div>
      {sel.dropped.length > 0 && (
        <div className="card">
          <div className="row row--between">
            <strong className="big">Set aside</strong>
            <span className="muted small">
              {sel.swaps_left > 0
                ? out == null
                  ? `You may swap ${sel.swaps_left}: click a kept verb, then the one to bring in.`
                  : "Now click the verb to bring in."
                : "No swaps left."}
            </span>
          </div>
          <div className="web-row">
            {sel.dropped.map((k) => (
              <Verb key={k.id} k={k} kept={false} />
            ))}
          </div>
        </div>
      )}
      <button
        className="btn"
        disabled={busy}
        onClick={() => act(() => api.confirmSelection())}
      >
        Search the world for these {sel.kept.length} verbs
      </button>
    </div>
  );
}

export function PhenomenaStep({ st, act, busy, reload }) {
  const view = st.phenomena || { groups: [], job: null };
  const job = view.job;
  const running = !job || job.status === "queued" || job.status === "running";
  const failed = job?.status === "error";
  const total = view.groups.reduce((a, g) => a + g.phenomena.length, 0);

  // Queue the search once. The server is idempotent, so React's double-mount
  // in development and a page refresh are both harmless.
  useEffect(() => {
    if (!job) act(() => api.runPhenomena());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // While the worker runs, poll. Each keyword takes about 45 seconds and
  // three run at once; the page fills in as results land.
  useEffect(() => {
    if (!running) return undefined;
    const t = setInterval(reload, 3000);
    return () => clearInterval(t);
  }, [running, reload]);

  if (running) {
    return (
      <div className="stack">
        <p className="eyebrow">Inspired ideas · phenomena</p>
        <h1>Searching the world</h1>
        <Spinner
          label={
            job
              ? `${job.progress} of ${job.total} verbs searched…`
              : "Starting the search…"
          }
        />
        <p className="muted small">
          For each chosen verb, the AI is finding a few real phenomena whose
          action that verb describes — in nature, physics, biology, engineering,
          everyday life — and adding them to the web for future participants.
          This takes a minute or two. Results appear below as they arrive; you
          can read ahead.
        </p>
        {total > 0 && <PhenomenaGroups groups={view.groups} />}
      </div>
    );
  }

  if (failed && total === 0) {
    return (
      <div className="stack">
        <p className="eyebrow">Inspired ideas · phenomena</p>
        <h1>The search did not find anything</h1>
        <Notice tone="warn">{job.error}</Notice>
        <button
          className="btn"
          disabled={busy}
          onClick={() => act(() => api.runPhenomena())}
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="stack">
      <p className="eyebrow">Inspired ideas · phenomena</p>
      <h1>{total} phenomena from the world</h1>
      <p className="lede">
        Real things that happen in nature, physics, biology and everyday life —
        each described by one of your verbs. These are the raw material for the
        next set of ideas. Read them; you do not need to choose.
      </p>
      {failed && <Notice tone="warn">{job.error}</Notice>}
      {job?.error && !failed && <Notice tone="warn">{job.error}</Notice>}
      <PhenomenaGroups groups={view.groups} />
      <button
        className="btn"
        disabled={busy}
        onClick={() => act(() => api.confirmPhenomena())}
      >
        {busy ? (
          <Spinner label="Generating inspired ideas…" />
        ) : (
          "Generate ideas from these"
        )}
      </button>
    </div>
  );
}

function PhenomenaGroups({ groups }) {
  return groups.map((g) => (
    <div key={g.keyword.id} className="card">
      <strong className="big">{g.keyword.lemma}</strong>{" "}
      {g.keyword.source === "neighbour" && (
        <span className="tag">via the web</span>
      )}
      <ul className="phen">
        {g.phenomena.map((p) => (
          <li key={p.id}>
            <div className="row row--between">
              <strong>{p.title}</strong>
              <span className="row">
                <span className="tag">{p.domain}</span>
                {!p.fresh && (
                  <span
                    className="tag tag--muted"
                    title="Added by an earlier participant"
                  >
                    inherited
                  </span>
                )}
              </span>
            </div>
            <p className="small">{p.description}</p>
            {p.source_url && (
              <a
                className="small"
                href={p.source_url}
                target="_blank"
                rel="noreferrer"
              >
                {p.source_title || p.source_url}
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  ));
}

export function AutoWait({ label }) {
  return (
    <div className="stack">
      <Spinner label={label} />
    </div>
  );
}

// --- 7. rating -----------------------------------------------------------------------------------

const DIMS = [
  ["novelty", "Novel", "How new or surprising is it?"],
  ["usefulness", "Useful", "Would it actually help with the problem?"],
  ["feasibility", "Feasible", "Could it realistically be built?"],
];

function ratingFields(it) {
  const r = it?.rating;
  if (!r) return {};
  return {
    novelty: r.novelty,
    usefulness: r.usefulness,
    feasibility: r.feasibility,
  };
}

function firstOpenIndex(items) {
  const i = items.findIndex((it) => !it.rated);
  return i >= 0 ? i : items.length;
}

export function RatingStage({ st, act, busy, reload }) {
  const deck = st.deck;
  const items = deck.items || [];
  const [idx, setIdx] = useState(() => firstOpenIndex(items));
  const [v, setV] = useState(() => ratingFields(items[idx]));
  const [comment, setComment] = useState(
    () => items[idx]?.rating?.comment || "",
  );
  const shownAt = useRef(Date.now());
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const [ratedIds, setRatedIds] = useState(
    () => new Set(items.filter((i) => i.rated).map((i) => i.id)),
  );

  useEffect(() => {
    if (!deck.ready) {
      const t = setInterval(reload, 3000);
      return () => clearInterval(t);
    }
  }, [deck.ready, reload]);

  const item = items[idx];
  const itemId = item?.id;
  useEffect(() => {
    if (itemId == null) return;
    const it = itemsRef.current.find((i) => i.id === itemId);
    if (!it) return;
    setV(ratingFields(it));
    setComment(it.rating?.comment || "");
    shownAt.current = Date.now();
  }, [itemId]);

  const goTo = (k) => {
    const it = items[k];
    setIdx(k);
    setV(ratingFields(it));
    setComment(it?.rating?.comment || "");
    shownAt.current = Date.now();
  };

  if (!deck.ready) {
    const w = deck.waiting_on || {};
    const what =
      deck.target_type === "concept" ? "concepts" : "product renderings";
    return (
      <div className="stack">
        <Spinner
          label={`Generating ${what}… ${w.progress ?? 0} / ${w.total ?? "?"}`}
        />
        <p className="muted">
          Each idea is being turned into a concept and then rendered. This runs
          in the background; the page will continue by itself.
        </p>
        {w.error && (
          <Notice tone="warn">
            Generation hit an error: {w.error}. The researcher can retry from
            the console.
          </Notice>
        )}
      </div>
    );
  }

  if (!item) {
    return (
      <div className="stack">
        <h1>All rated</h1>
        <p className="lede">
          You have scored every{" "}
          {deck.target_type === "idea"
            ? "idea"
            : deck.target_type === "concept"
              ? "concept"
              : "product"}
          . Go back to change a score, or continue.
        </p>
        <div className="row row--between">
          <button
            className="btn btn--ghost"
            type="button"
            disabled={busy || items.length === 0}
            onClick={() => goTo(items.length - 1)}
          >
            ← Previous
          </button>
          <button
            className="btn"
            disabled={busy}
            onClick={() => act(() => api.rateComplete())}
          >
            Continue
          </button>
        </div>
      </div>
    );
  }
  const complete = DIMS.every(([k]) => v[k]);
  const submit = async () => {
    const rated = { ...v, comment: comment || null };
    await act(
      async () => {
        await api.rate({
          target_type: deck.target_type,
          target_id: item.id,
          ...v,
          comment: comment || null,
          display_order: item.display_order,
          response_ms: Date.now() - shownAt.current,
        });
        return null;
      },
      { silent: true },
    );
    item.rating = rated; // keep the values for "Previous"
    item.rated = true;
    const nowRated = new Set(ratedIds).add(item.id);
    setRatedIds(nowRated);
    const next = items.findIndex((i, k) => k > idx && !nowRated.has(i.id));
    if (next >= 0) goTo(next);
    else {
      const firstUnrated = items.findIndex((i) => !nowRated.has(i.id));
      if (firstUnrated >= 0) goTo(firstUnrated);
      else setIdx(items.length); // past the end: the "All rated" screen
    }
  };

  const titles = {
    idea: "Rate this idea",
    concept: "Rate this concept",
    render: "Rate this product",
  };
  return (
    <div className="stack">
      <p className="eyebrow">
        {titles[deck.target_type]} · {idx + 1} of {items.length}
        {item.rated && (
          <span className="muted"> · already rated, you can change it</span>
        )}
      </p>
      <div className="card rate">
        <h2>{item.title}</h2>
        {deck.target_type === "idea" && (
          <>
            <div className="slot">
              <span className="slot__label">Principle</span>
              <p>{item.principle}</p>
            </div>
            <div className="slot">
              <span className="slot__label">Phenomenon</span>
              <p>{item.phenomenon}</p>
            </div>
          </>
        )}
        {deck.target_type === "concept" && (
          <>
            <p>{item.object}</p>
            <ul className="small">
              {(item.characteristics || []).map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
            {item.how_it_works && (
              <p className="muted small">{item.how_it_works}</p>
            )}
          </>
        )}
        {deck.target_type === "render" && (
          <>
            <div className="renders">
              {item.images.map((im) => (
                <figure key={im.kind}>
                  <img
                    src={api.imageUrl(im.url, "participant")}
                    alt={`${item.title} — ${im.kind === "product" ? "product" : "in use"}`}
                  />
                  <figcaption className="muted small">
                    {im.kind === "product" ? "Product" : "In use"}
                  </figcaption>
                </figure>
              ))}
            </div>
            <p className="muted small">{item.object}</p>
          </>
        )}
      </div>
      <div className="dims">
        {DIMS.map(([k, label, help]) => (
          <div key={k} className="dim">
            <div>
              <strong>{label}</strong>{" "}
              <span className="muted small">{help}</span>
            </div>
            <div className="scale">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  className={`scale__pt ${v[k] === n ? "is-on" : ""}`}
                  onClick={() => setV({ ...v, [k]: n })}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <input
        className="input"
        placeholder="Optional: a comment"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
      />
      <div className="row row--between">
        <span className="row">
          <button
            className="btn btn--ghost btn--sm"
            type="button"
            disabled={busy || idx === 0}
            onClick={() => goTo(idx - 1)}
          >
            ← Previous
          </button>
          <span className="muted small">1 = not at all · 5 = extremely</span>
        </span>
        <button className="btn" disabled={busy || !complete} onClick={submit}>
          {item.rated ? "Save" : "Next"}
        </button>
      </div>
    </div>
  );
}

// --- review-only back ------------------------------------------------------------------

export function ReviewPage({ pageKey, onClose }) {
  const [hist, setHist] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    api
      .history()
      .then(setHist)
      .catch((e) => setErr(e.message));
  }, []);
  if (err) return <Notice tone="warn">{err}</Notice>;
  if (!hist) return <Spinner label="Loading…" />;
  const page =
    hist.pages.find((p) => p.key === pageKey) ||
    hist.pages[hist.pages.length - 1];
  if (!page)
    return (
      <div className="stack">
        <p className="muted">Nothing to look back at yet.</p>
        <button className="btn" onClick={onClose}>
          Back to the current step
        </button>
      </div>
    );
  return (
    <div className="stack">
      <p className="eyebrow">Looking back · read only</p>
      <h1>{page.label}</h1>
      <p className="muted small">
        Earlier steps can be read but not changed — everything after them was
        built on them.
      </p>
      {page.key === "issue" &&
        page.issue_inputs.map((r, i) => (
          <div key={i} className="card">
            <p style={{ whiteSpace: "pre-wrap" }}>{r.text}</p>
          </div>
        ))}
      {page.key === "cae" &&
        page.issues.map((it) => (
          <div
            key={it.id}
            className={`card cae ${it.confirmed ? "" : "card--muted"}`}
          >
            <strong>{it.headline}</strong>
            <div className="cae-mini">
              <span>
                <b>Cause</b>
                {it.cause}
              </span>
              <span>
                <b>Affect</b>
                {it.affect}
              </span>
              <span>
                <b>Effect</b>
                {it.effect}
              </span>
            </div>
          </div>
        ))}
      {page.key === "problems" &&
        page.problems.map((q) => (
          <div key={q.id} className={`card ${q.selected ? "" : "card--muted"}`}>
            <strong>{q.statement}</strong>
            {q.selected && <span className="tag"> chosen</span>}
            {q.rationale && <p className="small muted">{q.rationale}</p>}
          </div>
        ))}
      {page.key === "aopc" && <ProblemStrip p={page.problem} />}
      {page.key === "traditional" &&
        page.ideas.map((i, k) => (
          <div key={k} className="card">
            <strong>{i.title}</strong>
            {i.raw_text && <p className="small">{i.raw_text}</p>}
            <div className="slot">
              <span className="slot__label">Principle</span>
              <p>{i.principle}</p>
            </div>
            <div className="slot">
              <span className="slot__label">Phenomenon</span>
              <p>{i.phenomenon}</p>
            </div>
          </div>
        ))}
      {page.key === "keywords" && (
        <div className="card">
          <div className="web-row">
            {page.keywords.map((k, i) => (
              <span
                key={i}
                className={`strand ${k.selected ? "is-on" : ""}`}
                title={k.rationale || ""}
              >
                {k.lemma}
              </span>
            ))}
          </div>
        </div>
      )}
      {page.key === "neighbours" && (
        <div className="card">
          <div className="web-row">
            {page.neighbours.map((k, i) => (
              <span key={i} className="strand is-on">
                {k.lemma} <span className="mono small">← {k.parent_lemma}</span>
              </span>
            ))}
          </div>
          {page.neighbours.length === 0 && (
            <p className="muted small">No extra verbs were picked.</p>
          )}
        </div>
      )}
      {page.key === "select" && (
        <div className="card">
          <strong className="big">Kept</strong>
          <div className="web-row">
            {page.kept.map((k) => (
              <span key={k} className="strand is-on">
                {k}
              </span>
            ))}
          </div>
          {page.dropped.length > 0 && (
            <>
              <strong className="big">Set aside</strong>
              <div className="web-row">
                {page.dropped.map((k) => (
                  <span key={k} className="strand">
                    {k}
                  </span>
                ))}
              </div>
            </>
          )}
        </div>
      )}
      {page.key === "phenomena" && <PhenomenaGroups groups={page.groups} />}
      <div className="row">
        {hist.pages.map((p) => (
          <span
            key={p.key}
            className={`tag ${p.key === page.key ? "tag--warn" : ""}`}
            style={{ cursor: "pointer" }}
            onClick={() => onClose(p.key)}
          >
            {p.label}
          </span>
        ))}
      </div>
      <button className="btn" onClick={() => onClose(null)}>
        Back to the current step
      </button>
    </div>
  );
}

export function DoneStage({ st }) {
  return (
    <div className="stack">
      <p className="eyebrow">Finished</p>
      <h1>Thank you — that is everything.</h1>
      <p className="lede">
        You wrote ideas, saw the AI's, and rated fifteen concepts and their
        renderings without knowing which method produced which. The researcher
        will now be able to see how the three compare.
      </p>
      <p className="muted">You can close this page.</p>
    </div>
  );
}
