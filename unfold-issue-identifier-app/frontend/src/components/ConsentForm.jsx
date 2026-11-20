import { useState } from 'react';
import { Button, Callout } from './Field.jsx';
import { isFilledContact } from './Layout.jsx';

/**
 * Renders a consent document and collects a response per item.
 *
 * The text shown here is exactly the text the backend stores against the record,
 * because both come from the same document fetched from /api/consent/:type.
 * Nothing on this screen is generated or rewritten on the client.
 */
export default function ConsentForm({
  document: doc,
  onSubmit,
  submitting,
  error,
  submitLabel = 'I agree, continue',
  children,
}) {
  const [responses, setResponses] = useState({});
  const [attempted, setAttempted] = useState(false);

  const missing = doc.items.filter((i) => i.required && !responses[i.key]).map((i) => i.key);
  const canSubmit = missing.length === 0 && !submitting;

  const toggle = (key) => setResponses((prev) => ({ ...prev, [key]: !prev[key] }));

  const handleSubmit = (event) => {
    event.preventDefault();
    setAttempted(true);
    if (missing.length > 0) {
      // Move focus to the first unticked required item rather than only
      // colouring it, so a screen reader user is told what is wrong.
      globalThis.document?.getElementById(`consent-${missing[0]}`)?.focus();
      return;
    }
    onSubmit(responses);
  };

  return (
    <form onSubmit={handleSubmit} className="stack-lg">
      <section className="stack" aria-labelledby="info-sheet-heading">
        <h2 id="info-sheet-heading">{doc.infoSheet.title}</h2>
        {doc.infoSheet.sections.map((section) => (
          <div key={section.heading}>
            <h3>{section.heading}</h3>
            <p>{section.body}</p>
          </div>
        ))}
      </section>

      <ContactBlock contacts={doc.contacts} />

      {children}

      <section className="stack" aria-labelledby="consent-items-heading">
        <h2 id="consent-items-heading">Please confirm each of these</h2>
        <fieldset className="choice-list">
          <legend className="sr-only">Consent items</legend>
          {doc.items.map((item) => {
            const checked = Boolean(responses[item.key]);
            const flagged = attempted && item.required && !checked;
            return (
              <label
                key={item.key}
                className={[
                  'choice',
                  'consent-item',
                  checked ? 'choice--checked' : '',
                  flagged ? 'consent-item--required-missing' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                <input
                  id={`consent-${item.key}`}
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(item.key)}
                  aria-describedby={flagged ? `consent-error-${item.key}` : undefined}
                />
                <span className="choice__text">
                  {item.text}
                  {flagged && (
                    <span id={`consent-error-${item.key}`} className="field__error">
                      This one is required to continue.
                    </span>
                  )}
                </span>
              </label>
            );
          })}
        </fieldset>
      </section>

      {attempted && missing.length > 0 && (
        <Callout tone="warn">
          <p>
            You have {missing.length} required {missing.length === 1 ? 'item' : 'items'} left to
            confirm. If you would rather not agree to one of them, you can simply close this page.
          </p>
        </Callout>
      )}

      {error && (
        <Callout tone="warn">
          <p role="alert">{error}</p>
        </Callout>
      )}

      <div className="btn-row">
        <button type="submit" className="btn btn--accent" disabled={!canSubmit}>
          {submitting ? 'Saving…' : submitLabel}
        </button>
        <span className="faint">Version {doc.version}</span>
      </div>
    </form>
  );
}

export function ContactBlock({ contacts }) {
  if (!contacts) return null;

  const filled = isFilledContact;

  return (
    <div className="callout">
      <h3>Who is running this study</h3>
      <p style={{ marginBottom: 'var(--gap-xs)' }}>
        {contacts.researchers.map((r) => r.name).join(' and ')}
        {filled(contacts.affiliation) ? `, ${contacts.affiliation}` : ''}.
      </p>
      {contacts.researchers.filter((r) => filled(r.email)).length > 0 && (
        <p style={{ marginBottom: 'var(--gap-xs)' }}>
          Questions about the study:{' '}
          {contacts.researchers
            .filter((r) => filled(r.email))
            .map((r) => (
              <a key={r.email} href={`mailto:${r.email}`}>
                {r.email}
              </a>
            ))
            .reduce((acc, el, i) => (i === 0 ? [el] : [...acc, ', ', el]), [])}
        </p>
      )}
      {filled(contacts.ethicsContact?.email) && (
        <p style={{ marginBottom: 0 }}>
          If you have a concern about how this study is being run, you can contact the{' '}
          {contacts.ethicsContact.label} independently at{' '}
          <a href={`mailto:${contacts.ethicsContact.email}`}>{contacts.ethicsContact.email}</a>
          {filled(contacts.approvalNumber) ? ` (approval ${contacts.approvalNumber})` : ''}.
        </p>
      )}
    </div>
  );
}
