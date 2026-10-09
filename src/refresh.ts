import type { Session, SessionStore } from "./session";

export interface TokenRefresher {
  refreshTokens(refreshToken: string): Promise<{ accessToken: string; idToken: string; expiresIn: number }>;
}

export interface RefresherOptions {
  store: SessionStore;
  cognito: TokenRefresher;
  refreshWindowSeconds: number;
  now?: () => number;
}

export function createRefresher({ store, cognito, refreshWindowSeconds, now = Date.now }: RefresherOptions) {
  const inflight = new Map<string, Promise<Session | null>>();

  async function doRefresh(session: Session): Promise<Session | null> {
    let next;
    try {
      const t = await cognito.refreshTokens(session.refreshToken);
      next = {
        accessToken: t.accessToken,
        idToken: t.idToken,
        refreshToken: session.refreshToken,
        accessExpiresAt: now() + t.expiresIn * 1000,
      };
    } catch {
      await store.destroy(session.id);
      return null;
    }
    if (await store.update(session.id, session.version, next)) {
      return { ...session, ...next, version: session.version + 1 };
    }
    // Another instance refreshed first; use what it stored.
    return store.get(session.id);
  }

  function refresh(session: Session): Promise<Session | null> {
    const pending = inflight.get(session.id);
    if (pending) return pending;
    const promise = doRefresh(session).finally(() => inflight.delete(session.id));
    inflight.set(session.id, promise);
    return promise;
  }

  return {
    refresh,
    async ensureFresh(session: Session): Promise<Session | null> {
      return session.accessExpiresAt - now() > refreshWindowSeconds * 1000 ? session : refresh(session);
    },
  };
}
