import { decodeJwt } from "jose";
import { bearerAuth, type AuthUser } from "./bearer";
import type { ResolvedConfig } from "./config";
import { parseCookies } from "./cookies";
import type { createRefresher } from "./refresh";
import type { Session, SessionStore } from "./session";
import type { TokenVerifier } from "./verifier";

export interface MiddlewareDeps {
  store: Pick<SessionStore, "get">;
  refresher: Pick<ReturnType<typeof createRefresher>, "ensureFresh">;
  verifier: TokenVerifier;
  config: Pick<ResolvedConfig, "cookieName" | "routePrefix">;
}

export interface Req {
  headers: { authorization?: string; cookie?: string; accept?: string };
  originalUrl?: string;
  url?: string;
  user?: AuthUser;
}
export interface Res {
  status(code: number): Res;
  json(body: unknown): unknown;
  redirect(url: string): unknown;
}

// Browsers go to login and come back to the page they asked for; everything else gets 401 JSON.
export function respondUnauthenticated(req: Req, res: Res, routePrefix: string) {
  if (req.headers.accept?.includes("text/html")) {
    const returnTo = encodeURIComponent(req.originalUrl ?? req.url ?? "/");
    res.redirect(`${routePrefix}/login?returnTo=${returnTo}`);
  } else {
    res.status(401).json({ error: "unauthenticated" });
  }
}

// Stored tokens were verified at login or came straight from Cognito, so claims are only decoded.
function userFromSession(session: Session): AuthUser {
  const claims = decodeJwt(session.idToken);
  const groups = claims["cognito:groups"];
  const str = (key: string) => (typeof claims[key] === "string" ? (claims[key] as string) : undefined);
  const username = str("cognito:username");
  const email = str("email");
  const name = str("name");
  return {
    sub: session.sub,
    ...(username && { username }),
    ...(email && { email }),
    ...(name && { name }),
    groups: Array.isArray(groups) ? groups.map(String) : [],
  };
}

export function createAuthMiddleware({ store, refresher, verifier, config }: MiddlewareDeps, { optional = false } = {}) {
  const bearer = bearerAuth(verifier);

  return async (req: Req, res: Res, next: () => void): Promise<void> => {
    if (req.headers.authorization !== undefined) return bearer(req, res, next);

    const sid = parseCookies(req.headers.cookie)[config.cookieName];
    const session = sid ? await store.get(sid) : null;
    const fresh = session ? await refresher.ensureFresh(session) : null;
    if (fresh) {
      req.user = userFromSession(fresh);
      return next();
    }

    if (optional) return next();
    respondUnauthenticated(req, res, config.routePrefix);
  };
}
