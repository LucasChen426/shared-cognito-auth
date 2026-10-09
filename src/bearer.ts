import type { TokenVerifier } from "./verifier";

export interface AuthUser {
  sub: string;
  username?: string;
  email?: string;
  name?: string;
  groups: string[];
}

interface Req {
  headers: { authorization?: string };
  user?: AuthUser;
}
interface Res {
  status(code: number): Res;
  json(body: unknown): unknown;
}

const BEARER = /^Bearer\s+(\S+)\s*$/i;

// Absent header is not an error: the session path decides what to do.
export function bearerAuth(verifier: TokenVerifier) {
  return async (req: Req, res: Res, next: () => void): Promise<void> => {
    const header = req.headers.authorization;
    if (header === undefined) return next();

    const token = BEARER.exec(header)?.[1];
    if (!token) {
      res.status(401).json({ error: "invalid_token" });
      return;
    }
    try {
      const claims = await verifier.verify(token, "access");
      const groups = claims["cognito:groups"];
      req.user = {
        sub: String(claims.sub),
        ...(typeof claims.username === "string" && { username: claims.username }),
        groups: Array.isArray(groups) ? groups.map(String) : [],
      };
    } catch {
      res.status(401).json({ error: "invalid_token" });
      return;
    }
    next();
  };
}
