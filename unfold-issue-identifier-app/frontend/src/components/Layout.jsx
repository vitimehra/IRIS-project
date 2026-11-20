import { Link } from 'react-router-dom';
import { useSession } from '../state/SessionContext.jsx';
import { DayStripTrack } from './DayStrip.jsx';

/** The participant journey, as shown on the rail. */
export const JOURNEY = [
  { key: 'consent', label: 'Consent' },
  { key: 'about', label: 'About you' },
  { key: 'day', label: 'Your day' },
  { key: 'issues', label: 'What we found' },
  { key: 'done', label: 'Done' },
];

export function ProgressRail({ current }) {
  const index = JOURNEY.findIndex((s) => s.key === current);
  if (index < 0) return null;
  const progress = (index + 1) / JOURNEY.length;

  return (
    <div className="progress-rail">
      <div className="progress-rail__inner">
        <DayStripTrack progress={progress} />
        <ol className="progress-rail__labels" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {JOURNEY.map((step, i) => (
            <li
              key={step.key}
              className={[
                'progress-rail__label',
                i === index ? 'progress-rail__label--current' : '',
                i < index ? 'progress-rail__label--done' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              aria-current={i === index ? 'step' : undefined}
            >
              {step.label}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

export function Header({ showCode = true }) {
  const { session } = useSession();

  return (
    <header className="site-header">
      <div className="site-header__inner">
        <Link to="/" className="wordmark">
          <span className="wordmark__dot" aria-hidden="true" />
          UNFOLD
        </Link>
        <div className="site-header__meta">
          {showCode && session?.participantCode && (
            <span>
              <span className="sr-only">Your participant code is </span>
              <code>{session.participantCode}</code>
            </span>
          )}
        </div>
      </div>
    </header>
  );
}

/**
 * Until the contact block in backend/src/content/consent.js is filled in, its
 * values are literal [REPLACE-WITH-...] markers. Those are for the researchers,
 * never for a participant, so every render site has to gate on this.
 */
export function isFilledContact(value) {
  return Boolean(value) && !String(value).startsWith('[');
}

export function Footer() {
  const { studyInfo } = useSession();
  const contacts = studyInfo?.contacts;

  return (
    <footer className="site-footer">
      <div className="site-footer__inner">
        <div>
          <div className="site-footer__names">Viti Mehra &middot; Sankar Balasubramanian</div>
          {isFilledContact(contacts?.affiliation) && <div>{contacts.affiliation}</div>}
        </div>

        {contacts?.researchers?.some((r) => isFilledContact(r.email)) && (
          <div className="site-footer__row">
            {contacts.researchers
              .filter((r) => isFilledContact(r.email))
              .map((r) => (
                <a key={r.email} href={`mailto:${r.email}`}>
                  {r.name}
                </a>
              ))}
          </div>
        )}

        <div className="site-footer__row">
          <Link to="/withdraw">Withdraw my data</Link>
          <Link to="/about">About this study</Link>
          <Link to="/admin">Admin</Link>
        </div>

        <div className="faint">
          A research study on everyday frictions. Your responses are stored under a random code.
        </div>
      </div>
    </footer>
  );
}

export default function Layout({ children, step, showCode = true }) {
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Header showCode={showCode} />
      {step && <ProgressRail current={step} />}
      <main id="main" className="page">
        {children}
      </main>
      <Footer />
    </div>
  );
}
