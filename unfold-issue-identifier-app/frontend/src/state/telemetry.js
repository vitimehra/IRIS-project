import { api, getToken } from '../api/client.js';

/**
 * Buffered event recorder.
 *
 * Timing is part of the instrument, not analytics: how long someone hesitates
 * over a severity scale is data. Events are queued and flushed on an interval so
 * a participant on patchy mobile data is never waiting on a telemetry round trip.
 */
const QUEUE = [];
const FLUSH_INTERVAL_MS = 8000;
const MAX_QUEUE = 150;

let timer = null;
let flushing = false;

export function track(type, payload, page) {
  if (!type) return;
  QUEUE.push({
    type,
    page: page ?? (typeof location !== 'undefined' ? location.pathname : null),
    payload,
    clientTs: new Date().toISOString(),
  });
  // Never let the buffer grow without bound if the backend is unreachable.
  if (QUEUE.length > MAX_QUEUE) QUEUE.splice(0, QUEUE.length - MAX_QUEUE);
}

export async function flush() {
  if (flushing || QUEUE.length === 0 || !getToken()) return;
  flushing = true;
  const batch = QUEUE.splice(0, 100);
  try {
    await api.sendTelemetry(batch);
  } catch {
    // Telemetry must never break the study. Drop the batch and move on rather
    // than re-queueing forever against a backend that is refusing it.
  } finally {
    flushing = false;
  }
}

export function startTelemetry() {
  if (timer) return stopTelemetry;
  timer = setInterval(flush, FLUSH_INTERVAL_MS);

  const onHide = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') flush();
  };
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onHide);
  }

  return () => {
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onHide);
    }
    stopTelemetry();
  };
}

export function stopTelemetry() {
  if (timer) clearInterval(timer);
  timer = null;
}
