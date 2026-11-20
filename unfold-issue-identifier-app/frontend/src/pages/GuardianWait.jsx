import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import Layout from '../components/Layout.jsx';
import { Callout } from '../components/Field.jsx';
import { useSession } from '../state/SessionContext.jsx';
import { api } from '../api/client.js';

const POLL_MS = 3000;

/**
 * The under-18 handoff, from the participant's side.
 *
 * The guardian acts on their own device, which is the whole point: it produces a
 * consent record that was independently actioned by an adult, rather than a
 * checkbox the young person ticked on their own phone.
 */
export default function GuardianWait() {
  const navigate = useNavigate();
  const { applySession, track } = useSession();

  const [request, setRequest] = useState(null);
  const [error, setError] = useState(null);
  const pollRef = useRef(null);

  useEffect(() => {
    track('page_view', { page: 'guardian_wait' });

    let cancelled = false;

    api
      .createGuardianRequest()
      .then((created) => {
        if (!cancelled) setRequest(created);
      })
      .catch(() => {
        if (!cancelled) setError('We could not create a permission request. Please reload the page.');
      });

    return () => {
      cancelled = true;
    };
  }, [track]);

  useEffect(() => {
    if (!request || ['consented', 'declined', 'expired'].includes(request.status)) return undefined;

    pollRef.current = setInterval(async () => {
      try {
        const status = await api.guardianStatus();
        setRequest((prev) => ({ ...prev, ...status }));

        if (status.status === 'consented') {
          clearInterval(pollRef.current);
          if (status.session) applySession(status.session);
          track('guardian_consented');
          navigate('/your-agreement');
        }
        if (['declined', 'expired'].includes(status.status)) {
          clearInterval(pollRef.current);
          track('guardian_resolved', { status: status.status });
        }
      } catch {
        // A dropped poll is not worth showing the participant. The next tick
        // will pick it up.
      }
    }, POLL_MS);

    return () => clearInterval(pollRef.current);
  }, [request, applySession, navigate, track]);

  if (error) {
    return (
      <Layout step="consent">
        <Callout tone="warn">
          <p role="alert" style={{ marginBottom: 0 }}>
            {error}
          </p>
        </Callout>
      </Layout>
    );
  }

  if (!request) {
    return (
      <Layout step="consent">
        <p className="muted">Preparing a permission request…</p>
      </Layout>
    );
  }

  if (request.status === 'declined') {
    return (
      <Layout step="consent">
        <div className="stack-lg">
          <h1>Your guardian did not give permission</h1>
          <Callout tone="note">
            <p style={{ marginBottom: 0 }}>
              That is completely fine, and it is their decision to make. Nothing you entered has been
              kept beyond the age you gave.
            </p>
          </Callout>
          <p>Thank you for your interest in the study.</p>
        </div>
      </Layout>
    );
  }

  if (request.status === 'expired') {
    return (
      <Layout step="consent">
        <div className="stack-lg">
          <h1>That code has expired</h1>
          <p>Permission codes last two hours. You can generate a fresh one and try again.</p>
          <button className="btn btn--accent" onClick={() => window.location.reload()}>
            Get a new code
          </button>
        </div>
      </Layout>
    );
  }

  const viewed = request.status === 'viewed';

  return (
    <Layout step="consent">
      <div className="stack-lg" style={{ maxWidth: '40rem' }}>
        <div>
          <p className="eyebrow">Step 2 of 4</p>
          <h1>Ask a parent or guardian</h1>
          <p className="lede">
            Because you are under 18, an adult who looks after you has to give permission before you
            can start. Show them this screen.
          </p>
        </div>

        <div className="card stack" style={{ textAlign: 'center' }}>
          <p style={{ margin: '0 auto' }}>
            <strong>On their own phone</strong>, ask them to scan this:
          </p>

          <div className="qr-frame">
            <QRCodeSVG value={request.guardianUrl} size={200} level="M" />
          </div>

          <p className="muted" style={{ margin: '0 auto' }}>
            Or they can go to <strong>{shortHost(request.guardianUrl)}</strong> and enter this code:
          </p>

          <div className="code-display">{request.shortCode}</div>
        </div>

        <Callout>
          <p style={{ marginBottom: 0 }}>
            <span
              className={`status-dot ${viewed ? 'status-dot--ok' : 'status-dot--waiting'}`}
              aria-hidden="true"
            />
            {viewed
              ? 'They have opened the page. This screen will move on by itself once they decide.'
              : 'Waiting for them to open it. Keep this page open — it will continue automatically.'}
          </p>
        </Callout>

        <p className="faint">
          They will read their own version of the information sheet and decide there. You will then
          be asked whether you want to take part yourself — their permission alone is not enough.
        </p>
      </div>
    </Layout>
  );
}

function shortHost(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname.replace(/\/[^/]+$/, '')}`;
  } catch {
    return url;
  }
}
