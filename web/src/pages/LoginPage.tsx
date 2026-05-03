import { useState } from "react";
import { useAuth } from "../auth";
import { useNavigate } from "react-router-dom";

const DEMO_USERS = [
  { email: "admin@carethread.local", password: "admin123", role: "Administrator", label: "Admin" },
  { email: "doctor@carethread.local", password: "doctor123", role: "Clinician", label: "Doctor" },
  { email: "nurse@carethread.local", password: "nurse123", role: "Nurse", label: "Nurse" },
  { email: "tech@carethread.local", password: "tech123", role: "Technician", label: "Technician" },
  { email: "planner@carethread.local", password: "planner123", role: "HospitalPlanner", label: "Planner" },
];

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email, password);
      navigate("/");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Login failed");
    }
    setLoading(false);
  };

  const quickLogin = async (u: typeof DEMO_USERS[0]) => {
    setError(null);
    setLoading(true);
    try {
      await login(u.email, u.password);
      navigate("/");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Login failed");
    }
    setLoading(false);
  };

  return (
    <div className="login-page">
      <div className="login-container">
        <div className="login-hero">
          <div className="login-hero-content">
            <div className="login-logo">
              <div className="login-logo-icon">C</div>
              <span className="login-logo-text">CareThread</span>
            </div>
            <h1 className="login-hero-title">Hospital Digital Twin</h1>
            <p className="login-hero-sub">
              Real-time operations intelligence for patient flow, clinical warnings, equipment health, staff workload, and what-if planning.
            </p>
            <div className="login-hero-features">
              <div className="login-feature">
                <span className="login-feature-dot" style={{ background: "var(--accent)" }} />
                Real-time bed occupancy & patient flow
              </div>
              <div className="login-feature">
                <span className="login-feature-dot" style={{ background: "var(--ok)" }} />
                NEWS2 clinical early warning scores
              </div>
              <div className="login-feature">
                <span className="login-feature-dot" style={{ background: "var(--warn)" }} />
                Predictive equipment maintenance
              </div>
              <div className="login-feature">
                <span className="login-feature-dot" style={{ background: "var(--crit)" }} />
                Staff scheduling & workload balance
              </div>
            </div>
          </div>
        </div>

        <div className="login-form-side">
          <div className="login-form-wrap">
            <h2 className="login-form-title">Sign in</h2>
            <p className="login-form-sub">Enter your credentials or use a demo account below.</p>

            <form onSubmit={handleSubmit} className="login-form">
              <div className="login-field">
                <label htmlFor="email">Email</label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="user@carethread.local"
                  autoComplete="email"
                  required
                />
              </div>
              <div className="login-field">
                <label htmlFor="password">Password</label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter password"
                  autoComplete="current-password"
                  required
                />
              </div>
              {error && <div className="login-error">{error}</div>}
              <button type="submit" className="login-submit" disabled={loading}>
                {loading ? "Signing in..." : "Sign in"}
              </button>
            </form>

            <div className="login-divider">
              <span>Quick demo access</span>
            </div>

            <div className="login-demo-grid">
              {DEMO_USERS.map((u) => (
                <button
                  key={u.email}
                  type="button"
                  className="login-demo-btn"
                  onClick={() => quickLogin(u)}
                  disabled={loading}
                >
                  <span className="login-demo-role">{u.label}</span>
                  <span className="login-demo-email">{u.email}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
