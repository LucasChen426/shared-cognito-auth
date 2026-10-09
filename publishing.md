# Publishing and end-to-end testing

How to publish `shared-cognito-auth-lib` to the public npm registry, which credentials are needed, and how to test it end to end before and after release.

## 1. Decide before the first publish

Publishing to public npm is effectively permanent: a version number can never be reused, and unpublishing is restricted (generally only within 72 hours and only if nothing depends on it). Check these first.

| Item | Current state | Action |
|---|---|---|
| Company approval | | Confirm you may open-source this code. It is currently an internal library. |
| Package name | `shared-cognito-auth-lib` is unclaimed (checked with `npm view`) | Publish soon, or use a scope such as `@your-org/cognito-auth` to avoid squatting. |
| `license` | `UNLICENSED` | Set a real license (for example `MIT` or `Apache-2.0`) and add a `LICENSE` file. `UNLICENSED` on a public package is contradictory. |
| `version` | `0.0.0` | Start at `0.1.0`. |
| `repository`, `homepage`, `bugs`, `keywords` | missing | Add them. The npm page uses them, and provenance requires `repository`. |
| `private` | not set (good) | Do not set `"private": true`, or npm refuses to publish. |
| Readme links | `docs/guide.md` ships in the package, but `examples/` does not | On npm the example link would be dead. Use absolute repository URLs for the example link. |

```bash
npm pkg set version=0.1.0 license=MIT
npm pkg set repository.type=git repository.url="git+https://github.com/<org>/<repo>.git"
npm pkg set homepage="https://github.com/<org>/<repo>#readme" bugs.url="https://github.com/<org>/<repo>/issues"
npm pkg set publishConfig.access=public
```

`publishConfig.access=public` is required only for **scoped** names (`@org/name`), which default to private.

What gets published is controlled by the `files` list in `package.json`: `dist/`, `docs/guide.md` (via `docs`), `readme.md`, plus `package.json` itself. Tests, source, `openspec/`, `.github/` and this file are not included. `prepack` runs `npm run build` automatically, so `dist/` is never stale.

## 2. Credentials you need

Publishing needs **npm credentials only**. No AWS or MongoDB credentials are needed to publish.

| What | Where it comes from | Used for |
|---|---|---|
| npm account | Create at npmjs.com | Owns the package |
| **Two-factor authentication** on that account | npm profile > Two-Factor Authentication | npm requires 2FA for publishing |
| Publish permission on the package | You, as owner or a maintainer. For a scope: owner of the npm org | Allows `npm publish` |
| Login session (manual publish) | `npm login` | Interactive publishing from your machine |
| CI credential (automated publish), either: | | |
| a) **Trusted publishing (OIDC)**: recommended | Package settings on npmjs.com > Trusted Publisher > GitHub Actions: org/user, repository, workflow file name | No stored secret at all. Also adds provenance. |
| b) **Granular access token** | npm > Access Tokens > Generate New Token > Granular: read and write, limited to this package. Store it as the GitHub secret `NPM_TOKEN`. | Works from any CI. Tokens expire, so plan to rotate them. Check npm's current maximum token lifetime. |

Notes:

- The first publish creates the package, so it must be done manually or with a token. Trusted publishing can only be configured once the package exists.
- Keep tokens out of the repo. Never commit `.npmrc` files that contain `_authToken`.
- Check who you are with `npm whoami`.

## 3. Publish manually

```bash
# 1. Make sure everything is green
npm ci
npm run typecheck && npm run lint && npm test

# 2. Log in (opens the browser for web login and 2FA)
npm login
npm whoami

# 3. Inspect exactly what will be uploaded. Nothing is published.
npm publish --dry-run

# 4. Publish. Scoped names also need --access public (or publishConfig).
npm publish
#   if prompted for a one-time code:  npm publish --otp=123456
```

Release a later version with `npm version patch` (or `minor` or `major`), then `git push --follow-tags`, then `npm publish`. For a pre-release use `npm version prerelease --preid=beta` and `npm publish --tag beta`, so `latest` is not affected.

## 4. Publish from CI (optional)

Create `.github/workflows/release.yml` and publish by pushing a tag such as `v0.1.0`:

