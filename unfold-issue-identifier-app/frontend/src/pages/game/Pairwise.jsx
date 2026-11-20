import { useEffect, useRef, useState } from 'react';
import { Button, Callout } from '../../components/Field.jsx';
import { api } from '../../api/client.js';
import { useSession } from '../../state/SessionContext.jsx';

/**
 * Forced choice.
 *
 * "Which of these two would you pay to delete?" produces a severity ranking
 * without asking anybody to rate anything — which matters because a direct
 * severity question invites people to be even-handed, and a forced choice does
 * not let them.
 */
export default function Pairwise({ onDone }) {
  const { track } = useSession();

  const [rounds, setRounds] = useState(null);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const shownAt = useRef(Date.now());
  const headingRef = useRef(null);

  useEffect(() => {
    track('page_view', { page: 'pairwise' });
    api
      .pairwisePlan()
      .then((plan) => {
        setRounds(plan.rounds);
        if (plan.rounds.length === 0) onDone();
      })
      .catch((err) => setError(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const round = rounds?.[index];

  const choose = async (side) => {
    setBusy(true);
    setError(null);
    try {
      await api.pairwiseChoice(round.id, {
        chosenSide: side,
        responseMs: Date.now() - shownAt.current,
      });
      track('pairwise_choice', { side, ordinal: index });

      shownAt.current = Date.now();
      if (index < rounds.length - 1) {
        setIndex((i) => i + 1);
        headingRef.current?.focus();
      } else {
        track('pairwise_complete', { rounds: rounds.length });
        onDone();
      }
    } catch (err) {
      setError(err.message || 'We could not save that choice.');
    } finally {
      setBusy(false);
    }
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
  if (!round) return <p className="muted">Nothing to compare.</p>;

  return (
    <div className="stack-lg" style={{ maxWidth: 'var(--measure)' }}>
      <div>
        <p className="eyebrow">
          Two at a time &middot; {index + 1} of {rounds.length}
        </p>
        <h1 ref={headingRef} tabIndex={-1} style={{ outline: 'none', fontSize: 'var(--step-3)' }}>
          Which would you rather never do again?
        </h1>
        <p className="lede">
          Suppose you could delete one of these from your day forever. Which goes?
        </p>
      </div>

      <div className="pair-grid">
        <button
          type="button"
          className="pair-option"
          onClick={() => choose('left')}
          disabled={busy}
        >
          {round.left.text}
        </button>

        <div className="pair-or" aria-hidden="true">
          or
        </div>

        <button
          type="button"
          className="pair-option"
          onClick={() => choose('right')}
          disabled={busy}
        >
          {round.right.text}
        </button>
      </div>

      {error && (
        <Callout tone="warn">
          <p role="alert" style={{ marginBottom: 0 }}>
            {error}
          </p>
        </Callout>
      )}

      <div className="btn-row">
        <Button variant="quiet" onClick={() => choose('skipped')} disabled={busy}>
          They are about the same
        </Button>
      </div>
    </div>
  );
}
