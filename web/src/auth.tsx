import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

interface User {
  email: string;
  role: string;
  displayName: string;
}

interface AuthCtx {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthCtx>({
  user: null,
  loading: true,
  login: async () => {},
  logout: () => {},
});

const ROLE_NAMES: Record<string, string> = {
  Administrator: "Admin",
  Clinician: "Doctor",
  Nurse: "Nurse",
  EquipmentTechnician: "Technician",
  Pharmacist: "Pharmacist",
  SystemAdmin: "Sys Admin",
  HospitalPlanner: "Planner",
};

function displayNameFromEmail(email: string, role: string): string {
  const local = email.split("@")[0] ?? "";
  const name = local.charAt(0).toUpperCase() + local.slice(1);
  return `${name} (${ROLE_NAMES[role] ?? role})`;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem("ct-user");
    if (stored) {
      try {
        setUser(JSON.parse(stored));
      } catch {}
    }
    setLoading(false);
  }, []);

  const login = async (email: string, password: string) => {
    const res = await fetch("/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || "Login failed");
    }
    const data = await res.json();
    const role = data.user?.role ?? data.role ?? "Administrator";
    const name = data.user?.displayName ?? displayNameFromEmail(email, role);
    const u: User = { email, role, displayName: name };
    if (data.token) localStorage.setItem("ct-token", data.token);
    localStorage.setItem("ct-user", JSON.stringify(u));
    setUser(u);
  };

  const logout = () => {
    localStorage.removeItem("ct-token");
    localStorage.removeItem("ct-user");
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
