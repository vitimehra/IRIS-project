import { useEffect, useRef, useState } from 'react';
import { Button, Callout } from '../../components/Field.jsx';
import { api } from '../../api/client.js';
import { useSession } from '../../state/SessionContext.jsx';

/**
 * The Saboteur.
 *
 * Reverse-brainstorming: the participant is asked to make a moment worse rather
 * than to complain about it. Inventing a harm is a different act from
 * confessing one, so it bypasses the "do I even have a complaint?" gate — and
 * what people reach for first is almost always what already grates on them.
 *
 * Response latency is recorded per answer. A four-second answer is usually
 * lived; a forty-second one is usually invented. That distinction matters in
 * analysis, so the timer starts when the field is first touched.
 */
const MAX_ANSWERS = 3;

export default function Saboteur({ onDone }) {
  const { track } = useSession();

  const [rounds, setRounds] = useState(null);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState(['']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const startedAt = useRef(Date.now());
  const firstKeyAt = useRef(null);
  const headingRef = useRef(null);

  useEffect(() => {
    track('page_view', { page: 'saboteur' });
    api
      .saboteurPlan()
      .then((plan) => {
        setRounds(plan.rounds);
        // Nobody tagged anything negatively, so there is nothing to sabotage.
        if (plan.rounds.length === 0) onDone();
      })
      .catch((err) => setError(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const round = rounds?.[index];

  const advance = () => {
    startedAt.current = Date.now();
    firstKeyAt.current = null;
    setAnswers(['']);
    if (index < rounds.length - 1) {
      setIndex((i) => i + 1);
      headingRef.current?.focus();
    } else {
      track('saboteur_complete', { rounds: rounds.length });
      onDone();
    }
  };

  const submit = async (skipped = false) => {
    setBusy(true);
    setError(null);
    try {
      const filled = answers.map((text) => text.trim()).filter(Boolean);
      await api.saboteurResponses(round.id, {
        skipped: skipped || filled.length === 0,
        responses: filled.map((text) => ({
          text,
          // Measured from the first keystroke, not from when the page appeared:
          // reading time is not thinking time.
          responseMs: firstKeyAt.current ? Date.now() - firstKeyAt.current : null,
        })),
      });
      track('saboteur_round', { skipped: skipped || filled.length === 0, answers: filled.length });
      advance();
    } catch (err) {
      setError(err.message || 'We could not save that. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const updateAnswer = (i, value) => {
    if (!firstKeyAt.current && value.trim()) firstKeyAt.current = Date.now();
    setAnswers((prev) => prev.map((a, n) => (n === i ? value : a)));
  };

  if (error && !rounds) {
    return (
      <Callout tone="warn">
        <p role="alert" style={{ marginBottom: 0 }}>
          {error}
        </p>
      </Callout>
    );
  }

  if (!rounds) return <p className="muted">Loading…</p>;
  if (!round) return <p className="muted">Nothing to sabotage.</p>;

  const filledCount = answers.filter((a) => a.trim()).length;

  return (
    <div className="stack-lg" style={{ maxWidth: 'var(--measure)' }}>
      <div>
        <p className="eyebrow">
          The Saboteur &middot; {index + 1} of {rounds.length}
        </p>
        <h1 ref={headingRef} tabIndex={-1} style={{ outline: 'none', fontSize: 'var(--step-3)' }}>
          Make it worse
        </h1>
      </div>

      <Callout tone="note">
        <p style={{ marginBottom: 0, fontSize: 'var(--step-1)' }}>{round.promptText}</p>
      </Callout>

      <div className="stack-sm">
        {answers.map((answer, i) => (
          <div key={i} className="field" style={{ marginBottom: 0 }}>
            <label className="sr-only" htmlFor={`saboteur-${index}-${i}`}>
              Idea {i + 1}
            </label>
            <input
              id={`saboteur-${index}-${i}`}
              className="input"
              style={{ maxWidth: '100%' }}
              value={answer}
              onChange={(e) => updateAnswer(i, e.target.value)}
              placeholder={i === 0 ? 'The first thing that comes to mind…' : 'Another one…'}
              maxLength={300}
              autoFocus={i === 0}
              autoComplete="off"
            />
          </div>
        ))}

        {answers.length < MAX_ANSWERS && filledCount === answers.length && (
          <button
            type="button"
            className="btn btn--quiet"
            onClick={() => setAnswers((prev) => [...prev, ''])}
          >
            + Another idea
          </button>
        )}
      </div>

      {error && (
        <Callout tone="warn">
          <p role="alert" style={{ marginBottom: 0 }}>
            {error}
          </p>
        </Callout>
      )}

      <div className="btn-row btn-row--split">
        <Button variant="quiet" onClick={() => submit(true)} disabled={busy}>
          Nothing comes to mind
        </Button>
        <Button variant="accent" onClick={() => submit(false)} disabled={busy || filledCount === 0}>
          {busy ? 'Saving…' : index < rounds.length - 1 ? 'Next' : 'Done'}
        </Button>
      </div>

      <p className="faint">
        Do not overthink it. The first, silliest thing you think of is usually the most useful
        answer.
      </p>
    </div>
  );
}
