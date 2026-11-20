import { useState } from 'react';
import Layout from '../components/Layout.jsx';
import { TextInput, TextArea, Callout, Button } from '../components/Field.jsx';
import { useSession } from '../state/SessionContext.jsx';
import { api } from '../api/client.js';

export default function Withdraw() {
  const { session, clearSession } = useSession();
  const [code, setCode] = useState(session?.participantCode || '');
  const [reason, setReason] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (session && code.trim().toUpperCase() === session.participantCode) {
        await api.withdrawMe(reason || null);
        await clearSession();
      } else {
        await api.withdrawByCode(code.trim(), reason || null);
      }
      setDone(true);
    } catch (err) {
      setError(err.message || 'We could not process that. Please email us instead.');
      setBusy(false);
    }
  };

  if (done) {
    return (
      <Layout showCode={false}>
        <div className="stack-lg" style={{ maxWidth: 'var(--measure)' }}>
          <h1>Done — your data has been deleted</h1>
          <Callout>
            <p style={{ marginBottom: 0 }}>
              Everything recorded under that code has been removed. We keep only a note that a
              deletion happened, with no answers attached, so we can show our ethics committee that
              the request was honoured.
            </p>
          </Callout>
          <p>Thank you for having given it a go. You can close this page.</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout showCode={false}>
      <div className="stack-lg" style={{ maxWidth: 'var(--measure)' }}>
        <div>
          <p className="eyebrow">Withdrawal</p>
          <h1>Delete my data</h1>
          <p className="lede">
            Enter your participant code and everything stored against it is deleted immediately. You
            do not have to give a reason.
          </p>
        </div>

        <TextInput
          label="Participant code"
          value={code}
          onChange={(v) => setCode(v.toUpperCase())}
          placeholder="P001"
          autoCapitalize="characters"
          autoComplete="off"
          help="Shown at the end of your session, and in the top corner while you were taking part."
        />

        <TextArea
          label="Anything you would like to tell us"
          value={reason}
          onChange={setReason}
          optional
          maxLength={500}
          help="Genuinely optional. It helps us improve the study, and it is stored separately from any answers."
        />

        {error && (
          <Callout tone="warn">
            <p role="alert" style={{ marginBottom: 0 }}>
              {error}
            </p>
          </Callout>
        )}

        {!confirming ? (
          <div className="btn-row">
            <Button variant="danger" onClick={() => setConfirming(true)} disabled={!code.trim()}>
              Delete my data
            </Button>
          </div>
        ) : (
          <Callout tone="warn">
            <h3 style={{ fontSize: 'var(--step-0)' }}>This cannot be undone</h3>
            <p>
              Deleting is permanent. If you want to take part again afterwards you would need to
              start a fresh session.
            </p>
            <div className="btn-row">
              <Button variant="danger" onClick={submit} disabled={busy}>
                {busy ? 'Deleting…' : 'Yes, delete everything'}
              </Button>
              <Button variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>
                Cancel
              </Button>
            </div>
          </Callout>
        )}

        <p className="faint">
          If you have lost your code, contact the researchers and they can find your session from the
          time you took part.
        </p>
      </div>
    </Layout>
  );
}
