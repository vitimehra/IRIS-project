import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout.jsx';
import { Callout } from '../components/Field.jsx';
import DayBoard from './game/DayBoard.jsx';
import Saboteur from './game/Saboteur.jsx';
import Pairwise from './game/Pairwise.jsx';
import { api } from '../api/client.js';
import { useSession } from '../state/SessionContext.jsx';

/**
 * Sequences the three game stages.
 *
 * Board first, because everything downstream is anchored to the episodes it
 * produces; then the Saboteur on the moments that grated; then forced choice to
 * rank them. Each stage is resumable on its own, so a dropped connection or a
 * refresh does not cost the participant the whole session.
 */
const STAGES = ['board', 'saboteur', 'pairwise'];

export default function GameFlow() {
  const navigate = useNavigate();
  const { applySession, track } = useSession();

  const [content, setContent] = useState(null);
  const [stage, setStage] = useState('board');
  const [error, setError] = useState(null);
  const startedAt = useRef(Date.now());

  useEffect(() => {
    api
      .gameContent()
      .then(setContent)
      .catch(() => setError('We could not load the game. Please reload the page.'));
  }, []);

  const advance = async (from) => {
    const next = STAGES[STAGES.indexOf(from) + 1];
    if (next) {
      setStage(next);
      try {
        globalThis.scrollTo?.({ top: 0, behavior: 'smooth' });
      } catch {
        /* not implemented in every environment */
      }
      return;
    }

    try {
      const result = await api.completeGame({ durationMs: Date.now() - startedAt.current });
      applySession(result.session);
      track('game_complete', { durationMs: Date.now() - startedAt.current });
      navigate('/what-we-found');
    } catch (err) {
      setError(err.message || 'We could not save your day.');
    }
  };

  if (error) {
    return (
      <Layout step="day">
        <Callout tone="warn">
          <p role="alert" style={{ marginBottom: 0 }}>
            {error}
          </p>
        </Callout>
      </Layout>
    );
  }

  if (!content) {
    return (
      <Layout step="day">
        <p className="muted">Loading…</p>
      </Layout>
    );
  }

  return (
    <Layout step="day">
      {stage === 'board' && <DayBoard content={content} onDone={() => advance('board')} />}
      {stage === 'saboteur' && <Saboteur onDone={() => advance('saboteur')} />}
      {stage === 'pairwise' && <Pairwise onDone={() => advance('pairwise')} />}
    </Layout>
  );
}
