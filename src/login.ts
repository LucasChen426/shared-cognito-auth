import { createHash, randomBytes } from "node:crypto";
import type { CognitoClient } from "./cognito-client";
import type { ResolvedConfig } from "./config";
import { createSealer } from "./crypto";
import { serializeSessionCookie, type SessionStore } from "./session";
import type { TokenVerifier } from "./verifier";

export interface FlowResult {
  status: number;
  location?: string;
  cookies: string[];
  body?: string;
}

export interface LoginFlowOptions {
  config: ResolvedConfig;
  cognito: Pick<CognitoClient, "authorizeUrl" | "exchangeCode" | "logoutUrl">;
  verifier: TokenVerifier;
  store: SessionStore;
  now?: () => number;
}

interface PendingLogin {
  state: string;
  verifier: string;
  returnTo: string;
  exp: number;
}

const LOGIN_COOKIE = "auth_login";
const LOGIN_TTL_SECONDS = 600;

// Only same-site paths: a leading "//" or "/\" would be read by browsers as another host.
const safeReturnTo = (value?: string) => (value && /^\/(?![/\\])/.test(value) ? value : "/");

export function createLoginFlow({ config, cognito, verifier, store, now = Date.now }: LoginFlowOptions) {
  const sealer = createSealer(config.session.secret, "login-state");
  const secure = process.env.NODE_ENV === "production";
  const clearLoginCookie = serializeSessionCookie(LOGIN_COOKIE, "", { maxAgeSeconds: 0, secure });
  const rejected = (): FlowResult => ({ status: 400, cookies: [clearLoginCookie], body: "Login failed" });

  return {
    async login({ returnTo }: { returnTo?: string }): Promise<FlowResult> {
      const state = randomBytes(16).toString("base64url");
      const codeVerifier = randomBytes(32).toString("base64url");
      const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
      const pending: PendingLogin = {
        state,
        verifier: codeVerifier,
        returnTo: safeReturnTo(returnTo),
        exp: now() + LOGIN_TTL_SECONDS * 1000,
      };
      return {
        status: 302,
        location: cognito.authorizeUrl({ state, codeChallenge }),
        cookies: [serializeSessionCookie(LOGIN_COOKIE, sealer.seal(pending), { maxAgeSeconds: LOGIN_TTL_SECONDS, secure })],
      };
    },

    async callback({ query, cookies }: {
      query: { code?: string; state?: string; error?: string; error_description?: string };
      cookies: Record<string, string>;
    }): Promise<FlowResult> {
      const pending = sealer.open<PendingLogin>(cookies[LOGIN_COOKIE] ?? "");
      if (query.error || !query.code || !pending || query.state !== pending.state || pending.exp <= now()) {
        return rejected();
      }
      try {
        const tokens = await cognito.exchangeCode(query.code, pending.verifier);
        const idClaims = await verifier.verify(tokens.idToken, "id");
        await verifier.verify(tokens.accessToken, "access");
        if (!tokens.refreshToken) throw new Error("No refresh token returned");
        const { id } = await store.create({
          sub: String(idClaims.sub),
          accessToken: tokens.accessToken,
          idToken: tokens.idToken,
          refreshToken: tokens.refreshToken,
          accessExpiresAt: now() + tokens.expiresIn * 1000,
        });
        const sessionCookie = serializeSessionCookie(config.cookieName, id, { maxAgeSeconds: config.sessionTtlSeconds, secure });
        return { status: 302, location: pending.returnTo, cookies: [clearLoginCookie, sessionCookie] };
      } catch {
        return rejected();
      }
    },

    // Always ends the Cognito sign-in too, so SSO does not silently sign the user back in.
    async logout({ cookies }: { cookies: Record<string, string> }): Promise<FlowResult> {
      const sid = cookies[config.cookieName];
      if (sid) await store.destroy(sid);
      return {
        status: 302,
        location: cognito.logoutUrl(),
        cookies: [serializeSessionCookie(config.cookieName, "", { maxAgeSeconds: 0, secure })],
      };
    },
  };
}
