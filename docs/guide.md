# Cognito Auth Library Guide

`shared-cognito-auth-lib` gives a Node.js service sign-in, single sign-on (SSO), token refresh and role-based access control with a few lines of code. Sign-in is handled by AWS Cognito. Roles and permissions stay in **your service's own MongoDB**.

## What you get

- Login, callback, logout and token refresh routes, ready to mount.
- A middleware that authenticates browser sessions and `Authorization: Bearer` API calls.
- `requireRole` and `requirePermission` route guards.
- SSO: users who signed in to one service are not asked for a password in another service that shares the same user pool.

Your service never sees a password and never stores a Cognito token in the browser.

## Install

```bash
npm install shared-cognito-auth-lib mongodb express
```

Requires Node.js 22 or later. `mongodb` (v6 or later) is a peer dependency, and you pass in your existing database handle. `express` is only needed if you use Express.

## 1. Set up Cognito

Do this once per environment.

1. Use one **user pool** for all services that should share SSO.
2. Add a **Cognito domain** (App integration > Domain), for example `mycompany.auth.us-east-1.amazoncognito.com`.
3. Create **one app client per service** (App integration > App clients):
   - Grant type: **Authorization code grant**.
   - Scopes: `openid`, `email`, `profile`.
   - Allowed callback URL: `https://<your-service>/auth/callback`.
   - Allowed sign-out URL: where users should land after logout, for example `https://<your-service>/`.
   - A client secret is optional. If you create one, pass it as `clientSecret`.
4. Note the region, user pool ID (`us-east-1_XXXXXXXXX`), app client ID, and domain.

If you change the route prefix (see below), the callback URL changes to `<prefix>/callback`.

## 2. Quick start

```js
import express from "express";
import { MongoClient } from "mongodb";
import { createAuth } from "shared-cognito-auth-lib";

const mongo = await MongoClient.connect(process.env.MONGODB_URI);

const auth = createAuth({
  cognito: {
    region: "us-east-1",
    userPoolId: "us-east-1_XXXXXXXXX",
    clientId: "your-app-client-id",
    domain: "mycompany.auth.us-east-1.amazoncognito.com",
    callbackUrl: "https://app.example.com/auth/callback",
    logoutUrl: "https://app.example.com/",
  },
  db: mongo.db("myservice"),
  session: { secret: process.env.SESSION_SECRET }, // at least 32 random characters
});

const app = express();

app.use(auth.router());                  // /auth/login, /auth/callback, /auth/logout, /auth/refresh
app.get("/", (req, res) => res.send("public"));

app.use(auth.middleware());              // everything below requires sign-in
app.get("/me", (req, res) => res.json(req.user));
app.get("/admin", auth.requireRole("admin"), (req, res) => res.send("admin"));

app.listen(3000);
```

A runnable version is in [`examples/express-app`](../examples/express-app). Copy `.env.example` to `.env`, fill it in, build the library with `npm run build`, then run `npm run example`.

**Order matters.** Routes mounted before `auth.middleware()` are public. Routes mounted after it require sign-in. Mount `auth.router()` at the application root, before the middleware.

## Routes

| Route | Method | Purpose |
|---|---|---|
| `/auth/login?returnTo=/page` | GET | Starts sign-in. `returnTo` must be a path on your site; anything else is ignored and the user goes to `/`. |
| `/auth/callback` | GET | Cognito sends the user back here. Creates the session. |
| `/auth/logout` | POST | Ends the session and the Cognito sign-in. Use a form or `fetch`, not a link. |
| `/auth/refresh` | POST | Renews tokens on demand. 200 with a session, 401 without. |

A wrong method returns 405. Tokens refresh automatically on normal requests, so most services never call `/auth/refresh`.

## The signed-in user

After the middleware runs, `req.user` is:

```js
{ sub, username?, email?, name?, groups: [] }
```

`sub` is the Cognito user ID and is identical in every service, so use it to link your own data. `groups` are the user's Cognito groups. TypeScript users can import the `AuthUser` type.

### What unauthenticated requests get

- Browsers (`Accept: text/html`): redirected to `/auth/login` and returned to the page they asked for.
- Everything else (APIs, `fetch`): `401` with `{ "error": "unauthenticated" }`.

Use `auth.middleware({ optional: true })` on pages that work for both signed-in and anonymous users. It fills in `req.user` when there is one and never redirects.

### API clients

A request with `Authorization: Bearer <Cognito access token>` is verified and handled without a session. An invalid token returns `401`, even if a session cookie is also present.

## Roles and permissions (your MongoDB)

Cognito answers "who is this?". Your MongoDB answers "what may they do?". By default the library reads the `userRoles` collection:

```js
// One document per user, keyed by the Cognito sub
{ sub: "5a1b...-...", roles: ["admin", "editor"], permissions: ["reports:read"] }
```

```js
await db.collection("userRoles").createIndex({ sub: 1 }, { unique: true });
await db.collection("userRoles").insertOne({ sub, roles: ["admin"], permissions: [] });
```

A user with no document has no roles and no permissions. Missing fields count as empty.

### Guards

```js
app.get("/admin", auth.requireRole("admin", "owner"), handler);            // any one of these roles
app.get("/export", auth.requirePermission("reports:read", "data:export"), handler); // all of these permissions
```

