import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MongoClient, type Db } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import { createSessionStore } from "../src/session";
import { createRefresher } from "../src/refresh";

const secret = "s".repeat(32);
const NOW = 1_000_000;
let mongod: MongoMemoryServer;
let client: MongoClient;
let db: Db;
let calls = 0;

const cognito = {
  refreshTokens: vi.fn(async (_refreshToken: string) => {
    const n = ++calls;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return { accessToken: `new-access-${n}`, idToken: `new-id-${n}`, expiresIn: 3600 };
  }),
};

const store = () => createSessionStore({ db, collection: "authSessions", secret, ttlSeconds: 86400, now: () => NOW });
const refresher = (s = store()) => createRefresher({ store: s, cognito, refreshWindowSeconds: 300, now: () => NOW });
const create = (accessExpiresInMs: number) =>
  store().create({ sub: "user-1", accessToken: "old-access", idToken: "old-id", refreshToken: "refresh-1", accessExpiresAt: NOW + accessExpiresInMs });

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
  calls = 0;
  cognito.refreshTokens.mockClear();
  await db.collection("authSessions").deleteMany({});
});

describe("createRefresher", () => {
  it("leaves the session alone when the access token is outside the refresh window", async () => {
    const { id } = await create(3_600_000);
    const session = (await store().get(id))!;
    expect(await refresher().ensureFresh(session)).toEqual(session);
    expect(cognito.refreshTokens).not.toHaveBeenCalled();
  });

  it("refreshes tokens when the access token is near expiry and keeps the refresh token", async () => {
    const { id } = await create(100_000);
    const fresh = await refresher().ensureFresh((await store().get(id))!);
    expect(cognito.refreshTokens).toHaveBeenCalledWith("refresh-1");
    expect(fresh).toMatchObject({ accessToken: "new-access-1", idToken: "new-id-1", refreshToken: "refresh-1" });
    expect(fresh!.accessExpiresAt).toBe(NOW + 3_600_000);
    expect(await store().get(id)).toMatchObject({ accessToken: "new-access-1", version: 1 });
  });

  it("makes one Cognito call for concurrent requests on the same session", async () => {
    const { id } = await create(100_000);
    const session = (await store().get(id))!;
    const r = refresher();
    const results = await Promise.all(Array.from({ length: 5 }, () => r.ensureFresh(session)));
    expect(cognito.refreshTokens).toHaveBeenCalledTimes(1);
    expect(new Set(results.map((s) => s!.accessToken))).toEqual(new Set(["new-access-1"]));
  });

  it("converges on one result when two instances refresh the same session", async () => {
    const { id } = await create(100_000);
    const session = (await store().get(id))!;
    const results = await Promise.all([refresher().ensureFresh(session), refresher().ensureFresh(session)]);
    const stored = (await store().get(id))!;
    expect(results[0]!.accessToken).toBe(stored.accessToken);
    expect(results[1]!.accessToken).toBe(stored.accessToken);
    expect(stored.version).toBe(1);
  });

  it("destroys the session and returns null when Cognito rejects the refresh token", async () => {
    cognito.refreshTokens.mockRejectedValueOnce(new Error("invalid_grant"));
    const { id } = await create(100_000);
    expect(await refresher().ensureFresh((await store().get(id))!)).toBeNull();
    expect(await store().get(id)).toBeNull();
  });
});
