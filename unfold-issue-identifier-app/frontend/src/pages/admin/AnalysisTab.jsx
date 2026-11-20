import { Callout } from '../../components/Field.jsx';

export const fmt = (v) => (v == null ? '—' : Number(v).toFixed(2));
export const pct = (v) => (v == null ? '—' : `${Math.round(v * 100)}%`);
export const mins = (ms) => (ms == null ? '—' : `${Math.round(ms / 60000)} min`);

export function Stat({ label, value }) {
  return (
    <div className="stat">
      <div className="stat__value">{value ?? 0}</div>
      <div className="stat__label">{label}</div>
    </div>
  );
}

function BarList({ rows, teal = false }) {
  if (!rows || rows.length === 0) return <p className="faint">No data yet.</p>;
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div>
      {rows.map((row) => (
        <div key={row.label} className="bar-row">
          <span>{row.label}</span>
          <span className="bar-track">
            <span
              className={`bar-fill ${teal ? 'bar-fill--teal' : ''}`}
              style={{ width: `${(row.value / max) * 100}%` }}
            />
          </span>
          <span className="faint">
            {row.value}
            {row.note ? ` · ${row.note}` : ''}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * The analysis view.
 *
 * The acquiescence check leads deliberately. It is what tells you whether any
 * severity number further down the page can be believed, so it must not sit
 * below them.
 */
export default function AnalysisTab({ analysis }) {
  const { foils, friction, provenance, extraction, completion, questionnaire } = analysis;
  const flagged = foils.perSession.filter((r) => r.flagged);

  return (
    <div className="stack-lg">
      <section className="stack">
        <h2 style={{ fontSize: 'var(--step-2)' }}>Acquiescence check</h2>
        <p className="muted">
          Every participant rates three fabricated issues alongside their real ones. A healthy gap
          means real issues scored higher than invented ones. A gap near zero means the participant
          agreed with whatever they were shown.
        </p>

        <div className="stat-grid">
          <Stat label="Mean real severity" value={fmt(foils.summary.meanRealSeverity)} />
          <Stat label="Mean foil severity" value={fmt(foils.summary.meanFoilSeverity)} />
          <Stat label="Mean gap" value={fmt(foils.summary.meanGap)} />
          <Stat label="Foils rejected" value={pct(foils.summary.foilRejectionRate)} />
          <Stat label="Real rejected" value={pct(foils.summary.realRejectionRate)} />
          <Stat label="Flagged participants" value={foils.summary.flaggedSessions} />
        </div>

        {flagged.length > 0 && (
          <Callout tone="warn">
            <p style={{ marginBottom: 0 }}>
              {flagged.length} {flagged.length === 1 ? 'participant' : 'participants'} rated the
              fabricated issues about as highly as their own (
              {flagged.map((r) => r.participantCode).join(', ')}). Treat those rows with caution.
            </p>
          </Callout>
        )}

        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Real mean</th>
                <th>Foil mean</th>
                <th>Gap</th>
                <th>Foils rejected</th>
                <th>Real rejected</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {foils.perSession.map((row) => (
                <tr key={row.participantCode}>
                  <td>
                    <code>{row.participantCode}</code>
                  </td>
                  <td>{fmt(row.realMean)}</td>
                  <td>{fmt(row.foilMean)}</td>
                  <td>{fmt(row.gap)}</td>
                  <td>
                    {row.foilsRejected} / {row.foilsShown}
                  </td>
                  <td>
                    {row.realRejected} / {row.realShown}
                  </td>
                  <td>{row.flagged && <span className="tag tag--bad">yea-saying</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="stack">
        <h2 style={{ fontSize: 'var(--step-2)' }}>Where the friction sits</h2>
        <div className="analysis-grid">
          <div className="card stack-sm">
            <h3 style={{ fontSize: 'var(--step-0)' }}>By domain</h3>
            <BarList
              rows={friction.byDomain.map((d) => ({
                label: d.label,
                value: d.issues,
                note: d.meanSeverity ? `${fmt(d.meanSeverity)} avg` : '',
              }))}
            />
          </div>

          <div className="card stack-sm">
            <h3 style={{ fontSize: 'var(--step-0)' }}>By time of day</h3>
            <BarList
              rows={friction.byBand.map((b) => ({
                label: b.label,
                value: b.issues,
                note: b.meanSeverity ? `${fmt(b.meanSeverity)} avg` : '',
              }))}
            />
          </div>

          <div className="card stack-sm">
            <h3 style={{ fontSize: 'var(--step-0)' }}>Emotion tokens used</h3>
            <BarList
              teal
              rows={friction.byToken.map((t) => ({
                label: t.label,
                value: t.uses,
                note: `${t.sessions} sessions`,
              }))}
            />
          </div>
        </div>
      </section>

      <section className="stack">
        <h2 style={{ fontSize: 'var(--step-2)' }}>CAE provenance</h2>
        <p className="muted">
          How much of the corpus came from participants rather than being filled in by the model. A
          corpus that is almost entirely inferred describes the model, not anyone&rsquo;s day.
        </p>
        <div className="stat-grid">
          <Stat label="Issues extracted" value={provenance.total} />
          <Stat label="Cause from participant" value={pct(provenance.cause.rate)} />
          <Stat label="Affect from participant" value={pct(provenance.affect.rate)} />
          <Stat label="Effect from participant" value={pct(provenance.effect.rate)} />
        </div>
      </section>

      <section className="stack">
        <h2 style={{ fontSize: 'var(--step-2)' }}>Extraction health</h2>
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Runs</th>
                <th>Mean latency</th>
              </tr>
            </thead>
            <tbody>
              {extraction.byStatus.map((row) => (
                <tr key={row.status}>
                  <td>
                    <span
                      className={`tag ${
                        row.status === 'ok'
                          ? 'tag--ok'
                          : row.status === 'error'
                            ? 'tag--bad'
                            : 'tag--warn'
                      }`}
                    >
                      {row.status}
                    </span>
                  </td>
                  <td>{row.runs}</td>
                  <td>{(row.meanLatencyMs / 1000).toFixed(1)}s</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="faint">
          Tokens used: {extraction.tokens.input.toLocaleString()} in,{' '}
          {extraction.tokens.output.toLocaleString()} out.
        </p>
        {extraction.recentErrors.length > 0 && (
          <details>
            <summary>Recent extraction problems ({extraction.recentErrors.length})</summary>
            <ul className="stack-sm" style={{ paddingLeft: '1.2rem' }}>
              {extraction.recentErrors.map((e) => (
                <li key={e.id}>
                  <code>{e.participant_code}</code> — {e.error_message}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      <section className="stack">
        <h2 style={{ fontSize: 'var(--step-2)' }}>Timing</h2>
        <div className="stat-grid">
          <Stat label="Median session" value={mins(completion.medianSessionMs)} />
          <Stat label="Median game" value={mins(completion.medianGameMs)} />
          <Stat label="Completed with timing" value={completion.completedWithTiming} />
        </div>
      </section>

      <section className="stack">
        <h2 style={{ fontSize: 'var(--step-2)' }}>Post-questionnaire</h2>
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th style={{ whiteSpace: 'normal', minWidth: '20rem' }}>Question</th>
                <th>n</th>
                <th>Mean</th>
              </tr>
            </thead>
            <tbody>
              {questionnaire.scales.map((row) => (
                <tr key={row.key}>
                  <td style={{ whiteSpace: 'normal' }}>{row.text}</td>
                  <td>{row.n}</td>
                  <td>{fmt(row.mean)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {questionnaire.freeText.length > 0 && (
          <details>
            <summary>Free-text answers ({questionnaire.freeText.length})</summary>
            <ul className="stack-sm" style={{ paddingLeft: '1.2rem' }}>
              {questionnaire.freeText.map((row, i) => (
                <li key={i}>
                  <code>{row.participant_code}</code>{' '}
                  <span className="faint">{row.question_key}</span>
                  <br />
                  {row.response_text}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
    </div>
  );
}
