import type { CognitoConfig } from "./config";

export interface CognitoTokens {
  accessToken: string;
  idToken: string;
  refreshToken?: string;
  expiresIn: number;
}

export function createCognitoClient(cognito: CognitoConfig, fetchFn: typeof fetch = fetch) {
  async function tokenRequest(params: Record<string, string>): Promise<CognitoTokens> {
    const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" };
    if (cognito.clientSecret) {
      headers.authorization = `Basic ${Buffer.from(`${cognito.clientId}:${cognito.clientSecret}`).toString("base64")}`;
    }
    const response = await fetchFn(`${cognito.domain}/oauth2/token`, {
      method: "POST",
      headers,
      body: new URLSearchParams({ ...params, client_id: cognito.clientId }),
    });
    // Status only: the response body may contain details that must not reach users or logs.
    if (!response.ok) throw new Error(`Cognito token request failed (${response.status})`);
    const body = (await response.json()) as Record<string, string | number | undefined>;
    return {
      accessToken: String(body.access_token),
      idToken: String(body.id_token),
      ...(body.refresh_token !== undefined && { refreshToken: String(body.refresh_token) }),
      expiresIn: Number(body.expires_in),
    };
  }

  return {
    authorizeUrl({ state, codeChallenge }: { state: string; codeChallenge: string }) {
      const query = new URLSearchParams({
        response_type: "code",
        client_id: cognito.clientId,
        redirect_uri: cognito.callbackUrl,
        scope: "openid email profile",
        state,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
      });
      return `${cognito.domain}/oauth2/authorize?${query}`;
    },

    exchangeCode: (code: string, codeVerifier: string) =>
      tokenRequest({
        grant_type: "authorization_code",
        code,
        redirect_uri: cognito.callbackUrl,
        code_verifier: codeVerifier,
      }),

    refreshTokens: (refreshToken: string) =>
      tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken }),

    logoutUrl() {
      return `${cognito.domain}/logout?${new URLSearchParams({ client_id: cognito.clientId, logout_uri: cognito.logoutUrl })}`;
    },
  };
}

export type CognitoClient = ReturnType<typeof createCognitoClient>;
