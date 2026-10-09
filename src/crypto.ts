import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

// AES-256-GCM with a key derived from the app secret; `info` keeps keys separate per purpose.
export function createSealer(secret: string, info: string) {
  const key = Buffer.from(hkdfSync("sha256", secret, "auth-session", info, 32));

  return {
    seal(value: object): string {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const body = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
    },

    open<T>(payload: string): T | null {
      try {
        const raw = Buffer.from(payload, "base64url");
        const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
        decipher.setAuthTag(raw.subarray(12, 28));
        const text = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
        return JSON.parse(text) as T;
      } catch {
        return null;
      }
    },
  };
}
