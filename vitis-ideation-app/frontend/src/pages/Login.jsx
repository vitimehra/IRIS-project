import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout, { Notice } from '../components/Layout.jsx';
import { api, tokens } from '../api/client.js';

export default function Login() {
  const nav = useNavigate();
  const [username, setUsername] = useState('');
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.participantLogin(username, passcode);
      tokens.set('participant', r.token);
      nav(r.participant.consented ? '/study' : '/consent');
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Layout>
      <form className="narrow stack" onSubmit={submit}>
        <p className="eyebrow">Participant</p>
        <h1>Enter your code</h1>
        <p className="muted">Both were given to you by the researcher.</p>
        <label className="field">
          <span>Username</span>
          <input className="input input--code" value={username} onChange={(e) => setUsername(e.target.value.toUpperCase())} placeholder="P01" autoCapitalize="characters" autoComplete="username" required />
        </label>
        <label className="field">
          <span>Passcode</span>
          <input className="input input--code" value={passcode} onChange={(e) => setPasscode(e.target.value.toUpperCase())} placeholder="5 characters" maxLength={5} autoCapitalize="characters" autoComplete="off" required />
        </label>
        {error && <Notice tone="warn">{error}</Notice>}
        <button className="btn" disabled={busy || !username || passcode.length < 5}>{busy ? '…' : 'Continue'}</button>
      </form>
    </Layout>
  );
}
