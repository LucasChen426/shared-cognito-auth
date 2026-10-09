import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { createAuth } from "../src/index";
import { resolveConfig } from "../src/config";

const db = { collection: () => ({}) } as unknown as Db;
const secret = "x".repeat(32);

const validInput = () => ({
  cognito: {
    region: "us-east-1",
    userPoolId: "us-east-1_AbC123",
    clientId: "client-1",
    domain: "myapp.auth.us-east-1.amazoncognito.com",
    callbackUrl: "https://app.example.com/auth/callback",
    logoutUrl: "https://app.example.com/",
  },
  db,
  session: { secret },
});

describe("resolveConfig", () => {
  it("applies defaults when only required settings are given", () => {
    const config = resolveConfig(validInput());
    expect(config.routePrefix).toBe("/auth");
    expect(config.cookieName).toBe("auth_sid");
    expect(config.sessionTtlSeconds).toBe(28800);
    expect(config.refreshWindowSeconds).toBe(300);
    expect(config.rolesCollection).toBe("userRoles");
    expect(config.roleCacheTtlSeconds).toBe(60);
    expect(config.cognito.domain).toBe("https://myapp.auth.us-east-1.amazoncognito.com");
  });

  it("uses optional overrides", () => {
    const config = resolveConfig({
      ...validInput(),
      routePrefix: "/sso",
      cookieName: "my_sid",
      sessionTtlSeconds: 600,
      refreshWindowSeconds: 30,
    });
    expect(config.routePrefix).toBe("/sso");
    expect(config.cookieName).toBe("my_sid");
    expect(config.sessionTtlSeconds).toBe(600);
    expect(config.refreshWindowSeconds).toBe(30);
  });

  it("names every missing setting in a single error", () => {
    expect(() => resolveConfig({} as never)).toThrowError(
      /cognito\.region[\s\S]*cognito\.userPoolId[\s\S]*cognito\.clientId[\s\S]*cognito\.domain[\s\S]*cognito\.callbackUrl[\s\S]*cognito\.logoutUrl[\s\S]*db[\s\S]*session\.secret/,
    );
  });

  it("rejects invalid values", () => {
    const input = validInput();
    input.cognito.callbackUrl = "not-a-url";
    expect(() => resolveConfig({ ...input, routePrefix: "auth" })).toThrowError(
      /cognito\.callbackUrl[\s\S]*routePrefix/,
    );
  });

  it("never includes secret values in the error message", () => {
    const shortSecret = "hunter2-short";
    let message = "";
    try {
      resolveConfig({ ...validInput(), session: { secret: shortSecret } });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain("session.secret");
    expect(message).not.toContain(shortSecret);
  });
});

describe("createAuth", () => {
  it("fails on invalid configuration", () => {
    expect(() => createAuth({} as never)).toThrowError(/cognito\.userPoolId/);
  });

  it("accepts valid configuration", () => {
    expect(() => createAuth(validInput())).not.toThrow();
  });
});
