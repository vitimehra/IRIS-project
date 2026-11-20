import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout.jsx';
import {
  TextInput,
  NumberInput,
  TextArea,
  Select,
  BooleanChoice,
  MultiSelect,
  Callout,
  Button,
} from '../components/Field.jsx';
import { useSession } from '../state/SessionContext.jsx';
import { api } from '../api/client.js';

/** Conditional fields: a childless participant never sees "how many children". */
function shouldShow(field, answers) {
  if (!field.showIf) return true;
  return answers[field.showIf.field] === field.showIf.equals;
}

function FieldRenderer({ field, value, onChange, error }) {
  const common = {
    label: field.label,
    help: field.help,
    optional: field.optional,
    error,
    value,
    onChange,
  };

  switch (field.type) {
    case 'number':
      return <NumberInput {...common} min={field.min} max={field.max} step={field.step} />;
    case 'textarea':
      return <TextArea {...common} maxLength={field.maxLength} />;
    case 'select':
      return <Select {...common} options={field.options} />;
    case 'boolean':
      return <BooleanChoice {...common} />;
    case 'multiselect':
      return <MultiSelect {...common} options={field.options} />;
    default:
      return <TextInput {...common} maxLength={field.maxLength} />;
  }
}

export default function Demographics() {
  const navigate = useNavigate();
  const { applySession, track } = useSession();

  const [schema, setSchema] = useState(null);
  const [answers, setAnswers] = useState({});
  const [stepIndex, setStepIndex] = useState(0);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const startedAt = useRef(Date.now());
  const headingRef = useRef(null);

  useEffect(() => {
    track('page_view', { page: 'demographics' });

    api.demographicsSchema().then((s) => {
      setSchema(s);
      // Seed defaults declared in the schema, e.g. country.
      const seeded = {};
      for (const step of s.steps) {
        for (const field of step.fields) {
          if (field.default !== undefined) seeded[field.key] = field.default;
        }
      }
      setAnswers((prev) => ({ ...seeded, ...prev }));
    });

    // Resume a partially completed form if the participant came back.
    api
      .myDemographics()
      .then((r) => {
        if (r.answers) setAnswers((prev) => ({ ...prev, ...r.answers }));
      })
      .catch(() => {});
  }, [track]);

  const step = schema?.steps[stepIndex];

  const visibleFields = useMemo(
    () => (step ? step.fields.filter((f) => shouldShow(f, answers)) : []),
    [step, answers]
  );

  const setAnswer = (key, value) => {
    setAnswers((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev));
  };

  const validateStep = () => {
    const errs = {};
    for (const field of visibleFields) {
      const value = answers[field.key];
      const empty = value === undefined || value === null || value === '';

      if (field.required && empty) {
        errs[field.key] = 'This one is needed to continue.';
        continue;
      }
      if (!empty && field.type === 'number') {
        if (field.min !== undefined && value < field.min) errs[field.key] = `Must be at least ${field.min}.`;
        if (field.max !== undefined && value > field.max) errs[field.key] = `Must be at most ${field.max}.`;
      }
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const goNext = async () => {
    if (!validateStep()) return;
    track('demographics_step_complete', { step: step.key });

    if (stepIndex < schema.steps.length - 1) {
      setStepIndex((i) => i + 1);
      headingRef.current?.focus();
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    try {
      const result = await api.submitDemographics({
        answers,
        completedSteps: schema.steps.length,
        durationMs: Date.now() - startedAt.current,
      });
      applySession(result.session);
      track('demographics_submitted');
      navigate('/your-day');
    } catch (err) {
      setSubmitError(err.message || 'We could not save your answers. Please try again.');
      setSubmitting(false);
    }
  };

  const goBack = () => {
    if (stepIndex === 0) return;
    setStepIndex((i) => i - 1);
    headingRef.current?.focus();
  };

  if (!schema) {
    return (
      <Layout step="about">
        <p className="muted">Loading…</p>
      </Layout>
    );
  }

  const isLast = stepIndex === schema.steps.length - 1;

  return (
    <Layout step="about">
      <div className="stack-lg" style={{ maxWidth: 'var(--measure)' }}>
        <div>
          <p className="eyebrow">
            Step 3 of 4 &middot; Part {stepIndex + 1} of {schema.steps.length}
          </p>
          <h1 ref={headingRef} tabIndex={-1} style={{ outline: 'none' }}>
            {step.title}
          </h1>
          {step.blurb && <p className="lede">{step.blurb}</p>}
        </div>

        <div>
          {visibleFields.map((field) => (
            <FieldRenderer
              key={field.key}
              field={field}
              value={answers[field.key]}
              onChange={(v) => setAnswer(field.key, v)}
              error={errors[field.key]}
            />
          ))}
        </div>

        {submitError && (
          <Callout tone="warn">
            <p role="alert" style={{ marginBottom: 0 }}>
              {submitError}
            </p>
          </Callout>
        )}

        <div className="btn-row btn-row--split">
          <Button variant="ghost" onClick={goBack} disabled={stepIndex === 0 || submitting}>
            Back
          </Button>
          <Button variant="accent" onClick={goNext} disabled={submitting}>
            {submitting ? 'Saving…' : isLast ? 'Save and start the game' : 'Next'}
          </Button>
        </div>

        <p className="faint">
          Anything you would rather not answer can be left blank, apart from your age.
        </p>
      </div>
    </Layout>
  );
}
