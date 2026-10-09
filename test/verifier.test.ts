import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { exportJWK, generateKeyPair, SignJWT, type JWK, type JWTPayload } from "jose";
import { createTokenVerifier } from "../src/verifier";

const region = "us-east-1";
const userPoolId = "us-east-1_AbC123";
const clientId = "client-1";
const issuer = `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`;
const cognito = {
  region,
  userPoolId,
  clientId,
  domain: "https://d.example.com",
  callbackUrl: "https://a.example.com/cb",
  logoutUrl: "https://a.example.com/",
};

type TestKey = Awaited<ReturnType<typeof newKey>>;
async function newKey(kid: string) {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid, alg: "RS256", use: "sig" };
  return { kid, privateKey, jwk };
}

const now = () => Math.floor(Date.now() / 1000);
const sign = (key: TestKey, claims: JWTPayload, opts: { iss?: string; exp?: number } = {}) =>
  new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: key.kid })
    .setIssuer(opts.iss ?? issuer)
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? now() + 3600)
    .sign(key.privateKey);

const access = { token_use: "access", client_id: clientId, sub: "user-1" };
const idClaims = { token_use: "id", aud: clientId, sub: "user-1" };

let server: Server;
let jwksUri: string;
let served: JWK[] = [];
let hits = 0;
let key: TestKey;

beforeAll(async () => {
  server = createServer((_req, res) => {
    hits++;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ keys: served }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  jwksUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}/jwks.json`;
});
afterAll(() => void server.close());

beforeEach(async () => {
  key = await newKey("key-a");
  served = [key.jwk];
  hits = 0;
});

const verifier = () => createTokenVerifier(cognito, { jwksUri, jwksCooldownMs: 0 });

describe("createTokenVerifier", () => {
  it("accepts a valid access token", async () => {
    const payload = await verifier().verify(await sign(key, access), "access");
    expect(payload.sub).toBe("user-1");
  });

  it("accepts a valid id token", async () => {
    const payload = await verifier().verify(await sign(key, idClaims), "id");
    expect(payload.sub).toBe("user-1");
  });

  it("rejects a bad signature", async () => {
    const attacker = { ...(await newKey("key-a")) };
    await expect(verifier().verify(await sign(attacker, access), "access")).rejects.toThrow();
  });

  it("rejects a wrong issuer", async () => {
    const token = await sign(key, access, { iss: "https://evil.example.com/pool" });
    await expect(verifier().verify(token, "access")).rejects.toThrow();
  });

  it("rejects a token issued for another app client", async () => {
    await expect(verifier().verify(await sign(key, { ...access, client_id: "other" }), "access")).rejects.toThrow();
    await expect(verifier().verify(await sign(key, { ...idClaims, aud: "other" }), "id")).rejects.toThrow();
  });

  it("rejects a wrong token_use", async () => {
    await expect(verifier().verify(await sign(key, idClaims), "access")).rejects.toThrow();
    await expect(verifier().verify(await sign(key, access), "id")).rejects.toThrow();
  });

  it("rejects an expired token", async () => {
    const token = await sign(key, access, { exp: now() - 60 });
    await expect(verifier().verify(token, "access")).rejects.toThrow();
  });

  it("refetches keys once when the signing key is unknown", async () => {
    const v = verifier();
    await v.verify(await sign(key, access), "access");
    expect(hits).toBe(1);

    const rotated = await newKey("key-b");
    served = [key.jwk, rotated.jwk];
    await v.verify(await sign(rotated, access), "access");
    expect(hits).toBe(2);

    const unknown = await newKey("key-c");
    await expect(v.verify(await sign(unknown, access), "access")).rejects.toThrow();
    expect(hits).toBe(3);
  });
});
