import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MongoClient, type Db } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import { createAuth, type AuthUser } from "../src/index";
import { createTokenVerifier } from "../src/verifier";

const region = "us-east-1";
const userPoolId = "us-east-1_AbC123";
const clientId = "client-1";
const issuer = `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`;

// ---- Fake Cognito: hosted UI redirects, token endpoint, JWKS and logout ----
let cognitoServer: Server;
let cognitoBase: string;
let signingKey: Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];
let jwk: JWK;
let currentUser = { sub: "user-1", email: "jo@example.com" };
let accessTtlSeconds = 3600;
let refreshGrants = 0;
let pkceChallenge = "";
let lastAccessToken = "";

const sign = (claims: Record<string, unknown>, ttl: number) =>
  new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(issuer)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttl)
    .sign(signingKey);

async function cognitoHandler(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url!, cognitoBase);
  const redirect = (location: string) => void res.writeHead(302, { location }).end();

  if (url.pathname === "/jwks.json") return void res.end(JSON.stringify({ keys: [jwk] }));
  if (url.pathname === "/logout") return redirect(url.searchParams.get("logout_uri")!);
  if (url.pathname === "/oauth2/authorize") {
    pkceChallenge = url.searchParams.get("code_challenge")!;
    const callback = new URL(url.searchParams.get("redirect_uri")!);
    callback.searchParams.set("code", "code-1");
    callback.searchParams.set("state", url.searchParams.get("state")!);
    return redirect(callback.toString());
  }
  if (url.pathname === "/oauth2/token") {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const form = new URLSearchParams(Buffer.concat(chunks).toString());
    const grant = form.get("grant_type");
    if (grant === "authorization_code") {
      const verifierMatches = createHash("sha256").update(form.get("code_verifier") ?? "").digest("base64url") === pkceChallenge;
      if (form.get("code") !== "code-1" || !verifierMatches) return void res.writeHead(400).end("{}");
    } else if (grant === "refresh_token" && form.get("refresh_token") === "refresh-1") {
      refreshGrants++;
    } else {
      return void res.writeHead(400).end("{}");
    }
    lastAccessToken = await sign({ token_use: "access", client_id: clientId, sub: currentUser.sub, "cognito:groups": ["staff"] }, accessTtlSeconds);
    const idToken = await sign({ token_use: "id", aud: clientId, ...currentUser, name: "Jo" }, accessTtlSeconds);
    return void res.end(
      JSON.stringify({
        access_token: lastAccessToken,
        id_token: idToken,
        expires_in: accessTtlSeconds,
        ...(grant === "authorization_code" && { refresh_token: "refresh-1" }),
      }),
    );
  }
  res.writeHead(404).end();
}

// ---- The service under test ----
let mongod: MongoMemoryServer;
let client: MongoClient;
let db: Db;
let appServer: Server;
let base: string;

const app = (path: string, init: RequestInit = {}) => fetch(`${base}${path}`, { redirect: "manual", ...init });
const cookies = (res: Response) =>
  res.headers.getSetCookie().map((c) => c.split(";")[0]).filter((c) => !c.endsWith("=")).join("; ");

async function signIn(returnTo = "/me") {
  const login = await app(`/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
  const authorize = await fetch(login.headers.get("location")!, { redirect: "manual" });
  const callback = new URL(authorize.headers.get("location")!);
  const result = await app(callback.pathname + callback.search, { headers: { cookie: cookies(login) } });
  return { result, cookie: cookies(result) };
}

beforeAll(async () => {
  const keys = await generateKeyPair("RS256");
  signingKey = keys.privateKey;
  jwk = { ...(await exportJWK(keys.publicKey)), kid: "k1", alg: "RS256", use: "sig" };
  cognitoServer = createServer((req, res) => void cognitoHandler(req, res));
  await new Promise<void>((resolve) => cognitoServer.listen(0, "127.0.0.1", resolve));
  cognitoBase = `http://127.0.0.1:${(cognitoServer.address() as AddressInfo).port}`;

  mongod = await MongoMemoryServer.create();
  client = await MongoClient.connect(mongod.getUri());
  db = client.db("test");

  const cognito = {
    region,
    userPoolId,
    clientId,
    domain: cognitoBase,
    callbackUrl: "http://localhost/auth/callback",
    logoutUrl: "http://localhost/goodbye",
  };
  const auth = createAuth(
    { cognito, db, session: { secret: "s".repeat(32) } },
    { verifier: createTokenVerifier(cognito, { jwksUri: `${cognitoBase}/jwks.json` }) },
  );

  const service = express();
  service.use(auth.router());
  service.get("/public", (_req, res) => void res.send("public"));
  service.use(auth.middleware());
  service.get("/me", (req, res) => void res.json((req as typeof req & { user?: AuthUser }).user));
  service.get("/admin", auth.requireRole("admin"), (_req, res) => void res.send("admin area"));
  service.get("/reports", auth.requirePermission("reports:read"), (_req, res) => void res.send("reports"));
  appServer = service.listen(0, "127.0.0.1");
  await new Promise((resolve) => appServer.once("listening", resolve));
  base = `http://127.0.0.1:${(appServer.address() as AddressInfo).port}`;
}, 120_000);

