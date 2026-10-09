# Tasks

## 1. Project Setup

- [x] 1.1 Scaffold the TypeScript package (`package.json`, `tsconfig.json`, `src/`, `test/`) with CommonJS and ESM builds, and verify `npm run build` emits both outputs and type definitions
- [x] 1.2 Add dependencies (`jose`; `mongodb` and `express` as peer dependencies) and dev tooling (test runner, `mongodb-memory-server`, lint), and verify `npm install` and `npm test` run with an empty suite
- [x] 1.3 Set `engines` to the confirmed Node LTS range and verify installing on an unsupported version warns

## 2. Configuration (auth-lib-integration)

- [x] 2.1 Write tests for config validation: every missing or invalid required setting is named in one error, defaults apply, and secrets never appear in messages
- [x] 2.2 Implement the config schema, defaults, and `createAuth(config)` entry point, and verify the 2.1 tests pass

## 3. Token Verification (token-session-management)

- [x] 3.1 Write tests for token verification: valid token, bad signature, wrong issuer, wrong client, wrong `token_use`, expired, and unknown signing key refetched once
- [x] 3.2 Implement the JWKS-based verifier and verify the 3.1 tests pass
- [x] 3.3 Write tests for Bearer header handling (valid, malformed, invalid) and implement it, verifying a 401 with no session created on failure

## 4. Sessions and Refresh (token-session-management)

- [x] 4.1 Write tests for the MongoDB session store: cookie attributes, tokens encrypted at rest, restart persistence, and TTL expiry
- [x] 4.2 Implement the session store and cookie handling, and verify the 4.1 tests pass
- [x] 4.3 Write tests for refresh: near-expiry refresh, concurrent requests produce one Cognito call, multi-instance conflict handled, failed refresh destroys the session
- [x] 4.4 Implement lazy refresh and the explicit refresh route, and verify the 4.3 tests pass

## 5. Login Flow (cognito-authentication, cross-app-sso)

- [x] 5.1 Write tests against a stubbed Cognito for login redirect with PKCE and state, return path preserved, callback success, state mismatch, and Cognito error
- [x] 5.2 Implement the login and callback routes, and verify the 5.1 tests pass
- [x] 5.3 Write tests for logout (with and without a session) and rejection of tokens issued for another app client
- [x] 5.4 Implement logout and the app client check, and verify the 5.3 tests pass
- [x] 5.5 Implement the authentication middleware (`req.user`, redirect for browsers, 401 for APIs) and verify tests for both response types pass

## 6. Authorization (mongo-authorization)

- [x] 6.1 Write tests for the default `userRoles` lookup, user with no record, custom lookup override, and lookup failure returning 503
- [x] 6.2 Implement role and permission resolution and verify the 6.1 tests pass
- [x] 6.3 Write tests for `requireRole` and `requirePermission` (allow, 403, 401 or redirect when unauthenticated) and implement them
- [x] 6.4 Write tests for the role cache and cache invalidation, implement it, and verify the tests pass

## 7. Express Adapter and Integration

- [x] 7.1 Implement `auth.router()` and `auth.middleware()` with a configurable route prefix, including the explicit refresh route (200 with a session, 401 without) built on `refresh()` from 4.4, and verify a test that mounts under a custom prefix serves all four routes
- [x] 7.2 Add an end-to-end test (stub Cognito, in-memory MongoDB) covering login, protected route, role-guarded route, refresh, and logout

## 8. Documentation and Example

- [x] 8.1 Build the example app in `examples/express-app` and verify it starts and serves the public route, protects `/me` and `/admin` (401 or redirect), redirects login to the Cognito authorize URL, and rejects GET logout (a full login against a real Cognito pool is a manual step; test 7.2 covers the flow against a fake Cognito)
- [x] 8.2 Write the developer guide in `docs/guide.md` (install, Cognito setup, configuration reference, MongoDB roles schema, quick-start, SSO across services, troubleshooting) and verify its quick-start runs as written
- [x] 8.3 Write the package `readme.md` with a short quick-start linking to the guide, and verify links resolve

## 9. Release Readiness

- [x] 9.1 Verify `npm pack` contains only built output, types, and docs, and that installing the tarball into a clean project and importing it works
- [x] 9.2 Verify the full suite passes in CI (workflow added at `.github/workflows/ci.yml`; its steps were run locally) and the change passes `openspec validate shared-cognito-auth-lib --strict`

## Workflow follow-up

- Publish a pre-release to the internal npm registry once the registry and scope are confirmed.
- Adopt in one pilot service before wider rollout.
- Archive the change after review requirements are satisfied.
