import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import type { CognitoConfig } from "./config";

export type TokenUse = "access" | "id";

export interface TokenVerifier {
  verify(token: string, use: TokenUse): Promise<JWTPayload>;
}

export interface VerifierOptions {
  jwksUri?: string;
  jwksCooldownMs?: number;
}

export function createTokenVerifier(cognito: CognitoConfig, options: VerifierOptions = {}): TokenVerifier {
  const issuer = `https://cognito-idp.${cognito.region}.amazonaws.com/${cognito.userPoolId}`;
  const jwks = createRemoteJWKSet(new URL(options.jwksUri ?? `${issuer}/.well-known/jwks.json`), {
    ...(options.jwksCooldownMs !== undefined && { cooldownDuration: options.jwksCooldownMs }),
  });

  return {
    async verify(token, use) {
      const { payload } = await jwtVerify(token, jwks, {
        issuer,
        algorithms: ["RS256"],
        // Cognito access tokens carry client_id instead of aud.
        ...(use === "id" && { audience: cognito.clientId }),
      });
      if (payload.token_use !== use) throw new Error(`Expected a ${use} token`);
      if (use === "access" && payload.client_id !== cognito.clientId) {
        throw new Error("Token was issued for a different app client");
      }
      return payload;
    },
  };
}
