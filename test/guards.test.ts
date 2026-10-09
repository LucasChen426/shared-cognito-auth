import { describe, expect, it, vi } from "vitest";
import { createGuards } from "../src/guards";
import type { Authorization } from "../src/authorization";

function setup(result: Authorization | Error) {
  const authorization = {
    resolve: vi.fn(async () => {
      if (result instanceof Error) throw result;
      return result;
    }),
  };
  return { authorization, guards: createGuards({ authorization, routePrefix: "/auth" }) };
}

type Guard = ReturnType<ReturnType<typeof createGuards>["requireRole"]>;

async function run(guard: Guard, user?: { sub: string }, headers: Record<string, string> = {}) {
  const req: Record<string, unknown> = { headers, originalUrl: "/admin", user };
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn(), redirect: vi.fn() };
  const next = vi.fn();
  await guard(req as never, res as never, next);
  return { req, res, next };
}

const user = { sub: "user-1" };

describe("requireRole", () => {
  it("allows a user who has one of the required roles", async () => {
    const { guards, authorization } = setup({ roles: ["editor"], permissions: [] });
    const { next, res, req } = await run(guards.requireRole("admin", "editor"), user);
    expect(authorization.resolve).toHaveBeenCalledWith("user-1");
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
    expect(req.authorization).toEqual({ roles: ["editor"], permissions: [] });
  });

  it("returns 403 for an authenticated user without a required role", async () => {
    const { guards } = setup({ roles: ["viewer"], permissions: [] });
    const { res, next } = await run(guards.requireRole("admin"), user);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 for an unauthenticated API request", async () => {
    const { guards, authorization } = setup({ roles: ["admin"], permissions: [] });
    const { res, next } = await run(guards.requireRole("admin"));
    expect(res.status).toHaveBeenCalledWith(401);
    expect(authorization.resolve).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it("redirects an unauthenticated browser request to login", async () => {
    const { guards } = setup({ roles: ["admin"], permissions: [] });
    const { res } = await run(guards.requireRole("admin"), undefined, { accept: "text/html" });
    expect(res.redirect).toHaveBeenCalledWith("/auth/login?returnTo=%2Fadmin");
  });

  it("returns 503 and assumes no roles when the lookup fails", async () => {
    const { guards } = setup(new Error("database down"));
    const { res, next } = await run(guards.requireRole("admin"), user);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(JSON.stringify(res.json.mock.calls)).not.toContain("database down");
    expect(next).not.toHaveBeenCalled();
  });
});

describe("requirePermission", () => {
  it("allows a user who has every required permission", async () => {
    const { guards } = setup({ roles: [], permissions: ["posts:read", "posts:write"] });
    const { next } = await run(guards.requirePermission("posts:read", "posts:write"), user);
    expect(next).toHaveBeenCalledOnce();
  });

  it("returns 403 when any required permission is missing", async () => {
    const { guards } = setup({ roles: [], permissions: ["posts:read"] });
    const { res, next } = await run(guards.requirePermission("posts:read", "posts:write"), user);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});
