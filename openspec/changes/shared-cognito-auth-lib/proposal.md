# Proposal

## Why

Each of our Node services currently has to build its own login, token handling and session logic, which leads to duplicated effort, inconsistent security behavior, and no single sign-on across applications. A shared library backed by AWS Cognito gives every application one identity and SSO experience, while each service keeps ownership of its own authorization data (roles and permissions) in its own MongoDB.

## What Changes

- Add a reusable, npm-installable Node.js library (`shared-cognito-auth-lib`) that wraps AWS Cognito for authentication.
- Handle the full authentication lifecycle: login (Cognito Hosted UI / OAuth2 authorization code with PKCE), callback handling, logout, and token refresh.
- Provide SSO across multiple applications by sharing one Cognito user pool (one app client per service), so signing in to one app signs the user in to the others without a new password prompt.
- Provide drop-in middleware (Express-compatible) that verifies Cognito JWTs and attaches the authenticated user to the request.
- Provide a pluggable authorization layer that loads roles and permissions from each service's own MongoDB, with route guards such as `requireRole` and `requirePermission`.
- Expose a minimal setup API so a service can integrate with a single config object and a few lines of code.
- Ship a developer guide covering installation, configuration, Cognito setup, MongoDB role schema, SSO setup, and troubleshooting, plus a runnable example app.

## Capabilities

### New Capabilities

- `cognito-authentication`: Login, callback, logout and user identity retrieval through AWS Cognito (OAuth2 authorization code with PKCE).
- `token-session-management`: Token verification (JWKS), secure cookie/session storage, and automatic and explicit token refresh.
- `cross-app-sso`: Single sign-on and single logout across multiple applications that share the same Cognito user pool.
- `mongo-authorization`: Per-service role and permission resolution from the service's own MongoDB, and route-level authorization guards.
- `auth-lib-integration`: The public API, configuration schema and developer guidance that let a service adopt the library with minimal code.

### Modified Capabilities

None. There are no existing specs.

## Impact

- **New package:** an npm library in this repository, published to the internal registry (registry and versioning scheme to be confirmed in design).
- **Dependencies:** AWS Cognito (user pool, app clients, hosted domain), `mongodb` driver (peer dependency), and a JWT/JWKS verification library.
- **Consuming services:** each service installs the package, supplies its Cognito config and MongoDB connection, and mounts the middleware. No breaking change to existing services, since adoption is opt-in.
- **Infrastructure:** one shared Cognito user pool, one app client per service, and allowed callback and logout URLs.
- **Docs:** integration guide and example app in this repo.
