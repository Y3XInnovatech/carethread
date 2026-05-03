import type { Request, Response, NextFunction } from "express";
import { createHmac } from "node:crypto";
import { hasPermission } from "./rbac.js";

const JWT_SECRET = process.env.JWT_SECRET ?? "carethread-dev-secret-change-in-production";

interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  displayName: string;
  iat: number;
  exp: number;
}

function base64UrlEncode(data: string): string {
  return Buffer.from(data).toString("base64url");
}

function base64UrlDecode(data: string): string {
  return Buffer.from(data, "base64url").toString("utf-8");
}

function sign(payload: object): string {
  const header = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64UrlEncode(JSON.stringify(payload));
  const signature = createHmac("sha256", JWT_SECRET)
    .update(`${header}.${body}`)
    .digest("base64url");
  return `${header}.${body}.${signature}`;
}

function verify(token: string): JwtPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const expected = createHmac("sha256", JWT_SECRET)
    .update(`${header}.${body}`)
    .digest("base64url");
  if (sig !== expected) return null;
  try {
    const payload = JSON.parse(base64UrlDecode(body!)) as JwtPayload;
    if (payload.exp && payload.exp < Date.now() / 1000) return null;
    return payload;
  } catch {
    return null;
  }
}

export function createToken(user: {
  id: string;
  email: string;
  role: string;
  displayName: string;
}): string {
  return sign({
    sub: user.id,
    email: user.email,
    role: user.role,
    displayName: user.displayName,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 8 * 3600,
  });
}

export interface AuthenticatedRequest extends Request {
  user?: JwtPayload;
}

export function authMiddleware(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (process.env.AUTH_DISABLED === "true") {
    req.user = {
      sub: "demo-user",
      email: "demo@carethread.local",
      role: "Administrator",
      displayName: "Demo User",
      iat: 0,
      exp: 0,
    };
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or invalid Authorization header" });
  }

  const token = authHeader.slice(7);
  const payload = verify(token);
  if (!payload) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  req.user = payload;
  next();
}

export function requirePermission(permission: string) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const role = req.user?.role ?? "";
    if (!hasPermission(role, permission)) {
      return res.status(403).json({
        error: "Insufficient permissions",
        required: permission,
        yourRole: role,
      });
    }
    next();
  };
}
