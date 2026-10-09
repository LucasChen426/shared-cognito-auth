import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MongoClient, type Db } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import { createAuthorizationResolver } from "../src/authorization";

let mongod: MongoMemoryServer;
let client: MongoClient;
let db: Db;

const resolver = (options: Partial<Parameters<typeof createAuthorizationResolver>[0]> = {}) =>
  createAuthorizationResolver({ db, collection: "userRoles", cacheTtlSeconds: 0, ...options });

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
  await db.collection("userRoles").deleteMany({});
  await db.collection("userRoles").insertOne({ sub: "user-1", roles: ["admin", "editor"], permissions: ["posts:write"] });
});

describe("default lookup", () => {
  it("returns roles and permissions stored for the user", async () => {
    expect(await resolver().resolve("user-1")).toEqual({ roles: ["admin", "editor"], permissions: ["posts:write"] });
  });

  it("treats a user with no record as having no roles and no permissions", async () => {
    expect(await resolver().resolve("someone-else")).toEqual({ roles: [], permissions: [] });
  });

  it("defaults missing fields in a record to empty lists", async () => {
    await db.collection("userRoles").insertOne({ sub: "user-2", roles: ["viewer"] });
    expect(await resolver().resolve("user-2")).toEqual({ roles: ["viewer"], permissions: [] });
  });

  it("reads from the configured collection", async () => {
    await db.collection("staff").insertOne({ sub: "user-3", roles: ["ops"], permissions: [] });
    expect(await resolver({ collection: "staff" }).resolve("user-3")).toEqual({ roles: ["ops"], permissions: [] });
  });
});

describe("custom lookup", () => {
  it("uses the custom lookup instead of the default collection", async () => {
    const getAuthorization = vi.fn(async () => ({ roles: ["custom"], permissions: ["x"] }));
    expect(await resolver({ getAuthorization }).resolve("user-1")).toEqual({ roles: ["custom"], permissions: ["x"] });
    expect(getAuthorization).toHaveBeenCalledWith("user-1");
  });

  it("treats a null result as no roles and no permissions", async () => {
    expect(await resolver({ getAuthorization: async () => null }).resolve("user-1")).toEqual({ roles: [], permissions: [] });
  });

  it("rejects when the lookup fails so callers can deny access", async () => {
    const getAuthorization = vi.fn(async () => {
      throw new Error("database down");
    });
    await expect(resolver({ getAuthorization }).resolve("user-1")).rejects.toThrow("database down");
  });
});

describe("role cache", () => {
  const lookup = () => vi.fn(async () => ({ roles: ["a"], permissions: [] }));

  it("reads once for repeated requests within the cache period, then again after it", async () => {
    let clock = 0;
    const getAuthorization = lookup();
    const r = resolver({ getAuthorization, cacheTtlSeconds: 60, now: () => clock });
    await r.resolve("user-1");
    clock += 59_000;
    await r.resolve("user-1");
    expect(getAuthorization).toHaveBeenCalledTimes(1);
    clock += 2_000;
    await r.resolve("user-1");
    expect(getAuthorization).toHaveBeenCalledTimes(2);
  });

  it("caches each user separately", async () => {
    const getAuthorization = lookup();
    const r = resolver({ getAuthorization, cacheTtlSeconds: 60 });
    await r.resolve("user-1");
    await r.resolve("user-2");
    expect(getAuthorization).toHaveBeenCalledTimes(2);
  });

  it("uses updated roles after the cache is cleared for a user", async () => {
    const r = resolver({ cacheTtlSeconds: 60 });
    expect((await r.resolve("user-1")).roles).toEqual(["admin", "editor"]);
    await db.collection("userRoles").updateOne({ sub: "user-1" }, { $set: { roles: ["viewer"] } });
    expect((await r.resolve("user-1")).roles).toEqual(["admin", "editor"]);
    r.invalidate("user-1");
    expect((await r.resolve("user-1")).roles).toEqual(["viewer"]);
  });

  it("does not cache failed lookups", async () => {
    const getAuthorization = vi.fn().mockRejectedValueOnce(new Error("down")).mockResolvedValue({ roles: ["a"] });
    const r = resolver({ getAuthorization, cacheTtlSeconds: 60 });
    await expect(r.resolve("user-1")).rejects.toThrow("down");
    expect((await r.resolve("user-1")).roles).toEqual(["a"]);
  });
});
