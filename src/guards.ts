import type { Authorization, AuthorizationResolver } from "./authorization";
import { respondUnauthenticated, type Req, type Res } from "./middleware";

type GuardReq = Req & { authorization?: Authorization };

export interface GuardDeps {
  authorization: Pick<AuthorizationResolver, "resolve">;
  routePrefix: string;
}

export function createGuards({ authorization, routePrefix }: GuardDeps) {
  const guard = (allows: (granted: Authorization) => boolean) =>
    async (req: GuardReq, res: Res, next: () => void): Promise<void> => {
      if (!req.user) return respondUnauthenticated(req, res, routePrefix);

      let granted: Authorization;
      try {
        granted = await authorization.resolve(req.user.sub);
      } catch {
        // Fail closed without leaking why the lookup failed.
        res.status(503).json({ error: "authorization_unavailable" });
        return;
      }
      if (!allows(granted)) {
        res.status(403).json({ error: "forbidden" });
        return;
      }
      req.authorization = granted;
      next();
    };

  return {
    requireRole: (...roles: string[]) => guard((g) => roles.some((role) => g.roles.includes(role))),
    requirePermission: (...permissions: string[]) => guard((g) => permissions.every((p) => g.permissions.includes(p))),
  };
}
