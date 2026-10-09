import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MongoClient, type Db } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import { createAuth } from "../src/index";

let mongod: MongoMemoryServer;
let client: MongoClient;
let db: Db;
let server: Server;
let base: string;

const tokens = { accessToken: "acc", idToken: "id.token.sig", refreshToken: "ref", expiresIn: 3600 };
const cognito = {
  authorizeUrl: vi.fn(({ state }: { state: string; codeChallenge: string }) => `https://cognito.test/authorize?state=${state}`),
  exchangeCode: vi.fn(async (_code: string, _verifier: string) => tokens),
  refreshTokens: vi.fn(async (_refreshToken: string) => ({ accessToken: "acc2", idToken: "id.token.sig", expiresIn: 3600 })),
  logoutUrl: vi.fn(() => "https://cognito.test/logout"),
};
const verifier = { verify: vi.fn(async (_token: string, use: string) => ({ sub: "user-1", token_use: use })) };

const request = (path: string, init: RequestInit = {}) => fetch(`${base}${path}`, { redirect: "manual", ...init });
const cookieJar = (res: Response) =>
  res.headers.getSetCookie().map((c) => c.split(";")[0]).filter((c) => !c.endsWith("=")).join("; ");

// Logs in through the mounted routes and returns the cookie header for the new session.
async function signIn() {
  const login = await request("/sso/login?returnTo=/home");
  const state = new URL(login.headers.get("location")!).searchParams.get("state")!;
  const callback = await request(`/sso/callback?code=c&state=${state}`, { headers: { cookie: cookieJar(login) } });
  return { callback, cookie: cookieJar(callback) };
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  client = await MongoClient.connect(mongod.getUri());
  db = client.db("test");

  const auth = createAuth(
    {
      cognito: { region: "us-east-1", userPoolId: "us-east-1_AbC123", clientId: "c1", domain: "d.example.com",
        callbackUrl: "https://app.example.com/sso/callback", logoutUrl: "https://app.example.com/" },
      db,
      session: { secret: "s".repeat(32) },
      routePrefix: "/sso",
    },
    { cognito, verifier },
  );
  const app = express();
  app.use(auth.router());
  app.get("/public", (_req, res) => void res.send("public"));
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 120_000);
afterAll(async () => {
  server?.close();
  await client?.close();
  await mongod?.stop();
});
beforeEach(async () => {
  vi.clearAllMocks();
  await db.collection("authSessions").deleteMany({});
});

describe("router mounted under a custom prefix", () => {
  it("serves the login route", async () => {
    const res = await request("/sso/login");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toMatch(/^https:\/\/cognito\.test\/authorize\?state=/);
  });

  it("serves the callback route", async () => {
    const { callback } = await signIn();
    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe("/home");
    expect(cookieJar(callback)).toMatch(/^auth_sid=/);
    expect((await request("/sso/callback?code=c&state=wrong")).status).toBe(400);
  });

  it("serves the logout route and destroys the session", async () => {
    const { cookie } = await signIn();
    const res = await request("/sso/logout", { method: "POST", headers: { cookie } });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://cognito.test/logout");
    expect(await db.collection("authSessions").countDocuments()).toBe(0);
  });

  it("serves the refresh route: 200 with a session, 401 without", async () => {
    const { cookie } = await signIn();
    const ok = await request("/sso/refresh", { method: "POST", headers: { cookie } });
    expect(ok.status).toBe(200);
    expect(cognito.refreshTokens).toHaveBeenCalledWith("ref");
    expect((await request("/sso/refresh", { method: "POST" })).status).toBe(401);
  });

  it("rejects the wrong HTTP method with 405", async () => {
    const res = await request("/sso/logout");
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST");
  });

  it("leaves other paths, including the default prefix, to the application", async () => {
    expect(await (await request("/public")).text()).toBe("public");
    expect((await request("/auth/login")).status).toBe(404);
  });
});
