# Design

## Context

New library in an empty repository. Consumers are Node.js services that each have their own MongoDB and share one Cognito user pool. See proposal.md for motivation and the specs for behavior. Cognito tokens are too large for a cookie (4 KB limit), and Cognito's hosted login session already provides SSO across app clients.

## Goals / Non-Goals

**Goals:**
- One `createAuth(config)` call yields everything a service needs: routes, middleware, guards.
- Framework-agnostic core with a thin Express adapter.
- No state outside the service's own MongoDB.

**Non-Goals:**
- Custom login UI, username/password flows, or user management (sign-up, password reset); Cognito Hosted UI covers these.
- Social or SAML identity providers; configured in Cognito, no library change needed.
- Cross-app single logout propagation to other services' local sessions.
- Fastify/Koa adapters in v1.

## Decisions

**1. TypeScript source, published as compiled JS with type definitions (CommonJS + ESM).**
Gives consumers autocomplete on the config object, which supports the "easy to use" goal. Alternative: plain JS; rejected because config mistakes are easier to make without types.

**2. Cognito Hosted UI with authorization code + PKCE, implemented directly against Cognito's OAuth2 endpoints.**
Needs only a few HTTPS calls (`/oauth2/authorize`, `/oauth2/token`, `/logout`). Alternative: AWS Amplify or `openid-client`; rejected as heavier and adding frontend-oriented behavior we do not need.

**3. JWT verification with `jose` and the pool's JWKS.**
`jose` caches and refreshes remote keys and supports rotation. Alternative: `aws-jwt-verify`; viable, but `jose` is more general and has no AWS SDK footprint. Both access and ID tokens are checked for issuer, expiry, client, and `token_use`.

**4. Server-side sessions in MongoDB, opaque session ID in an HttpOnly cookie.**
Keeps the cookie small, allows revocation, and works across instances. A TTL index removes expired sessions. Alternatives: encrypted cookie holding tokens (exceeds size limits, cannot revoke) or in-memory sessions (breaks with multiple instances). Session documents store tokens encrypted at rest with a service-supplied key.

**5. Refresh happens lazily in the middleware, deduplicated per session.**
When the access token is within the refresh window, the first request calls Cognito and others await the same in-process promise. A conditional update on a session version field prevents two instances from both overwriting the session. Alternative: background timer; rejected as unnecessary and wasteful for idle sessions.

**6. SSO relies on a shared user pool and one app client per service.**
Cognito's own sign-in cookie lets service B skip the credentials prompt. Each service keeps an independent session and rejects tokens from other clients. Alternative: shared cookie domain; rejected because it ties services to a domain and couples sessions.

**7. Authorization is separate from authentication and defaults to a `userRoles` collection.**
Default document: `{ sub, roles: string[], permissions: string[] }`, indexed on `sub`. A service can pass `getAuthorization(user)` to replace it. Results are cached in memory for a short, configurable time. A failed lookup denies access (503) rather than assuming roles. Alternative: use Cognito groups as roles; they are exposed on `req.user.groups` but not used for guards, since services need independent role data.

**8. MongoDB driver is a peer dependency; the service passes its existing `Db`.**
Avoids version conflicts and duplicate connections.

**9. Public API shape:**
```js
const auth = createAuth({ cognito: { region, userPoolId, clientId, clientSecret?, domain, callbackUrl, logoutUrl }, db, session: { secret } });
app.use(auth.router());       // /auth/login, /auth/callback, /auth/logout, /auth/refresh
app.use(auth.middleware());   // session or Bearer token -> req.user
app.get('/admin', auth.requireRole('admin'), handler);
```
Defaults cover everything except Cognito settings, the `db`, and the session secret.

**10. Unauthenticated handling by request type.**
Requests that accept HTML are redirected to login; others get 401 JSON. CSRF is mitigated with SameSite cookies, the OAuth state parameter on login, and POST-only logout/refresh.

**11. Login state lives in a short-lived encrypted cookie.**
The OAuth state, PKCE verifier and return path are sealed (AES-256-GCM, same secret, separate derived key) into a 10-minute HttpOnly cookie, so no pending-login storage is needed. Return paths must be same-site relative paths. Alternative: pending-login documents in MongoDB; rejected as an extra collection and a write per login attempt.

## Risks / Trade-offs

- [Session store becomes a hard dependency on MongoDB] → Fail closed with a clear 503; bearer-token API calls still work without it.
- [Tokens stored in MongoDB] → Encrypt at rest, restrict collection access, and keep session TTL short.
- [Logout does not end other services' local sessions] → Keep session lifetime and refresh-token validity short, and document the behavior in the guide.
- [Role cache can serve stale roles] → Short default TTL and an explicit invalidate function.
- [Misconfigured Cognito callback/logout URLs are the most common failure] → Startup validation and a troubleshooting section in the guide.
- [Library upgrades affect all services] → Semantic versioning, a changelog, and no breaking config changes within a major version.

## Migration Plan

New, opt-in package, so there is nothing to migrate. Rollout: publish a pre-release, adopt in one pilot service, then document and roll out to the rest. Rollback is removing the middleware mount and reverting to the previous auth mechanism; session and role collections can be dropped safely.

## Open Questions

- Which internal npm registry and package scope will be used for publishing?
