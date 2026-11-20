import { useEffect, useState } from 'react';
import Layout from '../components/Layout.jsx';
import { ContactBlock } from '../components/ConsentForm.jsx';
import { api } from '../api/client.js';

/** A standing page, readable without starting a session. */
export default function About() {
  const [doc, setDoc] = useState(null);

  useEffect(() => {
    api.consentDocument('adult').then(setDoc).catch(() => {});
  }, []);

  return (
    <Layout showCode={false}>
      <div className="stack-lg" style={{ maxWidth: '46rem' }}>
        <div>
          <p className="eyebrow">About</p>
          <h1>What this study is, and what happens to your answers</h1>
        </div>

        {doc ? (
          <>
            {doc.infoSheet.sections.map((section) => (
              <section key={section.heading}>
                <h2 style={{ fontSize: 'var(--step-1)' }}>{section.heading}</h2>
                <p>{section.body}</p>
              </section>
            ))}
            <ContactBlock contacts={doc.contacts} />
          </>
        ) : (
          <p className="muted">Loading…</p>
        )}
      </div>
    </Layout>
  );
}
