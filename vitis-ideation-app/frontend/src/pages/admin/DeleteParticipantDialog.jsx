import { useEffect, useState } from 'react';
import { Notice } from '../../components/Layout.jsx';
import { api } from '../../api/client.js';

/** Two-step confirmation: continue, then type the participant code. Works at any status. */
export default function DeleteParticipantDialog({ participant, onClose, onDeleted }) {
  const [step, setStep] = useState(1);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const match = typed.trim().toUpperCase() === participant.username.toUpperCase();

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const purge = async () => {
    if (!match || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteParticipant(participant.id, participant.username);
      onDeleted();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };

  return (
    <div className="modal-scrim" onClick={() => { if (!busy) onClose(); }} role="presentation">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="del-title" onClick={(e) => e.stopPropagation()}>
        {step === 1 ? (
          <div className="stack">
            <p className="eyebrow">Delete participant</p>
            <h2 id="del-title">Remove {participant.username} and all their data?</h2>
            <p>This person is currently <b>{participant.status}</b>. Deletion is allowed at any status — created, active, completed or withdrawn — and cannot be undone.</p>
            <ul className="small">
              <li>Account, passcode and login sessions</li>
              <li>Issue text, ideas, concepts, ratings, generated images and AI transcripts</li>
            </ul>
            <p className="muted small">Phenomena they added to the Inspider web stay; those belong to the web, not the person.</p>
            <div className="row row--between">
              <button type="button" className="btn btn--ghost" onClick={onClose}>Cancel</button>
              <button type="button" className="btn btn--danger" onClick={() => setStep(2)}>Continue</button>
            </div>
          </div>
        ) : (
          <div className="stack">
            <p className="eyebrow">Confirm deletion</p>
            <h2 id="del-title">Type {participant.username} to permanently delete</h2>
            <p className="muted">This is the second confirmation. The participant record and study data will be erased immediately.</p>
            <label className="field">
              <span>Participant code</span>
              <input className="input input--code" value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus autoComplete="off" spellCheck="false" />
            </label>
            {error && <Notice tone="warn">{error}</Notice>}
            <div className="row row--between">
              <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>Cancel</button>
              <button type="button" className="btn btn--danger" disabled={!match || busy} onClick={purge}>
                {busy ? 'Deleting…' : 'Delete permanently'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
