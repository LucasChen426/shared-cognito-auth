import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MongoClient, type Db } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import { createSessionStore, serializeSessionCookie } from "../src/session";

const secret = "s".repeat(32);
const tokens = {
  accessToken: "access-token-plaintext",
  idToken: "id-token-plaintext",
  refreshToken: "refresh-token-plaintext",
};
const data = { sub: "user-1", ...tokens, accessExpiresAt: 2_000_000 };

let mongod: MongoMemoryServer;
let client: MongoClient;
let db: Db;
let clock = 1_000_000;

const makeStore = (overrides: { secret?: string; ttlSeconds?: number } = {}) =>
  createSessionStore({ db, collection: "authSessions", secret, ttlSeconds: 600, now: () => clock, ...overrides });

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
  clock = 1_000_000;
  await db.collection("authSessions").deleteMany({});
});

describe("session store", () => {
  it("stores tokens encrypted and keys the document by a hash of the session id", async () => {
    const { id } = await makeStore().create(data);
    const raw = await db.collection("authSessions").find().toArray();
    expect(raw).toHaveLength(1);
    expect(raw[0]._id).not.toBe(id);
    const text = JSON.stringify(raw[0]);
    for (const token of Object.values(tokens)) expect(text).not.toContain(token);
  });

  it("returns the session after a restart (new store instance, same database)", async () => {
    const { id } = await makeStore().create(data);
    const session = await makeStore().get(id);
    expect(session).toMatchObject(data);
  });

  it("does not return a session for an unknown id or a different secret", async () => {
    const { id } = await makeStore().create(data);
    expect(await makeStore().get("unknown-id")).toBeNull();
    expect(await makeStore({ secret: "t".repeat(32) }).get(id)).toBeNull();
  });

  it("rejects and removes an expired session", async () => {
    const { id } = await makeStore().create(data);
    clock += 601_000;
    expect(await makeStore().get(id)).toBeNull();
    expect(await db.collection("authSessions").countDocuments()).toBe(0);
  });

  it("destroys a session", async () => {
    const store = makeStore();
    const { id } = await store.create(data);
    await store.destroy(id);
    expect(await store.get(id)).toBeNull();
  });

  it("creates a TTL index so expired sessions are removed by the database", async () => {
    await makeStore().init();
    const indexes = await db.collection("authSessions").indexes();
    expect(indexes.some((i) => i.key.expiresAt === 1 && i.expireAfterSeconds === 0)).toBe(true);
  });
});

describe("serializeSessionCookie", () => {
  it("sets HttpOnly, SameSite and Max-Age, and carries only the session id", () => {
    const cookie = serializeSessionCookie("auth_sid", "abc123", { maxAgeSeconds: 600, secure: false });
    expect(cookie).toMatch(/^auth_sid=abc123;/);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Max-Age=600");
    expect(cookie).toContain("Path=/");
    expect(cookie).not.toContain("Secure");
  });

  it("adds Secure when running in production", () => {
    expect(serializeSessionCookie("auth_sid", "abc123", { maxAgeSeconds: 600, secure: true })).toContain("Secure");
  });
});
