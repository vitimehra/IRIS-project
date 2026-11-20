import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout.jsx';
import ConsentForm from '../components/ConsentForm.jsx';
import { Callout } from '../components/Field.jsx';
import { useSession } from '../state/SessionContext.jsx';
import { api } from '../api/client.js';

/**
 * The young person's own agreement, after a guardian has given permission.
 * A guardian saying yes is not the same as the participant saying yes, and the
 * study needs both.
 */
export default function MinorAssent() {
  const navigate = useNavigate();
  const { applySession, track } = useSession();

  const [doc, setDoc] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    track('page_view', { page: 'minor_assent' });
    api.consentDocument('minor_assent').then(setDoc).catch(() => {});
  }, [track]);

  const submit = async (responses) => {
    setSubmitting(true);
    setError(null);
    try {
      const result = await api.submitAssent(responses);
      applySession(result.session);
      track('consent_given', { type: 'minor_assent' });
      navigate('/about-you');
    } catch (err) {
      setError(err.message || 'We could not record your agreement. Please try again.');
      setSubmitting(false);
    }
  };

  if (!doc) {
    return (
      <Layout step="consent">
        <p className="muted">Loading…</p>
      </Layout>
    );
  }

  return (
    <Layout step="consent">
      <div style={{ maxWidth: '46rem' }}>
        <p className="eyebrow">Step 2 of 4</p>
        <h1>Now it is your turn</h1>
        <Callout>
          <p style={{ marginBottom: 0 }}>
            Your parent or guardian has given permission. That does not mean you have to do this —
            it is still entirely your choice, and you can stop whenever you like.
          </p>
        </Callout>
        <div style={{ marginTop: 'var(--gap-lg)' }}>
          <ConsentForm
            document={doc}
            onSubmit={submit}
            submitting={submitting}
            error={error}
            submitLabel="Yes, I want to take part"
          />
        </div>
      </div>
    </Layout>
  );
}
