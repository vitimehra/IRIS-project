import { Link } from 'react-router-dom';

export function Header({ right }) {
  return (
    <header className="hdr">
      <div className="hdr__in">
        <Link to="/" className="brand">
          <span className="brand__mark" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 22 22"><path d="M11 20 C11 13 6 10 3 3 M11 20 C11 13 16 10 19 3 M11 20 L11 8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /><circle cx="11" cy="7" r="1.8" fill="var(--vine)" /></svg>
          </span>
          <span className="brand__name">VITIS</span>
          <span className="brand__sub">Verb-Inspired Traversal from Issues to Solutions</span>
        </Link>
        <div className="hdr__right">{right}</div>
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="ftr">
      <div className="ftr__in">
        <div><strong>Viti Mehra</strong> &middot; <strong>Sankar Balasubramanian</strong></div>
        <div className="muted">A research study on ideation. Illusion of Novelty project.</div>
        <div className="muted small">Your responses are stored under a participant code, never your name.</div>
      </div>
    </footer>
  );
}

export default function Layout({ children, right, wide = false }) {
  return (
    <div className="shell">
      <Header right={right} />
      <main className={`main ${wide ? 'main--wide' : ''}`}>{children}</main>
      <Footer />
    </div>
  );
}

export function Stepper({ stages, current, order, onBack, reviewing = false }) {
  // Stage -> the review page that best represents it.
  const reviewKey = { issue: 'issue', cae: 'cae', problems: 'problems', aopc: 'aopc', traditional: 'traditional', auto_1: 'latest', auto_2: 'latest' };
  const labels = {
    issue: 'Your issue', cae: 'Structure', problems: 'Problem', aopc: 'Define', traditional: 'Your ideas',
    auto_1: order?.[1] === 'inspider' ? 'Inspired ideas' : 'AI ideas', auto_2: order?.[2] === 'inspider' ? 'Inspired ideas' : 'AI ideas',
    rate_ideas: 'Rate ideas', rate_concepts: 'Rate concepts', rate_renders: 'Rate renders', done: 'Done',
  };
  const idx = stages.indexOf(current);
  return (
    <ol className="stepper">
      {stages.map((s, i) => (
        <li
          key={s}
          className={`stepper__item ${i < idx ? 'is-done' : ''} ${i === idx ? 'is-current' : ''} ${i < idx && onBack ? 'is-link' : ''}`}
          aria-current={i === idx && !reviewing ? 'step' : undefined}
          title={i < idx && onBack ? 'Look back (read only)' : undefined}
          onClick={i < idx && onBack ? () => onBack(reviewKey[s] || 'latest') : undefined}
        >
          <span className="stepper__dot" />
          <span className="stepper__label">{labels[s] || s}</span>
        </li>
      ))}
    </ol>
  );
}

export function Notice({ tone = 'info', children }) {
  return <div className={`notice notice--${tone}`}>{children}</div>;
}

export function Spinner({ label }) {
  return (
    <div className="spinner" role="status">
      <span className="spinner__vine" aria-hidden="true" />
      <span>{label || 'Working…'}</span>
    </div>
  );
}
