import { describe, expect, it, vi } from "vitest";
import { createCognitoClient } from "../src/cognito-client";

const config = {
  region: "us-east-1",
  userPoolId: "us-east-1_AbC123",
  clientId: "client-1",
  domain: "https://d.example.com",
  callbackUrl: "https://app.example.com/auth/callback",
  logoutUrl: "https://app.example.com/",
};

const tokenBody = { access_token: "acc", id_token: "idt", refresh_token: "ref", expires_in: 3600 };
const fakeFetch = (body: unknown = tokenBody, status = 200) =>
  vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify(body), { status }));

const sent = (fetchFn: ReturnType<typeof fakeFetch>) => {
  const [url, init] = fetchFn.mock.calls[0];
  return { url: String(url), init: init!, form: new URLSearchParams(String(init!.body)) };
};

describe("authorizeUrl", () => {
  it("builds an authorization code + PKCE URL", () => {
    const url = new URL(createCognitoClient(config).authorizeUrl({ state: "st", codeChallenge: "cc" }));
    expect(url.origin + url.pathname).toBe("https://d.example.com/oauth2/authorize");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      response_type: "code",
      client_id: "client-1",
      redirect_uri: config.callbackUrl,
      state: "st",
      code_challenge: "cc",
      code_challenge_method: "S256",
    });
    expect(url.searchParams.get("scope")).toContain("openid");
  });
});

describe("exchangeCode", () => {
  it("posts the code and verifier to the token endpoint and returns the tokens", async () => {
    const fetchFn = fakeFetch();
    const result = await createCognitoClient(config, fetchFn).exchangeCode("the-code", "the-verifier");
    const { url, init, form } = sent(fetchFn);
    expect(url).toBe("https://d.example.com/oauth2/token");
    expect(init.method).toBe("POST");
    expect(Object.fromEntries(form)).toEqual({
      grant_type: "authorization_code",
      client_id: "client-1",
      code: "the-code",
      redirect_uri: config.callbackUrl,
      code_verifier: "the-verifier",
    });
    expect(new Headers(init.headers).has("authorization")).toBe(false);
    expect(result).toEqual({ accessToken: "acc", idToken: "idt", refreshToken: "ref", expiresIn: 3600 });
  });

  it("authenticates with Basic auth when a client secret is configured", async () => {
    const fetchFn = fakeFetch();
    await createCognitoClient({ ...config, clientSecret: "shh" }, fetchFn).exchangeCode("c", "v");
    const expected = `Basic ${Buffer.from("client-1:shh").toString("base64")}`;
    expect(new Headers(sent(fetchFn).init.headers).get("authorization")).toBe(expected);
  });

  it("throws without exposing the response body when Cognito rejects the request", async () => {
    const client = createCognitoClient(config, fakeFetch({ error: "invalid_grant", detail: "internal detail" }, 400));
    await expect(client.exchangeCode("c", "v")).rejects.toThrow(/400/);
    await expect(client.exchangeCode("c", "v")).rejects.not.toThrow(/internal detail/);
  });
});

describe("refreshTokens", () => {
  it("posts the refresh token and returns the new tokens", async () => {
    const fetchFn = fakeFetch({ access_token: "acc2", id_token: "id2", expires_in: 1800 });
    const result = await createCognitoClient(config, fetchFn).refreshTokens("ref");
    expect(Object.fromEntries(sent(fetchFn).form)).toEqual({
      grant_type: "refresh_token",
      client_id: "client-1",
      refresh_token: "ref",
    });
    expect(result).toEqual({ accessToken: "acc2", idToken: "id2", expiresIn: 1800 });
  });
});

describe("logoutUrl", () => {
  it("points at the Cognito logout endpoint with the post-logout URL", () => {
    const url = new URL(createCognitoClient(config).logoutUrl());
    expect(url.origin + url.pathname).toBe("https://d.example.com/logout");
    expect(url.searchParams.get("client_id")).toBe("client-1");
    expect(url.searchParams.get("logout_uri")).toBe(config.logoutUrl);
  });
});