```yaml
name: Release
on:
  push:
    tags: ["v*"]

permissions:
  contents: read
  id-token: write        # required for trusted publishing and provenance

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          registry-url: https://registry.npmjs.org
      - run: npm ci
      - run: npm run typecheck && npm run lint && npm test
      - run: npm publish --access public
        # With a token instead of trusted publishing, add:
        # env:
        #   NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

Trusted publishing needs a recent npm CLI (11.5.1 or later), which Node 24 includes. The workflow file name in the npm trusted-publisher settings must match exactly (`release.yml`).

## 5. Verify after publishing

```bash
npm view shared-cognito-auth-lib version dist.tarball
mkdir /tmp/verify && cd /tmp/verify && npm init -y
npm install shared-cognito-auth-lib mongodb express
node --input-type=module -e "import('shared-cognito-auth-lib').then(m => console.log(Object.keys(m)))"
```

If something is wrong, do not unpublish. Publish a fixed patch version, and use `npm deprecate shared-cognito-auth-lib@0.1.0 "use 0.1.1"` for the broken one.

## 6. End-to-end testing

There are three layers. Use all three before a release.

### Layer 1: automated end-to-end test (no AWS needed)

[test/e2e.test.ts](test/e2e.test.ts) runs the real library inside a real Express app against an in-memory MongoDB and a **fake Cognito** server that issues genuinely signed tokens (authorize, token, JWKS, logout). It covers public vs protected routes, login with return path, role and permission guards, automatic and explicit refresh, Bearer tokens, and logout.

```bash
npx vitest run test/e2e.test.ts     # just this test
npm test                            # everything
```

The first run downloads a `mongod` binary (cached afterwards). This layer proves the library's own logic. It cannot prove that your real Cognito pool is configured correctly.

### Layer 2: manual end-to-end test against a real Cognito pool

Use a **test** user pool, not production. You need the AWS CLI with permission for `cognito-idp:*` on that pool. These are AWS credentials for testing only; publishing does not need them.

1. **Cognito setup** (see the [guide](docs/guide.md#1-set-up-cognito)): a pool, a domain, and an app client with the authorization code grant and scopes `openid email profile`. Add the callback URL `http://localhost:3000/auth/callback` and the sign-out URL `http://localhost:3000/`. Cognito allows plain `http://localhost`.

2. **Create a test user** and note its `sub`:

   ```bash
   POOL=us-east-1_XXXXXXXXX
   aws cognito-idp admin-create-user --user-pool-id $POOL --username jo@example.com \
     --user-attributes Name=email,Value=jo@example.com Name=email_verified,Value=true --message-action SUPPRESS
   aws cognito-idp admin-set-user-password --user-pool-id $POOL --username jo@example.com \
     --password '<a strong password>' --permanent
   aws cognito-idp admin-get-user --user-pool-id $POOL --username jo@example.com \
     --query "UserAttributes[?Name=='sub'].Value" --output text
   ```

3. **Start MongoDB and give the user a role:**

   ```bash
   docker run -d --name auth-mongo -p 27017:27017 mongo:7
   mongosh "mongodb://localhost:27017/auth-example" --eval \
     'db.userRoles.insertOne({ sub: "<the sub>", roles: ["admin"], permissions: [] })'
   ```

4. **Configure and run the example app:**

   ```bash
   cp example.env examples/express-app/.env     # fill in the Cognito values and SESSION_SECRET
   npm run build
   npm run example
   ```

5. **Walk through the checklist** in a browser at `http://localhost:3000`:

   | Step | Expected |
   |---|---|
   | Open `/` | Public page loads |
   | Open `/me` while signed out | Redirected to the Cognito sign-in page |
   | Sign in with the test user | Returned to `/me`, which shows `sub`, `email`, `groups` |
   | Open `/admin` | "Welcome, admin ..." because the role exists |
   | Remove the role (`db.userRoles.deleteMany({})`), wait 60 seconds or restart, reload `/admin` | 403 |
   | Click Log out on `/` | Redirected to `/`. `/me` asks you to sign in again with the Cognito password prompt, not silently signed in. |
   | `curl -i localhost:3000/me -H 'Accept: application/json'` | 401 JSON |
   | Call `/me` with `Authorization: Bearer <access token>` | 200 with the user. Get a token by enabling `ALLOW_ADMIN_USER_PASSWORD_AUTH` on the test app client, then `aws cognito-idp admin-initiate-auth --user-pool-id $POOL --client-id <id> --auth-flow ADMIN_USER_PASSWORD_AUTH --auth-parameters USERNAME=jo@example.com,PASSWORD=<password> --query AuthenticationResult.AccessToken --output text`. A client with a secret also needs `SECRET_HASH`. Disable that flow afterwards. |
   | Set `COGNITO_USER_POOL_ID` or the client ID to something wrong | Startup config error, or a clear Cognito error page. Never a hang. |

