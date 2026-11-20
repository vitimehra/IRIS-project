import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Header, Footer } from '../components/Layout.jsx';
import ConsentForm from '../components/ConsentForm.jsx';
import { TextInput, Select, Callout, Button } from '../components/Field.jsx';
import { api } from '../api/client.js';

const RELATIONSHIPS = [
  { value: 'mother', label: 'Mother' },
  { value: 'father', label: 'Father' },
  { value: 'guardian', label: 'Legal guardian' },
  { value: 'grandparent', label: 'Grandparent, acting as guardian' },
  { value: 'other', label: 'Other legal guardian' },
];

/**
 * The page a guardian opens on their own device.
 *
 * Entirely separate from the participant's session: no bearer token, no shared
 * state. The short code is the only thing linking the two, and it deliberately
 * reveals nothing about the young person.
 */
export default function GuardianConsent() {
  const { code: codeParam } = useParams();
  const navigate = useNavigate();

  const [code, setCode] = useState((codeParam || '').toUpperCase());
  const [request, setRequest] = useState(null);
  const [doc, setDoc] = useState(null);
  const [lookupError, setLookupError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const [guardianName, setGuardianName] = useState('');
  const [relationship, setRelationship] = useState(null);
  const [contact, setContact] = useState('');
  const [detailErrors, setDetailErrors] = useState({});

  useEffect(() => {
    api.consentDocument('guardian').then(setDoc).catch(() => {});
  }, []);

  useEffect(() => {
    if (!codeParam) return;
    lookup(codeParam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codeParam]);

  const lookup = async (value) => {
    setLookupError(null);
    try {
      const found = await api.guardianByCode(String(value).trim().toUpperCase());
      setRequest(found);
    } catch (err) {
      setRequest(null);
      setLookupError(err.message || 'That code was not recognised.');
    }
  };

  const validateDetails = () => {
    const errs = {};
    if (guardianName.trim().length < 2) errs.name = 'Please enter your name.';
    if (!relationship) errs.relationship = 'Please tell us your relationship to them.';
    setDetailErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const submit = async (responses) => {
    if (!validateDetails()) {
      globalThis.document
        ?.getElementById('guardian-details')
        ?.scrollIntoView?.({ behavior: 'smooth' });
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await api.guardianConsent(request.shortCode, {
        responses,
        guardianName: guardianName.trim(),
        guardianRelationship: relationship,
        guardianContact: contact.trim() || null,
      });
      setResult('consented');
    } catch (err) {
      setError(err.message || 'We could not record your decision. Please try again.');
      setSubmitting(false);
    }
  };

  const decline = async () => {
    setSubmitting(true);
    try {
      await api.guardianDecline(request.shortCode, null);
      setResult('declined');
    } catch (err) {
      setError(err.message || 'We could not record your decision.');
      setSubmitting(false);
    }
  };

  const shell = (children) => (
    <div className="app-shell">
      <Header showCode={false} />
      <main id="main" className="page" style={{ maxWidth: '46rem' }}>
        {children}
      </main>
      <Footer />
    </div>
  );

  // --- code entry, when someone typed the address rather than scanning -----
  if (!request) {
    return shell(
      <div className="stack-lg">
        <div>
          <p className="eyebrow">Parent or guardian</p>
          <h1>Enter the code you were shown</h1>
          <p className="lede">
            A young person in your care is asking permission to take part in a research study. Enter
            the six-character code from their screen.
          </p>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            lookup(code);
          }}
          className="stack"
        >
          <TextInput
            label="Permission code"
            value={code}
            onChange={(v) => setCode(v.toUpperCase())}
            maxLength={6}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck="false"
            style={{ letterSpacing: '0.3em', fontSize: 'var(--step-2)', maxWidth: '12ch' }}
            error={lookupError}
          />
          <button type="submit" className="btn btn--accent" disabled={code.length < 6}>
            Continue
          </button>
        </form>
      </div>
    );
  }

  // --- outcomes -----------------------------------------------------------
  if (result === 'consented') {
    return shell(
      <div className="stack-lg">
        <h1>Thank you — permission recorded</h1>
        <Callout>
          <p style={{ marginBottom: 0 }}>
            Their screen will move on by itself. They will now be asked whether they want to take
            part, and they can still decline or stop at any point.
          </p>
        </Callout>
        <p>
          You can close this page. If you later change your mind, contact the researchers with the
          participant code shown at the end of their session and we will delete everything.
        </p>
      </div>
    );
  }

  if (result === 'declined') {
    return shell(
      <div className="stack-lg">
        <h1>Recorded — no permission given</h1>
        <p>
          Their screen will let them know. Nothing further will be collected. Thank you for taking
          the time to read it.
        </p>
      </div>
    );
  }

  if (request.alreadyResolved) {
    return shell(
      <div className="stack-lg">
        <h1>This request has already been answered</h1>
        <p>
          Someone has already responded to this permission request. If that was not you, please speak
          to the young person directly.
        </p>
      </div>
    );
  }

  if (request.status === 'expired') {
    return shell(
      <div className="stack-lg">
        <h1>This code has expired</h1>
        <p>
          Permission codes last two hours. Ask them to generate a new one from their screen and try
          again.
        </p>
      </div>
    );
  }

  if (!doc) {
    return shell(<p className="muted">Loading…</p>);
  }

  // --- the consent document -----------------------------------------------
  return shell(
    <div className="stack-lg">
      <div>
        <p className="eyebrow">Parent or guardian permission</p>
        <h1>{doc.infoSheet.title}</h1>
      </div>

      <ConsentForm
        document={doc}
        onSubmit={submit}
        submitting={submitting}
        error={error}
        submitLabel="Give permission"
      >
        <section id="guardian-details" className="card stack">
          <h2 style={{ fontSize: 'var(--step-1)' }}>Your details</h2>
          <p className="field__help">
            We record who gave permission. We do not ask for the young person&rsquo;s name.
          </p>

          <TextInput
            label="Your full name"
            value={guardianName}
            onChange={setGuardianName}
            autoComplete="name"
            error={detailErrors.name}
          />

          <Select
            label="Your relationship to them"
            value={relationship}
            onChange={setRelationship}
            options={RELATIONSHIPS}
            error={detailErrors.relationship}
          />

          <TextInput
            label="Email or phone, if you would like a record of this"
            value={contact}
            onChange={setContact}
            optional
            autoComplete="email"
            help="Only used if you later ask us to delete their data."
          />
        </section>
      </ConsentForm>

      <div className="card stack-sm">
        <h3 style={{ fontSize: 'var(--step-0)' }}>If you would rather not</h3>
        <p style={{ marginBottom: 0 }}>
          You do not have to give a reason, and nothing further will be collected.
        </p>
        <div className="btn-row">
          <Button variant="ghost" onClick={decline} disabled={submitting}>
            I do not give permission
          </Button>
        </div>
      </div>
    </div>
  );
}
