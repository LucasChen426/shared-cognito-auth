import type { Db } from "mongodb";
import type { AuthorizationLookup } from "./authorization";

export interface CognitoConfig {
  region: string;
  userPoolId: string;
  clientId: string;
  clientSecret?: string;
  domain: string;
  callbackUrl: string;
  logoutUrl: string;
}

export interface AuthConfig {
  cognito: CognitoConfig;
  db: Db;
  session: { secret: string };
  routePrefix?: string;
  cookieName?: string;
  sessionTtlSeconds?: number;
  refreshWindowSeconds?: number;
  sessionsCollection?: string;
  rolesCollection?: string;
  roleCacheTtlSeconds?: number;
  getAuthorization?: AuthorizationLookup;
}

export type ResolvedConfig = Required<Omit<AuthConfig, "cognito" | "getAuthorization">> & {
  cognito: CognitoConfig;
  getAuthorization?: AuthorizationLookup;
};

const DEFAULTS = {
  routePrefix: "/auth",
  cookieName: "auth_sid",
  sessionTtlSeconds: 8 * 60 * 60,
  refreshWindowSeconds: 300,
  sessionsCollection: "authSessions",
  rolesCollection: "userRoles",
  roleCacheTtlSeconds: 60,
};

const isStr = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";
const isHttpUrl = (v: unknown) => {
  try {
    return isStr(v) && /^https?:$/.test(new URL(v).protocol);
  } catch {
    return false;
  }
};

// Error messages name settings only, never their values, so secrets cannot leak.
export function resolveConfig(input: AuthConfig): ResolvedConfig {
  const problems: string[] = [];
  const check = (ok: boolean, name: string, why: string) => ok || problems.push(`${name} ${why}`);
  const c: Partial<CognitoConfig> = input?.cognito ?? {};

  for (const key of ["region", "userPoolId", "clientId", "domain"] as const) {
    check(isStr(c[key]), `cognito.${key}`, "is required");
  }
  for (const key of ["callbackUrl", "logoutUrl"] as const) {
    check(isHttpUrl(c[key]), `cognito.${key}`, "must be an absolute http(s) URL");
  }
  check(typeof input?.db?.collection === "function", "db", "must be a MongoDB Db handle");
  const secret = input?.session?.secret;
  check(isStr(secret) && secret.length >= 32, "session.secret", "must be at least 32 characters");

  const merged = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS) as (keyof typeof DEFAULTS)[]) {
    const value = input?.[key];
    if (value === undefined) continue;
    const ok = typeof DEFAULTS[key] === "number" ? Number.isFinite(value) && (value as number) > 0 : isStr(value);
    check(ok && (key !== "routePrefix" || (String(value).startsWith("/") && !String(value).endsWith("/"))), key, "is invalid");
    (merged as Record<string, unknown>)[key] = value;
  }
  const getAuthorization = input?.getAuthorization;
  check(getAuthorization === undefined || typeof getAuthorization === "function", "getAuthorization", "must be a function");

  if (problems.length) {
    throw new Error(`Invalid auth configuration:\n - ${problems.join("\n - ")}`);
  }
  const domain = c.domain!.replace(/\/+$/, "");
  return {
    ...merged,
    db: input.db,
    session: { secret: secret! },
    ...(getAuthorization && { getAuthorization }),
    cognito: { ...(c as CognitoConfig), domain: /^https?:\/\//.test(domain) ? domain : `https://${domain}` },
  };
}
