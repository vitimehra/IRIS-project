import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout, { Notice } from '../components/Layout.jsx';
import { api } from '../api/client.js';

export default function Consent() {
  const nav = useNavigate();
  const [doc, setDoc] = useState(null);
  const [agreed, setAgreed] = useState({});
  const [error, setError] = useState(null);

  useEffect(() => {
    api.consent().then(setDoc).catch((e) => setError(e.message));
  }, []);

  if (!doc) return <Layout><p className="muted">Loading…</p></Layout>;
  const all = doc.items.every((i) => agreed[i.key]);

  const submit = async () => {
    try {
      await api.giveConsent(agreed);
      nav('/study');
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <Layout>
      <div className="narrow stack">
        <p className="eyebrow">Consent · v{doc.version}</p>
        <h1>{doc.title}</h1>
        {doc.sections.map((s) => (
          <section key={s.heading}>
            <h3>{s.heading}</h3>
            <p>{s.body}</p>
          </section>
        ))}
        <p className="muted small">Researchers: {doc.contacts}</p>
        <div className="stack-sm">
          {doc.items.map((i) => (
            <label key={i.key} className={`check ${agreed[i.key] ? 'is-on' : ''}`}>
              <input type="checkbox" checked={!!agreed[i.key]} onChange={(e) => setAgreed((a) => ({ ...a, [i.key]: e.target.checked }))} />
              <span>{i.text}</span>
            </label>
          ))}
        </div>
        {error && <Notice tone="warn">{error}</Notice>}
        <button className="btn" disabled={!all} onClick={submit}>I agree — begin</button>
      </div>
    </Layout>
  );
}
