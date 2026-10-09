import { describe, expect, it, vi } from "vitest";
import { createAuthMiddleware } from "../src/middleware";
import type { Session } from "../src/session";

const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
const idToken = `${b64({ alg: "RS256" })}.${b64({
  email: "jo@example.com",
  name: "Jo",
  "cognito:username": "jo",
  "cognito:groups": ["admins"],
})}.sig`;

const session: Session = { id: "good", sub: "user-1", accessToken: "a", idToken, refreshToken: "r", accessExpiresAt: 0, version: 0 };

function setup(opts: { optional?: boolean; refreshed?: Session | null } = {}) {
  const store = { get: vi.fn(async (id: string) => (id === "good" ? session : null)) };
  const refresher = { ensureFresh: vi.fn(async (s: Session) => (opts.refreshed === undefined ? s : opts.refreshed)) };
  const verifier = { verify: vi.fn(async () => ({ sub: "bearer-user" })) };
  const middleware = createAuthMiddleware(
    { store, refresher, verifier, config: { cookieName: "auth_sid", routePrefix: "/auth" } },
    { optional: opts.optional },
  );
  return { store, refresher, verifier, middleware };
}

async function run(middleware: ReturnType<typeof setup>["middleware"], headers: Record<string, string> = {}, url = "/dashboard?x=1") {
  const req: Record<string, unknown> = { headers, originalUrl: url };
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn(), redirect: vi.fn() };
  const next = vi.fn();
  await middleware(req as never, res as never, next);
  return { req, res, next };
}

const html = { accept: "text/html,application/xhtml+xml" };

describe("authentication middleware", () => {
  it("authenticates from the session cookie and exposes the user", async () => {
    const { middleware, refresher } = setup();
    const { req, next, res } = await run(middleware, { cookie: "other=1; auth_sid=good" });
    expect(req.user).toEqual({ sub: "user-1", username: "jo", email: "jo@example.com", name: "Jo", groups: ["admins"] });
    expect(refresher.ensureFresh).toHaveBeenCalledWith(session);
    expect(next).toHaveBeenCalledOnce();
    expect(res.redirect).not.toHaveBeenCalled();
  });

  it("redirects browsers to login and keeps the requested path", async () => {
    const { res, next } = await run(setup().middleware, { ...html, cookie: "auth_sid=unknown" });
    expect(res.redirect).toHaveBeenCalledWith("/auth/login?returnTo=%2Fdashboard%3Fx%3D1");
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 JSON to API clients without a session", async () => {
    const { res, next } = await run(setup().middleware, { accept: "application/json" });
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.redirect).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it("treats a session whose refresh failed as unauthenticated", async () => {
    const { res, next } = await run(setup({ refreshed: null }).middleware, { ...html, cookie: "auth_sid=good" });
    expect(res.redirect).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it("authenticates a Bearer token without consulting sessions", async () => {
    const { middleware, store } = setup();
    const { req, next } = await run(middleware, { authorization: "Bearer abc", cookie: "auth_sid=good" });
    expect(req.user).toMatchObject({ sub: "bearer-user" });
    expect(store.get).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });

  it("returns 401 for an invalid Bearer token even when a session cookie is present", async () => {
    const { middleware, verifier } = setup();
    verifier.verify.mockRejectedValueOnce(new Error("bad token"));
    const { res, next } = await run(middleware, { authorization: "Bearer abc", cookie: "auth_sid=good", ...html });
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("lets unauthenticated requests through without a user when optional", async () => {
    const { req, res, next } = await run(setup({ optional: true }).middleware, html);
    expect(req.user).toBeUndefined();
    expect(next).toHaveBeenCalledOnce();
    expect(res.redirect).not.toHaveBeenCalled();
  });
});
