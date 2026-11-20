import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout.jsx';
import { Button, Callout, TextArea } from '../components/Field.jsx';
import { api } from '../api/client.js';
import { useSession } from '../state/SessionContext.jsx';

const SEVERITY = [
  { value: 1, label: 'Not at all severe' },
  { value: 2, label: 'Slightly' },
  { value: 3, label: 'Moderately' },
  { value: 4, label: 'Quite' },
  { value: 5, label: 'Definitely severe' },
];

/**
 * The rating screen.
 *
 * Two deliberate choices, both aimed at acquiescence bias:
 *
 *  - "This is not me" sits at the same visual weight as the scale, not tucked
 *    under it. If rejecting is harder than agreeing, everyone agrees.
 *  - Recognition is asked before severity. "Is this yours?" and "how bad is it?"
 *    are different questions, and collapsing them into one scale loses the
 *    first.
 *
 * The deck contains fabricated foils the participant is not told about. That is
 * what makes the acquiescence measure work, and it is disclosed at debrief.
 */
export default function Rating() {
  const navigate = useNavigate();
  const { track } = useSession();

  const [issues, setIssues] = useState(null);
  const [index, setIndex] = useState(0);
  const [ratings, setRatings] = useState({});
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({});
  const [status, setStatus] = useState('extracting');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const shownAt = useRef(Date.now());
  const headingRef = useRef(null);

  useEffect(() => {
    track('page_view', { page: 'rating' });

    (async () => {
      try {
        // Extraction is idempotent, so a refresh mid-way does not spend another
        // API call or rebuild the deck underneath the participant.
        const result = await api.extractIssues();
        setIssues(result.issues);
        setStatus(result.issues.length > 0 ? 'rating' : 'empty');
        track('issues_extracted', { count: result.issues.length, reused: result.reused });
      } catch (err) {
        setError(err.message || 'We could not work out your issues.');
        setStatus('error');
      }
    })();
  }, [track]);

  const issue = issues?.[index];

  const record = async (payload) => {
    setBusy(true);
    try {
      const body = {
        ...payload,
        responseMs: Date.now() - shownAt.current,
      };
      await api.rateIssue(issue.id, body);
      setRatings((prev) => ({ ...prev, [issue.id]: body }));
      track('issue_rated', {
        rejected: Boolean(payload.rejected),
        severity: payload.severity ?? null,
        ordinal: index,
      });

      setEditing(false);
      setDraft({});
      shownAt.current = Date.now();

      if (index < issues.length - 1) {
        setIndex((i) => i + 1);
        headingRef.current?.focus();
      } else {
        await api.completeRatings();
        navigate('/how-was-that');
      }
    } catch (err) {
      setError(err.message || 'We could not save that rating.');
    } finally {
      setBusy(false);
    }
  };

  if (status === 'extracting') {
    return (
      <Layout step="issues">
        <div className="stack-lg" style={{ maxWidth: 'var(--measure)' }}>
          <h1>Reading your day back</h1>
          <p className="lede">
            Working out what actually got in your way. This takes a few seconds.
          </p>
          <div className="day-strip__track" aria-hidden="true">
            <div className="day-strip__seg extracting-shimmer" style={{ flex: 1 }} />
          </div>
          <p className="faint" role="status">
            Please do not close this page.
          </p>
        </div>
      </Layout>
    );
  }

  if (status === 'error') {
    return (
      <Layout step="issues">
        <div className="stack-lg">
          <h1>Something went wrong on our side</h1>
          <Callout tone="warn">
            <p style={{ marginBottom: 0 }}>{error}</p>
          </Callout>
          <Button variant="accent" onClick={() => window.location.reload()}>
            Try again
          </Button>
        </div>
      </Layout>
    );
  }

  if (status === 'empty') {
    return (
      <Layout step="issues">
        <div className="stack-lg">
          <h1>We did not find enough to show you</h1>
          <p>
            That usually means the day you rebuilt was a genuinely smooth one, which is a perfectly
            good result. Thank you for taking part.
          </p>
          <Button variant="accent" onClick={() => navigate('/how-was-that')}>
            Continue
          </Button>
        </div>
      </Layout>
    );
  }

  const existing = ratings[issue.id];

  return (
    <Layout step="issues">
      <div className="stack-lg" style={{ maxWidth: 'var(--measure)' }}>
        <div>
          <p className="eyebrow">
            What we found &middot; {index + 1} of {issues.length}
          </p>
          <h1
            ref={headingRef}
            tabIndex={-1}
            style={{ outline: 'none', fontSize: 'var(--step-2)' }}
          >
            {issue.headline}
          </h1>
        </div>

        <article className="cae-card">
          <div className="cae-row">
            <span className="cae-slot">Because</span>
            <p className="cae-text">{issue.cause}</p>
          </div>
          <div className="cae-row">
            <span className="cae-slot">You feel</span>
            <p className="cae-text">{issue.affect}</p>
          </div>
          <div className="cae-row">
            <span className="cae-slot">And so</span>
            <p className="cae-text">{issue.effect}</p>
          </div>
        </article>

        {editing ? (
          <div className="card stack-sm">
            <h2 style={{ fontSize: 'var(--step-1)' }}>Put it in your own words</h2>
            <p className="field__help">
              Change whatever we got wrong. We keep both versions, and yours is the one that counts.
            </p>
            <TextArea
              label="What actually happens"
              value={draft.editedCause ?? issue.cause}
              onChange={(v) => setDraft((d) => ({ ...d, editedCause: v }))}
              maxLength={500}
            />
            <TextArea
              label="How it makes you feel"
              value={draft.editedAffect ?? issue.affect}
              onChange={(v) => setDraft((d) => ({ ...d, editedAffect: v }))}
              maxLength={500}
            />
            <TextArea
              label="What it does to your day"
              value={draft.editedEffect ?? issue.effect}
              onChange={(v) => setDraft((d) => ({ ...d, editedEffect: v }))}
              maxLength={500}
            />
            <div className="btn-row">
              <Button variant="primary" onClick={() => setEditing(false)}>
                Keep these changes
              </Button>
              <Button
                variant="quiet"
                onClick={() => {
                  setDraft({});
                  setEditing(false);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="btn-row">
            <Button variant="quiet" onClick={() => setEditing(true)}>
              We got the wording wrong — let me fix it
            </Button>
          </div>
        )}

        <section className="stack-sm" aria-labelledby="severity-heading">
          <h2 id="severity-heading" style={{ fontSize: 'var(--step-1)' }}>
            How severe is this in your life?
          </h2>
          <div className="severity-scale">
            {SEVERITY.map((point) => (
              <button
                key={point.value}
                type="button"
                className={`severity ${existing?.severity === point.value ? 'severity--on' : ''}`}
                onClick={() => record({ ...draft, severity: point.value, recognised: true })}
                disabled={busy}
              >
                <span className="severity__value">{point.value}</span>
                <span className="severity__label">{point.label}</span>
              </button>
            ))}
          </div>
        </section>

        {/* Rejection sits at the same weight as the scale. If saying no is
            harder than saying yes, everybody says yes. */}
        <div className="card card--flush">
          <div className="btn-row btn-row--split">
            <span className="muted">Not something you run into?</span>
            <Button
              variant="ghost"
              onClick={() => record({ ...draft, rejected: true, recognised: false })}
              disabled={busy}
            >
              This one is not me
            </Button>
          </div>
        </div>

        {error && (
          <Callout tone="warn">
            <p role="alert" style={{ marginBottom: 0 }}>
              {error}
            </p>
          </Callout>
        )}

        <div className="btn-row btn-row--split">
          <Button
            variant="quiet"
            onClick={() => {
              setIndex((i) => Math.max(0, i - 1));
              setEditing(false);
            }}
            disabled={index === 0 || busy}
          >
            Back
          </Button>
          <span className="faint">
            {Object.keys(ratings).length} of {issues.length} answered
          </span>
        </div>
      </div>
    </Layout>
  );
}
