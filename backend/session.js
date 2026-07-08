/** In-memory session data keyed by express-session id. */

const store = new Map();

export function getSessionData(sessionId) {
  if (!store.has(sessionId)) {
    store.set(sessionId, {});
  }
  return store.get(sessionId);
}

export function clearSessionData(sessionId) {
  store.delete(sessionId);
}
