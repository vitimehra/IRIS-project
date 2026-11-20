import { useState } from 'react';
import { Button } from '../../components/Field.jsx';

function ProvenanceTag({ value }) {
  return (
    <span
      className={`tag ${value === 'participant' ? 'tag--ok' : ''}`}
      style={{ marginLeft: '0.5ch', textTransform: 'none', letterSpacing: 0 }}
    >
      {value}
    </span>
  );
}

/**
 * The extracted corpus in CAE form.
 *
 * Provenance is shown per slot rather than per issue, because that is the level
 * at which it varies: a Cause quoted from a Saboteur answer sitting next to an
 * Effect the model reasoned its way to is the normal case, and the difference
 * matters when reading the corpus.
 */
export default function IssuesTab({ issues }) {
  const [showFoils, setShowFoils] = useState(false);
  const [onlyRated, setOnlyRated] = useState(false);

  let visible = showFoils ? issues : issues.filter((i) => !i.is_foil);
  if (onlyRated) visible = visible.filter((i) => i.severity != null || i.rejected);

  return (
    <div className="stack">
      <div className="btn-row btn-row--split">
        <span className="muted">
          {visible.length} {visible.length === 1 ? 'issue' : 'issues'}
        </span>
        <span className="btn-row">
          <Button variant="ghost" onClick={() => setOnlyRated((v) => !v)}>
            {onlyRated ? 'Show all' : 'Only rated'}
          </Button>
          <Button variant="ghost" onClick={() => setShowFoils((v) => !v)}>
            {showFoils ? 'Hide foils' : 'Show foils'}
          </Button>
        </span>
      </div>

      <div className="stack-sm">
        {visible.map((issue) => (
          <article key={issue.id} className="card card--flush stack-sm">
            <div className="btn-row btn-row--split">
              <strong>{issue.headline}</strong>
              <span className="btn-row">
                <code className="faint">{issue.participant_code}</code>
                {issue.is_foil ? <span className="tag tag--bad">foil</span> : null}
                {issue.rejected ? (
                  <span className="tag">rejected</span>
                ) : issue.severity ? (
                  <span className="tag tag--warn">{issue.severity} / 5</span>
                ) : (
                  <span className="tag">unrated</span>
                )}
                {!issue.shown_to_participant && <span className="tag">not shown</span>}
              </span>
            </div>

            <div className="cae-card">
              <div className="cae-row">
                <span className="cae-slot">
                  Cause <ProvenanceTag value={issue.cause_provenance} />
                </span>
                <p className="cae-text">{issue.cause}</p>
              </div>
              <div className="cae-row">
                <span className="cae-slot">
                  Affect <ProvenanceTag value={issue.affect_provenance} />
                </span>
                <p className="cae-text">{issue.affect}</p>
              </div>
              <div className="cae-row">
                <span className="cae-slot">
                  Effect <ProvenanceTag value={issue.effect_provenance} />
                </span>
                <p className="cae-text">{issue.effect}</p>
              </div>
            </div>

            {issue.source_evidence && (
              <p className="faint" style={{ marginBottom: 0 }}>
                Evidence: &ldquo;{issue.source_evidence}&rdquo;
              </p>
            )}
            {issue.edit_note && (
              <p className="faint" style={{ marginBottom: 0 }}>
                Participant note: {issue.edit_note}
              </p>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}