afterAll(async () => {
  appServer?.close();
  cognitoServer?.close();
  await client?.close();
  await mongod?.stop();
});

beforeEach(async () => {
  currentUser = { sub: "user-1", email: "jo@example.com" };
  accessTtlSeconds = 3600;
  refreshGrants = 0;
  await db.collection("authSessions").deleteMany({});
  await db.collection("userRoles").deleteMany({});
  await db.collection("userRoles").insertOne({ sub: "user-1", roles: ["admin"], permissions: ["reports:read"] });
});

describe("end to end", () => {
  it("leaves public routes open and protects the rest", async () => {
    expect(await (await app("/public")).text()).toBe("public");
    expect((await app("/me", { headers: { accept: "application/json" } })).status).toBe(401);
    const browser = await app("/me", { headers: { accept: "text/html" } });
    expect(browser.status).toBe(302);
    expect(browser.headers.get("location")).toBe("/auth/login?returnTo=%2Fme");
  });

  it("logs in through Cognito and returns to the requested page with a session", async () => {
    const { result, cookie } = await signIn("/me");
    expect(result.status).toBe(302);
    expect(result.headers.get("location")).toBe("/me");
    const me = await app("/me", { headers: { cookie } });
    expect(await me.json()).toEqual({ sub: "user-1", email: "jo@example.com", name: "Jo", groups: [] });
  });

  it("enforces roles and permissions from the service's own MongoDB", async () => {
    const { cookie } = await signIn();
    expect((await app("/admin", { headers: { cookie } })).status).toBe(200);
    expect((await app("/reports", { headers: { cookie } })).status).toBe(200);

    currentUser = { sub: "user-2", email: "sam@example.com" };
    const other = await signIn();
    expect((await app("/admin", { headers: { cookie: other.cookie } })).status).toBe(403);
    expect((await app("/reports", { headers: { cookie: other.cookie } })).status).toBe(403);
  });

  it("refreshes tokens automatically when the access token is near expiry", async () => {
    accessTtlSeconds = 100;
    const { cookie } = await signIn();
    expect(refreshGrants).toBe(0);
    expect((await app("/me", { headers: { cookie } })).status).toBe(200);
    expect(refreshGrants).toBe(1);
  });

  it("refreshes on demand through the refresh route", async () => {
    const { cookie } = await signIn();
    expect((await app("/auth/refresh", { method: "POST", headers: { cookie } })).status).toBe(200);
    expect(refreshGrants).toBe(1);
    expect((await app("/auth/refresh", { method: "POST" })).status).toBe(401);
  });

  it("accepts a Cognito access token as a Bearer token", async () => {
    await signIn();
    const res = await app("/me", { headers: { authorization: `Bearer ${lastAccessToken}` } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ sub: "user-1", groups: ["staff"] });
    expect((await app("/me", { headers: { authorization: "Bearer not-a-token" } })).status).toBe(401);
  });

  it("logs out of the service and Cognito, ending the session", async () => {
    const { cookie } = await signIn();
    const logout = await app("/auth/logout", { method: "POST", headers: { cookie } });
    expect(logout.status).toBe(302);
    const cognitoLogout = await fetch(logout.headers.get("location")!, { redirect: "manual" });
    expect(cognitoLogout.headers.get("location")).toBe("http://localhost/goodbye");
    expect((await app("/me", { headers: { cookie, accept: "application/json" } })).status).toBe(401);
  });
});
