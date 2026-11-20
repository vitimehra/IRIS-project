import { useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import Layout from '../components/Layout.jsx';
import DayStrip from '../components/DayStrip.jsx';
import { useSession } from '../state/SessionContext.jsx';

export default function Landing() {
  const navigate = useNavigate();
  const { ensureSession, track, studyInfo } = useSession();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    track('page_view', { page: 'landing' });
  }, [track]);

  const begin = async () => {
    setStarting(true);
    setError(null);
    try {
      await ensureSession();
      track('study_started');
      navigate('/age');
    } catch {
      setError('We could not start a session. Please check your connection and try again.');
      setStarting(false);
    }
  };

  const range = studyInfo?.ageRange;

  return (
    <Layout showCode={false}>
      <div className="stack-lg">
        <div>
          <p className="eyebrow">A research study</p>
          <h1>What actually got in your way yesterday?</h1>
          <p className="lede">
            Not the big problems. The small ones — the wait, the second attempt, the thing you had
            to hunt for. You forgot them within the hour. We would like to find them again.
          </p>
        </div>

        <DayStrip height={140} />

        <div className="stack">
          <p>
            Asking people to list their daily annoyances does not work, because we adapt to them and
            stop noticing. So this study does not ask. Instead you will rebuild one ordinary
            day — yesterday — moment by moment, and mark how each part of it felt. A short game
            along the way asks you to make a moment <em>worse</em>, which turns out to be the fastest
            route to what already bothers you.
          </p>
          <p>
            At the end you will see the everyday issues we found in your day, and you decide how much
            each one really matters.
          </p>
        </div>

        <div className="card stack-sm">
          <h2 style={{ fontSize: 'var(--step-1)' }}>Before you start</h2>
          <ul className="stack-sm" style={{ paddingLeft: '1.2rem', margin: 0 }}>
            <li>It takes about 20 minutes, and works best on a phone.</li>
            <li>
              You need to be between {range?.min ?? 15} and {range?.max ?? 50}. If you are under 18, a
              parent or guardian has to give permission first — we will show you how.
            </li>
            <li>We do not ask for your full name, phone number, or any ID.</li>
            <li>You can stop at any point, and ask us to delete everything afterwards.</li>
          </ul>
        </div>

        {error && (
          <div className="callout callout--warn">
            <p role="alert" style={{ marginBottom: 0 }}>
              {error}
            </p>
          </div>
        )}

        <div className="btn-row">
          <button className="btn btn--accent" onClick={begin} disabled={starting}>
            {starting ? 'Starting…' : 'Start'}
          </button>
          <a className="btn btn--quiet" href="/about">
            What happens to my answers?
          </a>
        </div>
      </div>
    </Layout>
  );
}
