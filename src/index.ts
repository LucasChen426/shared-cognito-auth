import { createAuthorizationResolver } from "./authorization";
import { createCognitoClient, type CognitoClient } from "./cognito-client";
import { resolveConfig, type AuthConfig } from "./config";
import { createGuards } from "./guards";
import { createLoginFlow } from "./login";
import { createAuthMiddleware } from "./middleware";
import { createRefresher } from "./refresh";
import { createRouter } from "./router";
import { createSessionStore } from "./session";
import { createTokenVerifier, type TokenVerifier } from "./verifier";

export type { AuthConfig, CognitoConfig, ResolvedConfig } from "./config";
export type { AuthUser } from "./bearer";
export type { Authorization, AuthorizationLookup } from "./authorization";

export interface AuthOverrides {
  cognito?: CognitoClient;
  verifier?: TokenVerifier;
}

export function createAuth(config: AuthConfig, overrides: AuthOverrides = {}) {
  const resolved = resolveConfig(config);
  const cognito = overrides.cognito ?? createCognitoClient(resolved.cognito);
  const verifier = overrides.verifier ?? createTokenVerifier(resolved.cognito);

  const store = createSessionStore({
    db: resolved.db,
    collection: resolved.sessionsCollection,
    secret: resolved.session.secret,
    ttlSeconds: resolved.sessionTtlSeconds,
  });
  const refresher = createRefresher({ store, cognito, refreshWindowSeconds: resolved.refreshWindowSeconds });
  const flow = createLoginFlow({ config: resolved, cognito, verifier, store });
  const authorization = createAuthorizationResolver({
    db: resolved.db,
    collection: resolved.rolesCollection,
    getAuthorization: resolved.getAuthorization,
    cacheTtlSeconds: resolved.roleCacheTtlSeconds,
  });
  const guards = createGuards({ authorization, routePrefix: resolved.routePrefix });

  // Creates the TTL index in the background; a failure only delays cleanup of expired sessions.
  const ready = store.init();
  ready.catch(() => undefined);

  return {
    config: resolved,
    init: () => ready,
    router: () => createRouter({ config: resolved, flow, store, refresher }),
    middleware: (options?: { optional?: boolean }) =>
      createAuthMiddleware({ store, refresher, verifier, config: resolved }, options),
    requireRole: guards.requireRole,
    requirePermission: guards.requirePermission,
    invalidateRoles: authorization.invalidate,
  };
}
