import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout.jsx';
import ConsentForm from '../components/ConsentForm.jsx';
import { useSession } from '../state/SessionContext.jsx';
import { api } from '../api/client.js';

export default function ConsentAdult() {
  const navigate = useNavigate();
  const { applySession, track } = useSession();

  const [doc, setDoc] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    track('page_view', { page: 'consent_adult' });
    api
      .consentDocument('adult')
      .then(setDoc)
      .catch(() => setLoadError('We could not load the consent form. Please reload the page.'));
  }, [track]);

  const submit = async (responses) => {
    setSubmitting(true);
    setError(null);
    try {
      const result = await api.submitAdultConsent(responses);
      applySession(result.session);
      track('consent_given', { type: 'adult' });
      navigate('/about-you');
    } catch (err) {
      setError(err.message || 'We could not record your consent. Please try again.');
      setSubmitting(false);
    }
  };

  if (loadError) {
    return (
      <Layout step="consent">
        <div className="callout callout--warn">
          <p role="alert" style={{ marginBottom: 0 }}>
            {loadError}
          </p>
        </div>
      </Layout>
    );
  }

  if (!doc) {
    return (
      <Layout step="consent">
        <p className="muted">Loading the consent form…</p>
      </Layout>
    );
  }

  return (
    <Layout step="consent">
      <div className="page--narrow" style={{ maxWidth: '46rem' }}>
        <p className="eyebrow">Step 2 of 4</p>
        <h1>Your consent</h1>
        <p className="lede">
          Please read this properly. It is short, and it is the part that decides what we may do with
          your answers.
        </p>
        <ConsentForm document={doc} onSubmit={submit} submitting={submitting} error={error} />
      </div>
    </Layout>
  );
}
