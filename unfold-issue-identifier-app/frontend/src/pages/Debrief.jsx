import { useEffect, useRef, useState } from 'react';
import Layout from '../components/Layout.jsx';
import { Button, Callout } from '../components/Field.jsx';
import { TIME_BANDS } from '../components/DayStrip.jsx';
import { ContactBlock } from '../components/ConsentForm.jsx';
import { api } from '../api/client.js';
import { useSession } from '../state/SessionContext.jsx';

/**
 * The debrief and end card.
 *
 * Two things happen here that are not optional.
 *
 * The foils are disclosed. The deck the participant rated contained fabricated
 * issues they were not told about, and naming them afterwards is what keeps
 * that deception minimal and defensible rather than simply undisclosed.
 *
 * The participant code is shown prominently, because it is the only key they
 * have to ask for their data back.
 */
export default function Debrief() {
  const { session, studyInfo, track } = useSession();

  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [showFoils, setShowFoils] = useState(false);
  const [copied, setCopied] = useState(false);
  const arrivedAt = useRef(Date.now());
  const marked = useRef(false);

  useEffect(() => {
    track('page_view', { page: 'debrief' });

    api
      .debrief()
      .then((payload) => {
        setData(payload);
        if (!marked.current) {
          marked.current = true;
          api
            .debriefViewed({
              foilsRevealed: true,
              dayShown: true,
              durationMs: Date.now() - arrivedAt.current,
            })
            .catch(() => {});
        }
      })
      .catch((err) => setError(err.message));
  }, [track]);

  const code = data?.participantCode || session?.participantCode;

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard access is blocked in some contexts. The code is on screen
      // anyway, so this is a convenience, not a requirement.
    }
  };

  if (error) {
    return (
      <Layout step="done">
        <Callout tone="warn">
          <p role="alert" style={{ marginBottom: 0 }}>
            {error}
          </p>
        </Callout>
      </Layout>
    );
  }

  if (!data) {
    return (
      <Layout step="done">
        <p className="muted">Loading…</p>
      </Layout>
    );
  }

  const kept = data.issues.filter((i) => !i.rejected);
  const rejected = data.issues.filter((i) => i.rejected);
  const foilsRejected = data.foils.filter((f) => f.rejected).length;

  return (
    <Layout step="done">
      <div className="stack-lg">
        <div>
          <p className="eyebrow">Finished</p>
          <h1>Thank you — that is everything</h1>
          <p className="lede">
            You have just given us something surveys cannot reach: the difficulties you had already
            stopped noticing.
          </p>
        </div>

        <Callout tone="note">
          <h2 style={{ fontSize: 'var(--step-1)' }}>Your participant code</h2>
          <p>
            Write this down. It is the only way to ask us to delete your data later, and we have no
            other way to find you.
          </p>
          <div className="code-display" style={{ maxWidth: '16ch' }}>
            {code}
          </div>
          <div className="btn-row" style={{ marginTop: 'var(--gap-sm)' }}>
            <Button variant="ghost" onClick={copyCode}>
              {copied ? 'Copied' : 'Copy the code'}
            </Button>
          </div>
        </Callout>

        {/* --- the disclosure ------------------------------------------- */}
        <section className="card stack">
          <h2 style={{ fontSize: 'var(--step-1)' }}>One thing we should tell you</h2>
          <p>
            Three of the issues you rated were <strong>not</strong> drawn from your day. We wrote
            them ourselves, and mixed them in on purpose.
          </p>
          <p>
            This is a standard check. People tend to agree with whatever they are shown, so we
            include a few plausible inventions to see whether that is happening. It is not a test of
            you, and there is no right answer — it tells us how much to trust the ratings overall,
            including our own method.
          </p>

          <div className="btn-row">
            <Button variant="ghost" onClick={() => setShowFoils((v) => !v)}>
              {showFoils ? 'Hide them' : 'Show me which three'}
            </Button>
          </div>

          {showFoils && (
            <ul className="stack-sm" style={{ paddingLeft: '1.2rem', margin: 0 }}>
              {data.foils.map((foil) => (
                <li key={foil.id}>
                  <strong>{foil.headline}</strong>
                  {foil.rejected ? (
                    <span className="tag tag--ok" style={{ marginLeft: '0.5ch' }}>
                      you rejected this
                    </span>
                  ) : foil.severity ? (
                    <span className="tag" style={{ marginLeft: '0.5ch' }}>
                      you rated it {foil.severity}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          {showFoils && (
            <p className="muted" style={{ marginBottom: 0 }}>
              {foilsRejected === data.foils.length
                ? 'You rejected all three, which is exactly what we hope to see.'
                : foilsRejected > 0
                  ? `You caught ${foilsRejected} of the three.`
                  : 'You did not reject any of them, which is common and completely fine — it is precisely the tendency this check exists to measure.'}
            </p>
          )}
        </section>

        {/* --- their day ------------------------------------------------ */}
        <section className="stack">
          <h2>The day you rebuilt</h2>
          <div className="debrief-day">
            {TIME_BANDS.map((band) => {
              const episodes = data.day.episodes.filter((e) => e.timeBand === band.key);
              if (episodes.length === 0) return null;
              return (
                <div key={band.key} className="debrief-band">
                  <div className="debrief-band__label" style={{ background: band.color }} />
                  <div>
                    <h3 style={{ fontSize: 'var(--step-0)', marginBottom: 'var(--gap-xs)' }}>
                      {band.label}
                    </h3>
                    <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
                      {episodes.map((episode) => (
                        <li key={episode.id}>{episode.label}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* --- what they kept ------------------------------------------- */}
        <section className="stack">
          <h2>What you told us actually gets in your way</h2>
          {kept.length === 0 ? (
            <p>You rejected everything we found, which is a genuinely useful answer in itself.</p>
          ) : (
            <ol className="stack-sm" style={{ paddingLeft: '1.2rem', margin: 0 }}>
              {[...kept]
                .sort((a, b) => (b.severity || 0) - (a.severity || 0))
                .map((issue) => (
                  <li key={issue.id}>
                    <strong>{issue.headline}</strong>
                    {issue.severity && (
                      <span className="tag tag--warn" style={{ marginLeft: '0.5ch' }}>
                        {issue.severity} / 5
                      </span>
                    )}
                  </li>
                ))}
            </ol>
          )}
          {rejected.length > 0 && (
            <p className="faint">
              You rejected {rejected.length} more that we had wrong. Those corrections are as useful
              to us as the ones you kept.
            </p>
          )}
        </section>

        <section className="stack">
          <h2>What happens next</h2>
          <p>
            Your answers join others in a study of how everyday frictions can be identified and
            turned into design problems worth solving. Everything is analysed under your participant
            code — never your name.
          </p>
          <ContactBlock contacts={studyInfo?.contacts} />
        </section>

        <Callout>
          <p style={{ marginBottom: 0 }}>
            You can close this page now. If you change your mind at any point, go to{' '}
            <a href="/withdraw">the withdrawal page</a> and enter <strong>{code}</strong>.
          </p>
        </Callout>
      </div>
    </Layout>
  );
}
