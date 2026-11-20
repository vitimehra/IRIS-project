import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout.jsx';
import { Button, Callout, TextArea } from '../components/Field.jsx';
import { api } from '../api/client.js';
import { useSession } from '../state/SessionContext.jsx';

/**
 * Feedback about the instrument, kept separate from the ratings.
 *
 * The ratings are data about the participant's life; these questions are data
 * about whether the method worked. Mixing them on one screen would make both
 * harder to read.
 */
/** Optional-chained through the method itself: jsdom and some webviews lack it. */
function scrollTo(elementId) {
  const el = globalThis.document?.getElementById(elementId);
  el?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
}

export default function PostQuestionnaire() {
  const navigate = useNavigate();
  const { track } = useSession();

  const [schema, setSchema] = useState(null);
  const [answers, setAnswers] = useState({});
  const [errors, setErrors] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const timings = useRef({});
  const startedAt = useRef(Date.now());

  useEffect(() => {
    track('page_view', { page: 'post_questionnaire' });
    api.questionnaireSchema().then(setSchema).catch(() => {});
  }, [track]);

  const setAnswer = (key, value) => {
    if (timings.current[key] === undefined) {
      timings.current[key] = Date.now() - startedAt.current;
    }
    setAnswers((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => prev.filter((k) => k !== key));
  };

  const submit = async () => {
    const missing = schema.questions
      .filter((q) => q.required && !answers[q.key])
      .map((q) => q.key);

    if (missing.length > 0) {
      setErrors(missing);
      scrollTo(`question-${missing[0]}`);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await api.submitQuestionnaire({ answers, timings: timings.current });
      track('questionnaire_submitted');
      navigate('/thank-you');
    } catch (err) {
      setError(err.message || 'We could not save your answers.');
      setBusy(false);
    }
  };

  if (!schema) {
    return (
      <Layout step="done">
        <p className="muted">Loading…</p>
      </Layout>
    );
  }

  return (
    <Layout step="done">
      <div className="stack-lg" style={{ maxWidth: 'var(--measure)' }}>
        <div>
          <p className="eyebrow">Almost done</p>
          <h1>How was that?</h1>
          <p className="lede">
            Eight short questions about the study itself, not about your day. They tell us whether
            the method actually worked.
          </p>
        </div>

        {schema.questions.map((question) => {
          const flagged = errors.includes(question.key);
          return (
            <section
              key={question.key}
              id={`question-${question.key}`}
              className={`card stack-sm ${flagged ? 'card--flagged' : ''}`}
            >
              <h2 style={{ fontSize: 'var(--step-0)', fontFamily: 'var(--font-body)', fontWeight: 600 }}>
                {question.text}
                {!question.required && <span className="field__optional">optional</span>}
              </h2>
              {question.help && <p className="field__help">{question.help}</p>}

              {question.type === 'text' ? (
                <TextArea
                  label={question.text}
                  labelHidden
                  value={answers[question.key] || ''}
                  onChange={(v) => setAnswer(question.key, v)}
                  placeholder={question.placeholder}
                  maxLength={question.maxLength}
                />
              ) : (
                <div className={question.type === 'scale' ? 'scale-row' : 'choice-list'}>
                  {question.options.map((option) => {
                    const on = answers[question.key] === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        className={
                          question.type === 'scale'
                            ? `scale-point ${on ? 'scale-point--on' : ''}`
                            : `choice ${on ? 'choice--checked' : ''}`
                        }
                        onClick={() => setAnswer(question.key, option.value)}
                        aria-pressed={on}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              )}

              {flagged && (
                <p className="field__error" role="alert">
                  Please answer this one before continuing.
                </p>
              )}
            </section>
          );
        })}

        {error && (
          <Callout tone="warn">
            <p role="alert" style={{ marginBottom: 0 }}>
              {error}
            </p>
          </Callout>
        )}

        <div className="btn-row">
          <Button variant="accent" onClick={submit} disabled={busy}>
            {busy ? 'Saving…' : 'Finish'}
          </Button>
        </div>
      </div>
    </Layout>
  );
}