6. **Test refresh without waiting an hour:** set the app client's access token validity to the minimum (5 minutes) and `refreshWindowSeconds` high enough to trigger it. Reload `/me` after signing in and confirm the session keeps working. Or run the automated refresh tests in Layer 1.

7. **Test SSO with two services.** Create a second app client in the same pool with callback `http://localhost:3001/auth/callback`. Copy the example env to a second file with that client ID, `PORT=3001`, `APP_ORIGIN=http://localhost:3001` and `MONGODB_DB=auth-example-2`, and start it in another terminal:

   ```bash
   node --env-file=examples/express-app/.env.second examples/express-app/index.js
   ```

   Sign in on `:3000`, then open `http://localhost:3001/me`. You should get in with **no password prompt**. Log out on `:3000` and open `:3001` in a private window: you should be asked to sign in.

8. **Clean up:** `docker rm -f auth-mongo`, and delete the test user and the extra app client.

### Layer 3: test the package itself before publishing

This checks that the artifact consumers receive works, not just your working copy.

**a) Install the exact tarball in a clean project** (fast):

```bash
npm pack                                   # creates shared-cognito-auth-lib-<version>.tgz
mkdir /tmp/consumer && cd /tmp/consumer && npm init -y
npm install /path/to/shared-cognito-auth-lib-<version>.tgz mongodb express
cp -r /path/to/auth/examples/express-app/index.js .
node --env-file=.env index.js              # same checklist as Layer 2
```

Also confirm both module systems load it: `node -e "require('shared-cognito-auth-lib')"` and `node --input-type=module -e "import 'shared-cognito-auth-lib'"`.

**b) Rehearse a real publish with a local registry** (closest to the real thing, no risk):

```bash
npx verdaccio                                         # local registry on http://localhost:4873
npm adduser --registry http://localhost:4873          # any username and password
npm publish --registry http://localhost:4873
# in a clean project:
npm install shared-cognito-auth-lib --registry http://localhost:4873
```

This exercises the `files` list, the `exports` map, the `prepack` build and the install flow. Stop verdaccio when done. Its storage is local.

### Release gate

Before every public release:

1. CI is green (typecheck, lint, tests on Node 22 and 24).
2. Layer 2 checklist passes against a test pool, including the SSO step if SSO changed.
3. Layer 3a passes with the tarball from `npm pack`.
4. `openspec validate <change> --strict` passes, if the release comes from an OpenSpec change.
5. `npm publish --dry-run` lists only `dist/`, `docs/guide.md`, `readme.md` and `package.json`.

## 7. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `ENEEDAUTH` / `E401` | Not logged in or token expired. Run `npm login` or refresh `NPM_TOKEN`. |
| `E403 ... you do not have permission` | Not a maintainer of the package, or the name is owned by someone else. Use a scope. |
| `E403 ... two-factor authentication required` | Enable 2FA on the account, or pass `--otp`. |
| `E402 Payment Required` | A scoped package defaults to private. Add `--access public`. |
| `E403 cannot publish over previously published version` | The version already exists. Bump it with `npm version`. |
| `E404` on `npm publish` for a scope | The npm org or scope does not exist or you are not a member. |
| Provenance or trusted publishing errors | Check `id-token: write`, the exact workflow file name in the npm settings, a `repository` field that matches the repo, and npm 11.5.1 or later. |
| Tarball is missing `dist/` | Run `npm run build`. `prepack` normally does this. Check with `npm publish --dry-run`. |
| Layer 1 test hangs on first run | It is downloading `mongod`. Wait, or check network and proxy settings. |
| Cognito `redirect_mismatch` in Layer 2 | The callback URL in `.env` does not exactly match one on the app client. |
