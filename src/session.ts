import { createHash, randomBytes } from "node:crypto";
import type { Db } from "mongodb";
import { createSealer } from "./crypto";

export interface SessionData {
  sub: string;
  accessToken: string;
  idToken: string;
  refreshToken: string;
  accessExpiresAt: number;
}

export interface Session extends SessionData {
  id: string;
  version: number;
}

export interface SessionStoreOptions {
  db: Db;
  collection: string;
  secret: string;
  ttlSeconds: number;
  now?: () => number;
}

interface StoredSession {
  _id: string;
  sub: string;
  accessExpiresAt: number;
  tokens: string;
  version: number;
  expiresAt: Date;
}

const hashId = (id: string) => createHash("sha256").update(id).digest("hex");

export function createSessionStore({ db, collection, secret, ttlSeconds, now = Date.now }: SessionStoreOptions) {
  const sessions = db.collection<StoredSession>(collection);
  const sealer = createSealer(secret, "tokens");
  const encrypt = sealer.seal;
  const decrypt = (payload: string) =>
    sealer.open<Pick<SessionData, "accessToken" | "idToken" | "refreshToken">>(payload);

  return {
    async init() {
      await sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    },

    async create({ sub, accessExpiresAt, ...tokens }: SessionData) {
      const id = randomBytes(32).toString("base64url");
      await sessions.insertOne({
        _id: hashId(id),
        sub,
        accessExpiresAt,
        tokens: encrypt(tokens),
        version: 0,
        expiresAt: new Date(now() + ttlSeconds * 1000),
      });
      return { id };
    },

    async get(id: string): Promise<Session | null> {
      const doc = await sessions.findOne({ _id: hashId(id) });
      if (!doc) return null;
      if (doc.expiresAt.getTime() <= now()) {
        await sessions.deleteOne({ _id: doc._id });
        return null;
      }
      const tokens = decrypt(doc.tokens);
      if (!tokens) return null;
      return { id, sub: doc.sub, accessExpiresAt: doc.accessExpiresAt, version: doc.version, ...tokens };
    },

    async destroy(id: string) {
      await sessions.deleteOne({ _id: hashId(id) });
    },

    // Writes only if no other instance changed the session since `expectedVersion`.
    async update(id: string, expectedVersion: number, { accessExpiresAt, ...tokens }: Omit<SessionData, "sub">) {
      const result = await sessions.updateOne(
        { _id: hashId(id), version: expectedVersion },
        { $set: { accessExpiresAt, tokens: encrypt(tokens) }, $inc: { version: 1 } },
      );
      return result.modifiedCount === 1;
    },
  };
}

export type SessionStore = ReturnType<typeof createSessionStore>;

export function serializeSessionCookie(
  name: string,
  value: string,
  { maxAgeSeconds, secure }: { maxAgeSeconds: number; secure: boolean },
) {
  return [`${name}=${value}`, "Path=/", `Max-Age=${maxAgeSeconds}`, "HttpOnly", "SameSite=Lax", ...(secure ? ["Secure"] : [])].join("; ");
}
