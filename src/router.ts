import { parseCookies } from "./cookies";
import type { ResolvedConfig } from "./config";
import type { FlowResult, createLoginFlow } from "./login";
import type { createRefresher } from "./refresh";
import type { SessionStore } from "./session";

export interface RouterReq {
  method?: string;
  headers: { cookie?: string };
  originalUrl?: string;
  url?: string;
}
export interface RouterRes {
  status(code: number): RouterRes;
  setHeader(name: string, value: string | string[]): unknown;
  redirect(status: number, url: string): unknown;
  json(body: unknown): unknown;
}

export interface RouterDeps {
  config: Pick<ResolvedConfig, "routePrefix" | "cookieName">;
  flow: ReturnType<typeof createLoginFlow>;
  store: Pick<SessionStore, "get">;
  refresher: Pick<ReturnType<typeof createRefresher>, "refresh">;
}

const METHODS = { login: "GET", callback: "GET", logout: "POST", refresh: "POST" } as const;

// Mount at the application root: the route prefix is matched against the full request path.
export function createRouter({ config, flow, store, refresher }: RouterDeps) {
  const send = (res: RouterRes, result: FlowResult) => {
    if (result.cookies.length) res.setHeader("Set-Cookie", result.cookies);
    if (result.location) res.redirect(result.status, result.location);
    else res.status(result.status).json({ error: result.body ?? "error" });
  };

  return async (req: RouterReq, res: RouterRes, next: (error?: unknown) => void): Promise<void> => {
    const url = new URL(req.originalUrl ?? req.url ?? "/", "http://localhost");
    const prefix = `${config.routePrefix}/`;
    const route = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) : "";
    if (!(route in METHODS)) return next();

    const expected = METHODS[route as keyof typeof METHODS];
    if (req.method !== expected) {
      res.setHeader("Allow", expected);
      res.status(405).json({ error: "method_not_allowed" });
      return;
    }

    const cookies = parseCookies(req.headers.cookie);
    try {
      if (route === "login") {
        send(res, await flow.login({ returnTo: url.searchParams.get("returnTo") ?? undefined }));
      } else if (route === "callback") {
        const query = Object.fromEntries(url.searchParams);
        send(res, await flow.callback({ query, cookies }));
      } else if (route === "logout") {
        send(res, await flow.logout({ cookies }));
      } else {
        const sid = cookies[config.cookieName];
        const session = sid ? await store.get(sid) : null;
        const fresh = session ? await refresher.refresh(session) : null;
        if (fresh) res.status(200).json({ ok: true, accessExpiresAt: fresh.accessExpiresAt });
        else res.status(401).json({ error: "unauthenticated" });
      }
    } catch (error) {
      next(error);
    }
  };
}
