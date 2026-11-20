import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Callout, TextInput, Select } from '../../components/Field.jsx';
import { api } from '../../api/client.js';
import { useSession } from '../../state/SessionContext.jsx';

/**
 * The Day Reconstruction Board.
 *
 * Anchored to one real day rather than "a typical day", because episodic recall
 * is far more accurate than generalised self-report — which is the whole reason
 * the study rebuilds a day instead of asking a question.
 *
 * The board arrives pre-seeded from the participant's own background. A blank
 * board yields four episodes and a thin day; a seeded one they correct yields
 * ten and an honest one.
 */
export default function DayBoard({ content, onDone }) {
  const { track } = useSession();

  const [game, setGame] = useState(null);
  const [episodes, setEpisodes] = useState([]);
  const [phase, setPhase] = useState('anchor'); // anchor | build | tag
  const [tagIndex, setTagIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [adding, setAdding] = useState(null);
  const headingRef = useRef(null);

  const yesterday = useMemo(() => new Date(Date.now() - 86400000), []);
  const yesterdayLabel = yesterday.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  useEffect(() => {
    track('page_view', { page: 'day_board' });
    api
      .gameState()
      .then((state) => {
        if (state.game) {
          setGame(state.game);
          setEpisodes(state.episodes);
          setPhase(state.episodes.some((e) => e.tags.length > 0) ? 'tag' : 'build');
        }
      })
      .catch(() => {});
  }, [track]);

  const start = async (isTypical) => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.gameStart({
        anchorDate: yesterday.toISOString().slice(0, 10),
        anchorIsTypical: isTypical,
      });
      setGame(result.game);
      setEpisodes(result.episodes);
      setPhase('build');
      track('game_started', { isTypical });
    } catch (err) {
      setError(err.message || 'We could not start the day board.');
    } finally {
      setBusy(false);
    }
  };

  const removeEpisode = async (id) => {
    const result = await api.deleteEpisode(id);
    setEpisodes(result.episodes);
    track('episode_removed');
  };

  const addEpisode = async (draft) => {
    setBusy(true);
    try {
      const result = await api.addEpisode(draft);
      setEpisodes(result.episodes);
      setAdding(null);
      track('episode_added', { source: draft.templateId ? 'template' : 'participant' });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const setTags = async (episodeId, tokens) => {
    const result = await api.setEpisodeTags(episodeId, tokens);
    setEpisodes(result.episodes);
  };

  const bandsWithEpisodes = useMemo(() => {
    return content.timeBands.map((band) => ({
      ...band,
      episodes: episodes.filter((e) => e.timeBand === band.key),
    }));
  }, [content.timeBands, episodes]);

  // --- anchor -------------------------------------------------------------
  if (phase === 'anchor' || !game) {
    return (
      <div className="stack-lg" style={{ maxWidth: 'var(--measure)' }}>
        <div>
          <p className="eyebrow">Your day</p>
          <h1>Let us start with yesterday</h1>
          <p className="lede">
            We are going to rebuild <strong>{yesterdayLabel}</strong> together, piece by piece. Not a
            typical day — that one specific day, because people remember a real day far better than
            an average one.
          </p>
        </div>

        {error && (
          <Callout tone="warn">
            <p role="alert" style={{ marginBottom: 0 }}>
              {error}
            </p>
          </Callout>
        )}

        <div className="card stack">
          <h2 style={{ fontSize: 'var(--step-1)' }}>Was yesterday a fairly ordinary day for you?</h2>
          <p className="muted">
            It does not have to have been a good day. Just a normal one rather than a holiday, a
            wedding, or a day you were ill.
          </p>
          <div className="btn-row">
            <Button variant="accent" onClick={() => start(true)} disabled={busy}>
              Yes, let us use yesterday
            </Button>
            <Button variant="ghost" onClick={() => start(false)} disabled={busy}>
              No, but use it anyway
            </Button>
          </div>
        </div>

        <p className="faint">
          If yesterday was unusual, say so — we record that, and it changes how we read your answers.
        </p>
      </div>
    );
  }

  // --- build --------------------------------------------------------------
  if (phase === 'build') {
    return (
      <div className="stack-lg">
        <div>
          <p className="eyebrow">Your day &middot; part 1 of 2</p>
          <h1 ref={headingRef} tabIndex={-1} style={{ outline: 'none' }}>
            Does this look like your {game.anchorDayOfWeek}?
          </h1>
          <p className="lede">
            We have guessed a rough shape from what you told us. Delete what did not happen, and add
            what we missed. It does not need to be complete — eight to twelve moments is plenty.
          </p>
        </div>

        {error && (
          <Callout tone="warn">
            <p role="alert" style={{ marginBottom: 0 }}>
              {error}
            </p>
          </Callout>
        )}

        <div className="stack">
          {bandsWithEpisodes.map((band) => (
            <section key={band.key} className="band">
              <div className="band__header">
                <h2 className="band__title">{band.label}</h2>
                <span className="band__window">{band.window}</span>
              </div>

              <div className="band__episodes">
                {band.episodes.map((episode) => (
                  <div key={episode.id} className="episode-card">
                    <div className="episode-card__body">
                      <div className="episode-card__label">{episode.label}</div>
                      {episode.description && (
                        <div className="episode-card__desc">{episode.description}</div>
                      )}
                    </div>
                    <button
                      type="button"
                      className="episode-card__remove"
                      onClick={() => removeEpisode(episode.id)}
                      aria-label={`Remove ${episode.label}`}
                    >
                      &times;
                    </button>
                  </div>
                ))}

                {adding === band.key ? (
                  <AddEpisode
                    band={band}
                    domains={content.domains}
                    templates={content.templates.filter(
                      (t) =>
                        t.timeBand === band.key &&
                        !episodes.some((e) => e.templateId === t.id)
                    )}
                    onCancel={() => setAdding(null)}
                    onAdd={addEpisode}
                    busy={busy}
                  />
                ) : (
                  <button type="button" className="episode-add" onClick={() => setAdding(band.key)}>
                    + Add something to {band.label.toLowerCase()}
                  </button>
                )}
              </div>
            </section>
          ))}
        </div>

        <div className="btn-row btn-row--split">
          <span className="faint">
            {episodes.length} {episodes.length === 1 ? 'moment' : 'moments'} on your day
          </span>
          <Button
            variant="accent"
            onClick={() => {
              setPhase('tag');
              setTagIndex(0);
              track('day_built', { episodeCount: episodes.length });
            }}
            disabled={episodes.length < 3}
          >
            {episodes.length < 3 ? 'Add at least three' : 'That looks right'}
          </Button>
        </div>
      </div>
    );
  }

  // --- tag ----------------------------------------------------------------
  const episode = episodes[tagIndex];
  if (!episode) {
    return (
      <div className="stack-lg">
        <p className="muted">Nothing to tag.</p>
        <Button variant="accent" onClick={() => onDone(episodes)}>
          Continue
        </Button>
      </div>
    );
  }

  const selected = episode.tags || [];

  const next = () => {
    if (tagIndex < episodes.length - 1) {
      setTagIndex((i) => i + 1);
      headingRef.current?.focus();
    } else {
      track('day_tagged');
      onDone(episodes);
    }
  };

  return (
    <div className="stack-lg" style={{ maxWidth: 'var(--measure)' }}>
      <div>
        <p className="eyebrow">
          Your day &middot; part 2 of 2 &middot; {tagIndex + 1} of {episodes.length}
        </p>
        <h1 ref={headingRef} tabIndex={-1} style={{ outline: 'none', fontSize: 'var(--step-3)' }}>
          {episode.label}
        </h1>
        <p className="lede">How did that go? Pick as many as fit, or none.</p>
      </div>

      <fieldset className="token-grid">
        <legend className="sr-only">How {episode.label} felt</legend>
        {content.tokens.map((token) => {
          const on = selected.includes(token.key);
          return (
            <label
              key={token.key}
              className={`token ${on ? 'token--on' : ''} ${token.negative ? '' : 'token--positive'}`}
            >
              <input
                type="checkbox"
                checked={on}
                onChange={() =>
                  setTags(
                    episode.id,
                    on ? selected.filter((t) => t !== token.key) : [...selected, token.key]
                  )
                }
              />
              <span className="token__label">{token.label}</span>
              <span className="token__hint">{token.hint}</span>
            </label>
          );
        })}
      </fieldset>

      <div className="btn-row btn-row--split">
        <Button
          variant="ghost"
          onClick={() => setTagIndex((i) => Math.max(0, i - 1))}
          disabled={tagIndex === 0}
        >
          Back
        </Button>
        <Button variant="accent" onClick={next}>
          {tagIndex < episodes.length - 1 ? 'Next moment' : 'Done'}
        </Button>
      </div>

      <p className="faint">
        Leaving one blank is a real answer. Not every moment of a day is remarkable.
      </p>
    </div>
  );
}

function AddEpisode({ band, domains, templates, onCancel, onAdd, busy }) {
  const [label, setLabel] = useState('');
  const [domain, setDomain] = useState(null);

  return (
    <div className="card card--flush stack-sm">
      {templates.length > 0 && (
        <div>
          <p className="field__help" style={{ marginBottom: 'var(--gap-xs)' }}>
            Common ones for {band.label.toLowerCase()}:
          </p>
          <div className="btn-row">
            {templates.slice(0, 4).map((template) => (
              <button
                key={template.id}
                type="button"
                className="btn btn--ghost"
                style={{ minHeight: 40, padding: '0.4rem 0.8rem' }}
                onClick={() =>
                  onAdd({
                    label: template.label,
                    description: template.description,
                    timeBand: band.key,
                    domain: template.domain,
                    templateId: template.id,
                  })
                }
                disabled={busy}
              >
                {template.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <TextInput
        label="Or write your own"
        value={label}
        onChange={setLabel}
        maxLength={140}
        placeholder="What happened?"
      />

      <Select
        label="Roughly what was it about?"
        value={domain}
        onChange={setDomain}
        optional
        options={domains.map((d) => ({ value: d.key, label: d.label }))}
      />

      <div className="btn-row">
        <Button
          variant="primary"
          onClick={() => onAdd({ label, timeBand: band.key, domain })}
          disabled={busy || label.trim().length < 2}
        >
          Add it
        </Button>
        <Button variant="quiet" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
