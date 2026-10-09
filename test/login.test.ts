import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MongoClient, type Db } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import { resolveConfig } from "../src/config";
import { createSessionStore } from "../src/session";
import { createLoginFlow } from "../src/login";

let mongod: MongoMemoryServer;
let client: MongoClient;
let db: Db;

const tokens = { accessToken: "acc", idToken: "idt", refreshToken: "ref", expiresIn: 3600 };
const cognito = {
  authorizeUrl: vi.fn(({ state, codeChallenge }: { state: string; codeChallenge: string }) =>
    `https://cognito.test/authorize?state=${state}&cc=${codeChallenge}`),
  exchangeCode: vi.fn(async (_code: string, _verifier: string) => tokens),
  logoutUrl: vi.fn(() => "https://cognito.test/logout"),
};
const verifier = { verify: vi.fn(async (_token: string, use: string) => ({ sub: "user-1", token_use: use })) };

const makeFlow = () => {
  const config = resolveConfig({
    cognito: { region: "us-east-1", userPoolId: "us-east-1_AbC123", clientId: "c1", domain: "d.example.com",
      callbackUrl: "https://app.example.com/auth/callback", logoutUrl: "https://app.example.com/" },
    db,
    session: { secret: "s".repeat(32) },
  });
  const store = createSessionStore({ db, collection: config.sessionsCollection, secret: config.session.secret, ttlSeconds: config.sessionTtlSeconds });
  return { flow: createLoginFlow({ config, cognito, verifier, store }), store };
};

// "name=value; Path=/..." -> { name: value }, skipping cookies that are being cleared.
const jar = (cookies: string[]) =>
  Object.fromEntries(cookies.map((c) => c.split(";")[0].split("=")).filter(([, value]) => value));
const stateFrom = () => cognito.authorizeUrl.mock.calls.at(-1)![0].state;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  client = await MongoClient.connect(mongod.getUri());
  db = client.db("test");
}, 120_000);
afterAll(async () => {
  await client?.close();
  await mongod?.stop();
});
beforeEach(async () => {
  vi.clearAllMocks();
  await db.collection("authSessions").deleteMany({});
});

describe("login", () => {
  it("redirects to Cognito with a state value and a PKCE challenge", async () => {
    const result = await makeFlow().flow.login({});
    expect(result.status).toBe(302);
    expect(result.location).toMatch(/^https:\/\/cognito\.test\/authorize\?/);
    expect(stateFrom().length).toBeGreaterThanOrEqual(16);
    expect(cognito.authorizeUrl.mock.calls[0][0].codeChallenge).toMatch(/^[\w-]{43}$/);
    expect(result.cookies).toHaveLength(1);
  });

  it("completes the PKCE exchange with the verifier behind the challenge", async () => {
    const { flow } = makeFlow();
    const login = await flow.login({});
    await flow.callback({ query: { code: "auth-code", state: stateFrom() }, cookies: jar(login.cookies) });
    const [code, codeVerifier] = cognito.exchangeCode.mock.calls[0];
    expect(code).toBe("auth-code");
    expect(createHash("sha256").update(codeVerifier).digest("base64url")).toBe(cognito.authorizeUrl.mock.calls[0][0].codeChallenge);
  });
});

describe("callback", () => {
  it("creates a session and redirects to the preserved return path", async () => {
    const { flow, store } = makeFlow();
    const login = await flow.login({ returnTo: "/dashboard?tab=1" });
    const result = await flow.callback({ query: { code: "auth-code", state: stateFrom() }, cookies: jar(login.cookies) });

    expect(result.status).toBe(302);
    expect(result.location).toBe("/dashboard?tab=1");
    expect(verifier.verify).toHaveBeenCalledWith("idt", "id");
    expect(verifier.verify).toHaveBeenCalledWith("acc", "access");
    const sid = jar(result.cookies).auth_sid;
    expect(await store.get(sid)).toMatchObject({ sub: "user-1", accessToken: "acc", refreshToken: "ref" });
    expect(result.cookies.some((c) => c.startsWith("auth_login=;") && c.includes("Max-Age=0"))).toBe(true);
  });

  it.each(["https://evil.example.com/", "//evil.example.com", "javascript:alert(1)"])("ignores external return path %s", async (returnTo) => {
    const { flow } = makeFlow();
    const login = await flow.login({ returnTo });
    const result = await flow.callback({ query: { code: "c", state: stateFrom() }, cookies: jar(login.cookies) });
    expect(result.location).toBe("/");
  });

  it.each([
    ["state mismatch", { code: "c", state: "wrong" }, true],
    ["Cognito error parameter", { error: "access_denied", error_description: "secret detail" }, true],
    ["missing login cookie", { code: "c", state: "x" }, false],
  ])("rejects with 400 and no session on %s", async (_name, query, withCookie) => {
    const { flow } = makeFlow();
    const login = await flow.login({});
    const result = await flow.callback({ query, cookies: withCookie ? jar(login.cookies) : {} });
    expect(result.status).toBe(400);
    expect(JSON.stringify(result)).not.toContain("secret detail");
    expect(jar(result.cookies).auth_sid).toBeUndefined();
    expect(await db.collection("authSessions").countDocuments()).toBe(0);
  });

  it("rejects with 400 and no session when the code exchange fails", async () => {
    cognito.exchangeCode.mockRejectedValueOnce(new Error("invalid_grant: internal detail"));
    const { flow } = makeFlow();
    const login = await flow.login({});
    const result = await flow.callback({ query: { code: "c", state: stateFrom() }, cookies: jar(login.cookies) });
    expect(result.status).toBe(400);
    expect(JSON.stringify(result)).not.toContain("internal detail");
    expect(await db.collection("authSessions").countDocuments()).toBe(0);
  });

  it("rejects with 400 and no session when a token was issued for another app client", async () => {
    verifier.verify.mockRejectedValueOnce(new Error("token issued for a different app client"));
    const { flow } = makeFlow();
    const login = await flow.login({});
    const result = await flow.callback({ query: { code: "c", state: stateFrom() }, cookies: jar(login.cookies) });
    expect(result.status).toBe(400);
    expect(JSON.stringify(result)).not.toContain("different app client");
    expect(await db.collection("authSessions").countDocuments()).toBe(0);
  });
});

describe("logout", () => {
  it("destroys the session, clears the cookie and redirects to Cognito logout", async () => {
    const { flow, store } = makeFlow();
    const login = await flow.login({});
    const callback = await flow.callback({ query: { code: "c", state: stateFrom() }, cookies: jar(login.cookies) });
    const sid = jar(callback.cookies).auth_sid;

    const result = await flow.logout({ cookies: { auth_sid: sid } });
    expect(result.status).toBe(302);
    expect(result.location).toBe("https://cognito.test/logout");
    expect(result.cookies.some((c) => c.startsWith("auth_sid=;") && c.includes("Max-Age=0"))).toBe(true);
    expect(await store.get(sid)).toBeNull();
  });

  it.each([["no session cookie", {}], ["a stale session cookie", { auth_sid: "gone" }]])(
    "still redirects to Cognito logout without error with %s",
    async (_name, cookies) => {
      const result = await makeFlow().flow.logout({ cookies });
      expect(result.status).toBe(302);
      expect(result.location).toBe("https://cognito.test/logout");
    },
  );
});
