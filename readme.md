# shared-cognito-auth-lib

Login, SSO, token refresh and role-based access for Node services, backed by AWS Cognito. Roles and permissions stay in each service's own MongoDB.

```bash
npm install shared-cognito-auth-lib mongodb express
```

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
  session: { secret: process.env.SESSION_SECRET },
});

const app = express();
app.use(auth.router());                                   // login, callback, logout, refresh
app.use(auth.middleware());                               // everything below requires sign-in
app.get("/me", (req, res) => res.json(req.user));
app.get("/admin", auth.requireRole("admin"), (req, res) => res.send("admin"));
```

Requires Node.js 22 or later.

- [Developer guide](docs/guide.md): Cognito setup, configuration, roles schema, SSO, troubleshooting
- [Example app](examples/express-app)
