import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout.jsx';
import { NumberInput, Callout } from '../components/Field.jsx';
import { useSession } from '../state/SessionContext.jsx';
import { api } from '../api/client.js';

export default function AgeGate() {
  const navigate = useNavigate();
  const { ensureSession, applySession, track, studyInfo } = useSession();

  const [age, setAge] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [outcome, setOutcome] = useState(null);

  useEffect(() => {
    ensureSession().catch(() => setError('We could not start a session. Please reload the page.'));
    track('page_view', { page: 'age_gate' });
  }, [ensureSession, track]);

  const submit = async (event) => {
    event.preventDefault();
    if (age === null || age === '') {
      setError('Please enter your age.');
      return;
    }
    setSubmitting(true);
    setError(null);

    try {
      const result = await api.ageGate(Number(age));
      applySession(result.session);
      track('age_gate_result', { result: result.result });

      if (result.result === 'adult') navigate('/consent');
      else if (result.result === 'minor') navigate('/guardian-permission');
      else setOutcome('screened_out');
    } catch (err) {
      setError(err.message || 'Please enter a valid age.');
    } finally {
      setSubmitting(false);
    }
  };

  const min = studyInfo?.ageRange?.min ?? 15;
  const max = studyInfo?.ageRange?.max ?? 50;

  if (outcome === 'screened_out') {
    return (
      <Layout step="consent" showCode={false}>
        <div className="stack-lg">
          <h1>Thank you for your interest</h1>
          <Callout tone="note">
            <p style={{ marginBottom: 0 }}>
              This study is currently recruiting people aged {min} to {max}, so we are not able to
              include your responses this time. Nothing has been saved beyond the age you entered.
            </p>
          </Callout>
          <p>
            We are sorry to turn you away — the age range is set by what our ethics approval covers,
            not by anything about you.
          </p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout step="consent" showCode={false}>
      <form onSubmit={submit} className="stack-lg" style={{ maxWidth: 'var(--measure)' }}>
        <div>
          <p className="eyebrow">Step 1 of 4</p>
          <h1>How old are you?</h1>
          <p className="lede">
            This decides which consent form you see. If you are under 18, we need a parent or
            guardian to give permission before you begin.
          </p>
        </div>

        <NumberInput
          label="Your age"
          value={age}
          onChange={setAge}
          min={1}
          max={120}
          required
          autoFocus
          error={error}
        />

        <div className="btn-row">
          <button type="submit" className="btn btn--accent" disabled={submitting}>
            {submitting ? 'Checking…' : 'Continue'}
          </button>
        </div>

        <p className="faint">
          We store your age because everyday frictions differ a lot across life stages. It is never
          published alongside anything that identifies you.
        </p>
      </form>
    </Layout>
  );
}
