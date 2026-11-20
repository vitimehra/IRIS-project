import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { SessionProvider, useSession } from './state/SessionContext.jsx';
import Layout from './components/Layout.jsx';

import Landing from './pages/Landing.jsx';
import AgeGate from './pages/AgeGate.jsx';
import ConsentAdult from './pages/ConsentAdult.jsx';
import GuardianWait from './pages/GuardianWait.jsx';
import GuardianConsent from './pages/GuardianConsent.jsx';
import MinorAssent from './pages/MinorAssent.jsx';
import Demographics from './pages/Demographics.jsx';
import GameFlow from './pages/GameFlow.jsx';
import Rating from './pages/Rating.jsx';
import PostQuestionnaire from './pages/PostQuestionnaire.jsx';
import Debrief from './pages/Debrief.jsx';
import Withdraw from './pages/Withdraw.jsx';
import About from './pages/About.jsx';
import Admin from './pages/Admin.jsx';

/**
 * Guards a participant route. A refresh mid-study must land somewhere sensible
 * rather than on a page whose prerequisites were never met.
 */
function RequireSession({ children, needsConsent = false }) {
  const { session, loading } = useSession();

  if (loading) {
    return (
      <Layout showCode={false}>
        <p className="muted">Loading…</p>
      </Layout>
    );
  }

  if (!session) return <Navigate to="/" replace />;

  if (needsConsent) {
    const consented = ['consented', 'demographics_done', 'game_done', 'rated', 'completed'].includes(
      session.status
    );
    if (!consented) {
      return <Navigate to={session.isMinor ? '/guardian-permission' : '/consent'} replace />;
    }
  }

  return children;
}

function NotFound() {
  return (
    <Layout showCode={false}>
      <div className="stack">
        <h1>That page does not exist</h1>
        <p>
          If you were following a link from a participant&rsquo;s screen, check the code and try
          again.
        </p>
        <a className="btn btn--ghost" href="/">
          Back to the start
        </a>
      </div>
    </Layout>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <SessionProvider>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/about" element={<About />} />
          <Route path="/withdraw" element={<Withdraw />} />

          <Route
            path="/age"
            element={
              <RequireSession>
                <AgeGate />
              </RequireSession>
            }
          />
          <Route
            path="/consent"
            element={
              <RequireSession>
                <ConsentAdult />
              </RequireSession>
            }
          />
          <Route
            path="/guardian-permission"
            element={
              <RequireSession>
                <GuardianWait />
              </RequireSession>
            }
          />
          <Route
            path="/your-agreement"
            element={
              <RequireSession>
                <MinorAssent />
              </RequireSession>
            }
          />
          <Route
            path="/about-you"
            element={
              <RequireSession needsConsent>
                <Demographics />
              </RequireSession>
            }
          />
          <Route
            path="/your-day"
            element={
              <RequireSession needsConsent>
                <GameFlow />
              </RequireSession>
            }
          />
          <Route
            path="/what-we-found"
            element={
              <RequireSession needsConsent>
                <Rating />
              </RequireSession>
            }
          />
          <Route
            path="/how-was-that"
            element={
              <RequireSession needsConsent>
                <PostQuestionnaire />
              </RequireSession>
            }
          />
          <Route
            path="/thank-you"
            element={
              <RequireSession needsConsent>
                <Debrief />
              </RequireSession>
            }
          />

          {/* Public, and deliberately outside the participant session: the
              guardian opens this on their own device with no credential. */}
          <Route path="/guardian" element={<GuardianConsent />} />
          <Route path="/guardian/:code" element={<GuardianConsent />} />

          <Route path="/admin" element={<Admin />} />

          <Route path="*" element={<NotFound />} />
        </Routes>
      </SessionProvider>
    </BrowserRouter>
  );
}
