import { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { api, getToken, setToken, ApiError } from '../api/client.js';
import { track, startTelemetry, flush } from './telemetry.js';

const SessionContext = createContext(null);

function clientProfile() {
  if (typeof window === 'undefined') return {};
  return {
    screenW: window.screen?.width ?? null,
    screenH: window.screen?.height ?? null,
    devicePixelRatio: window.devicePixelRatio ?? null,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? null,
    locale: navigator.language ?? null,
    referrer: document.referrer || null,
  };
}

export function SessionProvider({ children }) {
  const [session, setSession] = useState(null);
  const [studyInfo, setStudyInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const info = await api.studyInfo();
        if (!cancelled) setStudyInfo(info);
      } catch {
        // The study can still run without the contact block loaded; the footer
        // falls back to the researcher names.
      }

      // Resume an existing session if the browser is holding a live token.
      const existing = getToken();
      if (existing) {
        try {
          const { session: resumed } = await api.me();
          if (!cancelled) {
            setSession(resumed);
            setLoading(false);
          }
          return;
        } catch (err) {
          // Expired, revoked or withdrawn. Clear it and start fresh.
          if (err instanceof ApiError && [401, 410].includes(err.status)) setToken(null);
        }
      }

      if (!cancelled) setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => startTelemetry(), []);

  /** Idempotent: safe to call from any entry point. */
  const ensureSession = useCallback(async () => {
    if (session) return session;
    const created = await api.createSession(clientProfile());
    setToken(created.token);
    const next = {
      sessionId: created.sessionId,
      participantCode: created.participantCode,
      status: 'started',
      stage: 'landing',
      isMinor: false,
    };
    setSession(next);
    track('session_started');
    return next;
  }, [session]);

  const refresh = useCallback(async () => {
    const { session: fresh } = await api.me();
    setSession(fresh);
    return fresh;
  }, []);

  const applySession = useCallback((next) => {
    if (next) setSession(next);
  }, []);

  const clearSession = useCallback(async () => {
    await flush();
    setToken(null);
    setSession(null);
  }, []);

  const value = useMemo(
    () => ({
      session,
      studyInfo,
      loading,
      error,
      setError,
      ensureSession,
      refresh,
      applySession,
      clearSession,
      track,
    }),
    [session, studyInfo, loading, error, ensureSession, refresh, applySession, clearSession]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside a SessionProvider.');
  return ctx;
}