| Situation | Response |
|---|---|
| Not signed in | 401, or a redirect to login for browsers |
| Signed in but missing the role or permission | 403 |
| Role lookup failed (database down) | 503. Access is denied, never assumed. |

Inside a guarded route, `req.authorization` holds `{ roles, permissions }`.

### Your own schema

If roles live elsewhere in your data model, supply a lookup. It receives the Cognito `sub` and returns roles and permissions (or `null`):

```js
createAuth({
  // ...
  getAuthorization: async (sub) => {
    const account = await db.collection("accounts").findOne({ cognitoSub: sub });
    return account && { roles: account.roles, permissions: account.perms };
  },
});
```

### Caching

Results are cached in memory for `roleCacheTtlSeconds` (default 60). After you change a user's roles, call `auth.invalidateRoles(sub)` so the change applies immediately on that instance. Other instances pick it up when their cache expires. Set `roleCacheTtlSeconds: 1` if you need faster propagation.

## Single sign-on across services

1. All services use the **same user pool**.
2. Each service has its **own app client** and its own callback URL.
3. Each service installs this library with its own config.

When a user signed in to service A opens service B, B sends them to Cognito. Cognito already knows them, so it returns immediately and B creates its own session. There is no second password prompt.

Things to know:

- Sessions are independent. Expiry in A does not affect B.
- Logging out of A ends the Cognito sign-in, so the next unauthenticated visit to any service asks for a password. Services that already have a valid local session stay signed in until that session ends, so keep `sessionTtlSeconds` moderate.
- A token issued for service A's app client is rejected by service B.

## Configuration reference

| Option | Required | Default | Notes |
|---|---|---|---|
| `cognito.region` | yes | | For example `us-east-1` |
| `cognito.userPoolId` | yes | | `us-east-1_XXXXXXXXX` |
| `cognito.clientId` | yes | | This service's app client |
| `cognito.clientSecret` | no | | Only if the app client has a secret |
| `cognito.domain` | yes | | Cognito domain; `https://` is added if missing |
| `cognito.callbackUrl` | yes | | Must match the app client exactly |
| `cognito.logoutUrl` | yes | | Must be in the app client's sign-out URLs |
| `db` | yes | | A MongoDB `Db` handle |
| `session.secret` | yes | | 32+ characters. Encrypts stored tokens. |
| `routePrefix` | no | `/auth` | Must start with `/`, no trailing `/` |
| `cookieName` | no | `auth_sid` | Session cookie name |
| `sessionTtlSeconds` | no | `28800` (8h) | Fixed from login, not extended by activity |
| `refreshWindowSeconds` | no | `300` | Refresh when the access token has less time left |
| `sessionsCollection` | no | `authSessions` | |
| `rolesCollection` | no | `userRoles` | |
| `roleCacheTtlSeconds` | no | `60` | `0` disables caching |
| `getAuthorization` | no | | Custom role lookup |

Configuration is checked when `createAuth` runs. The error lists every missing or invalid setting by name and never prints secret values.

`createAuth` also creates a TTL index on the sessions collection in the background. `await auth.init()` if you want to surface a failure at startup.

## Security notes

- The session cookie is `HttpOnly` and `SameSite=Lax`, and it carries only a random ID. It is `Secure` when `NODE_ENV=production`.
- Cognito tokens are stored in your MongoDB, encrypted with AES-256-GCM using a key derived from `session.secret`. Treat that secret like a database password.
- **Changing `session.secret` signs everyone out.** Run all instances of a service with the same secret.
- Sessions live in MongoDB, so they work across multiple instances and restarts. If MongoDB is down, session requests fail; Bearer API requests still work.
- Login uses the authorization code flow with PKCE and a state check.
- Logout and refresh accept POST only.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Cognito page shows `redirect_mismatch` | `callbackUrl` does not exactly match an allowed callback URL on the app client, including scheme, host, port and path. |
| Cognito page shows `invalid_scope` or `unauthorized_client` | The app client needs the authorization code grant and the `openid email profile` scopes. |
| Callback returns `400 Login failed` | The state check failed. Common causes: the login cookie was blocked, the user started login on a different hostname than the callback, the page sat open for more than 10 minutes, or the client secret or domain is wrong. |
| Sign-in works locally but not behind HTTPS | Check that `callbackUrl` uses the public `https://` URL. |
| Session cookie is not set on plain `http://` | Expected only when `NODE_ENV=production`, since the cookie is then `Secure`. Use HTTPS or a non-production environment locally. |
| Everyone was signed out after a deploy | `session.secret` changed or differs between instances. |
| `401` for a Bearer token | Wrong token type (use the **access** token), wrong app client, expired, or from another user pool. |
| `503 authorization_unavailable` | Your role lookup threw, usually because MongoDB is unreachable. |
| `405` on `/auth/logout` | Logout is POST-only. Use a form or `fetch(..., { method: "POST" })`. |
| `Invalid auth configuration: ...` at startup | The message names each missing or invalid setting. |
| `EBADENGINE` warning on install | Upgrade to Node.js 22 or later. |
| A guard always returns 403 | The user has no `userRoles` document, or `sub` in the document does not match the Cognito `sub` (not the username or email). |
