import type { Express, Request, Response } from "express";
import { createHmac, randomUUID } from "node:crypto";
import { createToken } from "./middleware.js";

function hashPassword(password: string): string {
  return createHmac("sha256", "carethread-salt").update(password).digest("hex");
}

const DEMO_USERS = [
  { id: randomUUID(), email: "admin@carethread.local", password: "admin123", role: "Administrator", displayName: "Admin User" },
  { id: randomUUID(), email: "doctor@carethread.local", password: "doctor123", role: "Clinician", displayName: "Dr. Sarah Chen" },
  { id: randomUUID(), email: "nurse@carethread.local", password: "nurse123", role: "Nurse", displayName: "Elena Garcia RN" },
  { id: randomUUID(), email: "tech@carethread.local", password: "tech123", role: "EquipmentTechnician", displayName: "Mike Torres" },
  { id: randomUUID(), email: "pharmacist@carethread.local", password: "pharm123", role: "Pharmacist", displayName: "Dr. Patel" },
  { id: randomUUID(), email: "sysadmin@carethread.local", password: "sysadmin123", role: "SystemAdmin", displayName: "System Admin" },
  { id: randomUUID(), email: "planner@carethread.local", password: "planner123", role: "HospitalPlanner", displayName: "Hospital Planner" },
];

const usersDb = DEMO_USERS.map((u) => ({
  ...u,
  passwordHash: hashPassword(u.password),
}));

export function registerAuthRoutes(app: Express) {
  app.post("/api/v1/auth/login", (req: Request, res: Response) => {
    const { email, password } = req.body as { email?: string; password?: string };
    if (!email || !password) {
      return res.status(400).json({ error: "email and password required" });
    }

    const user = usersDb.find(
      (u) => u.email === email && u.passwordHash === hashPassword(password)
    );
    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = createToken(user);
    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        displayName: user.displayName,
      },
    });
  });

  app.post("/api/v1/auth/refresh", (req: Request, res: Response) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Token required" });
    }
    res.json({ note: "Refresh endpoint placeholder — re-login for demo" });
  });

  app.get("/api/v1/auth/me", (req: Request, res: Response) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    res.json({ note: "Use token payload for user info" });
  });

  app.get("/api/v1/auth/demo-users", (_req: Request, res: Response) => {
    res.json({
      users: DEMO_USERS.map((u) => ({
        email: u.email,
        password: u.password,
        role: u.role,
        displayName: u.displayName,
      })),
    });
  });
}
