import express from "express";
import { MongoClient } from "mongodb";
import { createAuth } from "shared-cognito-auth-lib";

const env = (name, fallback) => {
  const value = process.env[name] ?? fallback;
  if (value === undefined) throw new Error(`Missing environment variable ${name}`);
  return value;
};

const port = Number(env("PORT", "3000"));
const origin = env("APP_ORIGIN", `http://localhost:${port}`);

const mongo = await MongoClient.connect(env("MONGODB_URI"));
const db = mongo.db(env("MONGODB_DB", "auth-example"));

const auth = createAuth({
  cognito: {
    region: env("COGNITO_REGION"),
    userPoolId: env("COGNITO_USER_POOL_ID"),
    clientId: env("COGNITO_CLIENT_ID"),
    clientSecret: process.env.COGNITO_CLIENT_SECRET,
    domain: env("COGNITO_DOMAIN"),
    callbackUrl: `${origin}/auth/callback`,
    logoutUrl: `${origin}/`,
  },
  db,
  session: { secret: env("SESSION_SECRET") },
});

const app = express();

// Routes mounted before auth.middleware() are public.
app.use(auth.router());
app.get("/", (_req, res) => {
  res.send(`
    <h1>Auth example</h1>
    <p><a href="/me">My profile</a> | <a href="/admin">Admin</a></p>
    <form method="post" action="/auth/logout"><button>Log out</button></form>`);
});

// Everything below requires a signed-in user.
app.use(auth.middleware());
app.get("/me", (req, res) => res.json(req.user));
app.get("/admin", auth.requireRole("admin"), (req, res) => res.send(`Welcome, admin ${req.user.email ?? req.user.sub}`));

app.listen(port, () => console.log(`Example listening on ${origin}`));
