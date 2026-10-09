import type { Db } from "mongodb";

export interface Authorization {
  roles: string[];
  permissions: string[];
}

export type AuthorizationLookup = (sub: string) => Promise<Partial<Authorization> | null | undefined>;

export interface AuthorizationOptions {
  db: Db;
  collection: string;
  getAuthorization?: AuthorizationLookup;
  cacheTtlSeconds: number;
  now?: () => number;
}

const normalize = (value: Partial<Authorization> | null | undefined): Authorization => ({
  roles: value?.roles ?? [],
  permissions: value?.permissions ?? [],
});

const MAX_CACHED_USERS = 10_000;

export function createAuthorizationResolver({ db, collection, getAuthorization, cacheTtlSeconds, now = Date.now }: AuthorizationOptions) {
  const lookup: AuthorizationLookup =
    getAuthorization ?? ((sub) => db.collection<{ sub: string } & Partial<Authorization>>(collection).findOne({ sub }));
  const cache = new Map<string, { value: Authorization; expires: number }>();

  return {
    async resolve(sub: string): Promise<Authorization> {
      const hit = cache.get(sub);
      if (hit && hit.expires > now()) return hit.value;
      cache.delete(sub);

      const value = normalize(await lookup(sub));
      if (cacheTtlSeconds > 0) {
        if (cache.size >= MAX_CACHED_USERS) cache.delete(cache.keys().next().value!);
        cache.set(sub, { value, expires: now() + cacheTtlSeconds * 1000 });
      }
      return value;
    },

    invalidate(sub: string) {
      cache.delete(sub);
    },
  };
}

export type AuthorizationResolver = ReturnType<typeof createAuthorizationResolver>;
