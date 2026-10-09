import { describe, expect, it, vi } from "vitest";
import type { JWTPayload } from "jose";
import { bearerAuth } from "../src/bearer";
import type { TokenVerifier } from "../src/verifier";

const verifier = (result: JWTPayload | Error): TokenVerifier => ({
  verify: vi.fn(async () => {
    if (result instanceof Error) throw result;
    return result;
  }),
});

function run(handler: ReturnType<typeof bearerAuth>, authorization?: string) {
  const req: Record<string, unknown> = { headers: authorization === undefined ? {} : { authorization } };
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn(), setHeader: vi.fn(), cookie: vi.fn() };
  const next = vi.fn();
  return handler(req as never, res as never, next).then(() => ({ req, res, next }));
}

describe("bearerAuth", () => {
  it("authenticates a valid bearer token", async () => {
    const v = verifier({ sub: "user-1", username: "jo", "cognito:groups": ["admins"] });
    const { req, res, next } = await run(bearerAuth(v), "Bearer abc.def.ghi");
    expect(v.verify).toHaveBeenCalledWith("abc.def.ghi", "access");
    expect(req.user).toEqual({ sub: "user-1", username: "jo", groups: ["admins"] });
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("passes through when no Authorization header is present", async () => {
    const { req, next } = await run(bearerAuth(verifier(new Error("unused"))));
    expect(req.user).toBeUndefined();
    expect(next).toHaveBeenCalledOnce();
  });

  it.each(["Basic abc", "Bearer", "Bearer  ", "Bearer a b", "abc.def"])("returns 401 for malformed header %j", async (header) => {
    const v = verifier({ sub: "user-1" });
    const { res, next } = await run(bearerAuth(v), header);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
    expect(v.verify).not.toHaveBeenCalled();
  });

  it("returns 401 and creates no session for an invalid token", async () => {
    const { req, res, next } = await run(bearerAuth(verifier(new Error("bad signature"))), "Bearer abc");
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
    expect(req.user).toBeUndefined();
    expect(req.session).toBeUndefined();
    expect(res.cookie).not.toHaveBeenCalled();
    expect(res.setHeader).not.toHaveBeenCalled();
  });
});
