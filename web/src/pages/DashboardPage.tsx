import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchJson, wsUrl } from "../api";
import { wardDisplayName } from "../labels";

interface HealthFactor {
  id: string;
  label: string;
  score: number;
  weight: number;
  contribution: number;
  status: "ok" | "warn" | "crit";
  detail: string;
}

interface HealthScore {
  overall: number;
  grade: string;
  factors: HealthFactor[];
  worstFactors: string[];
  timestamp: string;
}

interface RoomRow {
  roomId: string;
  wardId: string;
  bedCount: number;
  occupiedBeds: number;
  patients: { bed: string; patientId: string; displayName: string }[];
}

interface StaffRow {
  staffId: string;
  role: string;
  workloadScore: number;
  fatigueIndex: number;
  burnoutRisk: string;
}

interface AssetRow {
  deviceId: string;
  deviceType: string;
  assetHealthScore: number;
}

interface Alert {
  alertId: string;
  severity: string;
  message: string;
  timestamp: string;
  acknowledged?: boolean;
}

function statusColor(s: "ok" | "warn" | "crit") {
  if (s === "ok") return "var(--ok)";
  if (s === "warn") return "var(--warn)";
  return "var(--crit)";
}

function scoreColor(score: number) {
  if (score >= 70) return "var(--ok)";
  if (score >= 40) return "var(--warn)";
  return "var(--crit)";
}

export default function DashboardPage() {
  const [health, setHealth] = useState<HealthScore | null>(null);
  const [rooms, setRooms] = useState<RoomRow[]>([]);
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);

  useEffect(() => {
    fetchJson<HealthScore>("/hospital/health-score").then(setHealth).catch(() => {});
    fetchJson<{ rooms: RoomRow[] }>("/twins/rooms").then((r) => setRooms(r.rooms)).catch(() => {});
    fetchJson<{ staff: StaffRow[] }>("/twins/staff").then((r) => setStaff(r.staff)).catch(() => {});
    fetchJson<{ assets: AssetRow[] }>("/twins/assets").then((r) => setAssets(r.assets)).catch(() => {});

    const ws = new WebSocket(wsUrl("hospital-health"));
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as { payload?: HealthScore };
        if (msg.payload?.overall !== undefined) setHealth(msg.payload);
      } catch {}
    };

    const wsA = new WebSocket(wsUrl("alerts"));
    wsA.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as { payload?: { alerts?: Alert[] } };
        if (msg.payload?.alerts) setAlerts(msg.payload.alerts);
      } catch {}
    };

    return () => { ws.close(); wsA.close(); };
  }, []);

  const totalBeds = rooms.reduce((s, r) => s + r.bedCount, 0);
  const occupiedBeds = rooms.reduce((s, r) => s + r.occupiedBeds, 0);
  const occupancy = totalBeds ? Math.round((occupiedBeds / totalBeds) * 100) : 0;
  const totalPatients = rooms.reduce((s, r) => s + r.patients.length, 0);
  const unackedAlerts = alerts.filter((a) => !a.acknowledged);
  const critAlerts = unackedAlerts.filter((a) => a.severity === "critical");
  const avgHealth = assets.length ? Math.round(assets.reduce((s, a) => s + a.assetHealthScore, 0) / assets.length) : 0;
  const highBurnout = staff.filter((s) => s.burnoutRisk === "high").length;

  const wards = [...new Set(rooms.map((r) => r.wardId))];
  const wardStats = wards.map((w) => {
    const wRooms = rooms.filter((r) => r.wardId === w);
    const cap = wRooms.reduce((s, r) => s + r.bedCount, 0);
    const occ = wRooms.reduce((s, r) => s + r.occupiedBeds, 0);
    return { wardId: w, name: wardDisplayName[w] ?? w, capacity: cap, occupied: occ, rate: cap ? Math.round((occ / cap) * 100) : 0 };
  });

  return (
    <div className="dashboard">
      {/* Health Score Hero */}
      <div className="dash-hero">
        <div className="dash-hero-score">
          <div className="dash-score-ring" style={{ background: `conic-gradient(${scoreColor(health?.overall ?? 0)} ${(health?.overall ?? 0) * 3.6}deg, var(--surface3) 0deg)` }}>
            <div className="dash-score-ring-inner">
              <span className="dash-score-num">{health?.overall ?? "--"}</span>
              <span className="dash-score-label">Health</span>
            </div>
          </div>
          <div className="dash-hero-meta">
            <h2>Hospital Health Score</h2>
            {health && (
              <span className="dash-grade-badge" style={{ background: scoreColor(health.overall) }}>
                Grade {health.grade}
              </span>
            )}
            {health && health.worstFactors.length > 0 && (
              <p className="dash-hero-issues">
                {health.factors
                  .filter((f) => health.worstFactors.includes(f.id))
                  .map((f) => f.detail)
                  .join(" ")}
              </p>
            )}
          </div>
        </div>
        {health && (
          <div className="dash-factors-mini">
            {health.factors.map((f) => (
              <div key={f.id} className="dash-factor-mini">
                <div className="dash-factor-mini-header">
                  <span>{f.label}</span>
                  <span style={{ color: statusColor(f.status), fontWeight: 700 }}>{f.score}</span>
                </div>
                <div className="dash-factor-mini-track">
                  <div style={{ width: `${f.score}%`, background: statusColor(f.status) }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* KPI Cards */}
      <div className="dash-kpis">
        <Link to="/beds" className="dash-kpi">
          <div className="dash-kpi-icon" style={{ background: "var(--accent-dim)", color: "var(--accent)" }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 10v9M3 10h5v5H3M8 10h13v9H8M8 10V7a2 2 0 0 1 2-2h5a2 2 0 0 1 2 2v3" /></svg>
          </div>
          <div className="dash-kpi-body">
            <div className="dash-kpi-value">{occupiedBeds}<span>/{totalBeds}</span></div>
            <div className="dash-kpi-label">Beds occupied ({occupancy}%)</div>
          </div>
        </Link>

        <Link to="/vitals" className="dash-kpi">
          <div className="dash-kpi-icon" style={{ background: "var(--ok-dim)", color: "var(--ok)" }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" /></svg>
          </div>
          <div className="dash-kpi-body">
            <div className="dash-kpi-value">{totalPatients}</div>
            <div className="dash-kpi-label">Active patients</div>
          </div>
        </Link>

        <Link to="/vitals" className="dash-kpi">
          <div className="dash-kpi-icon" style={{ background: critAlerts.length ? "var(--crit-dim)" : "var(--warn-dim)", color: critAlerts.length ? "var(--crit)" : "var(--warn)" }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01" /></svg>
          </div>
          <div className="dash-kpi-body">
            <div className="dash-kpi-value">{unackedAlerts.length}</div>
            <div className="dash-kpi-label">Open alerts ({critAlerts.length} critical)</div>
          </div>
        </Link>

        <Link to="/staff" className="dash-kpi">
          <div className="dash-kpi-icon" style={{ background: highBurnout ? "var(--crit-dim)" : "var(--ok-dim)", color: highBurnout ? "var(--crit)" : "var(--ok)" }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></svg>
          </div>
          <div className="dash-kpi-body">
            <div className="dash-kpi-value">{staff.length}</div>
            <div className="dash-kpi-label">Staff on duty ({highBurnout} high strain)</div>
          </div>
        </Link>

        <Link to="/equipment" className="dash-kpi">
          <div className="dash-kpi-icon" style={{ background: "var(--warn-dim)", color: "var(--warn)" }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" /></svg>
          </div>
          <div className="dash-kpi-body">
            <div className="dash-kpi-value">{avgHealth}%</div>
            <div className="dash-kpi-label">Avg equipment health</div>
          </div>
        </Link>
      </div>

      {/* Ward Occupancy + Recent Alerts */}
      <div className="dash-grid-2">
        <div className="dash-card">
          <div className="dash-card-header">
            <h3>Ward Occupancy</h3>
            <Link to="/beds" className="dash-card-link">View all</Link>
          </div>
          <div className="dash-ward-list">
            {wardStats.map((w) => (
              <div key={w.wardId} className="dash-ward-row">
                <div className="dash-ward-info">
                  <span className="dash-ward-name">{w.name}</span>
                  <span className="dash-ward-count">{w.occupied}/{w.capacity}</span>
                </div>
                <div className="dash-ward-bar-track">
                  <div
                    className="dash-ward-bar"
                    style={{
                      width: `${w.rate}%`,
                      background: w.rate >= 90 ? "var(--crit)" : w.rate >= 75 ? "var(--warn)" : "var(--ok)",
                    }}
                  />
                </div>
                <span className="dash-ward-pct">{w.rate}%</span>
              </div>
            ))}
          </div>
        </div>

        <div className="dash-card">
          <div className="dash-card-header">
            <h3>Recent Alerts</h3>
            <Link to="/vitals" className="dash-card-link">View all</Link>
          </div>
          {unackedAlerts.length === 0 ? (
            <p className="muted" style={{ textAlign: "center", padding: "2rem 0" }}>No open alerts</p>
          ) : (
            <div className="dash-alert-list">
              {unackedAlerts.slice(0, 5).map((a) => (
                <div
                  key={a.alertId}
                  className={`dash-alert-item dash-alert-${a.severity}`}
                >
                  <div className="dash-alert-dot" />
                  <div className="dash-alert-body">
                    <div className="dash-alert-msg">{a.message}</div>
                    <div className="dash-alert-time">{new Date(a.timestamp).toLocaleTimeString()}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Quick Actions */}
      <div className="dash-card">
        <div className="dash-card-header">
          <h3>Quick Actions</h3>
        </div>
        <div className="dash-actions">
          <Link to="/beds" className="dash-action-btn">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 10v9M3 10h5v5H3M8 10h13v9H8M8 10V7a2 2 0 0 1 2-2h5a2 2 0 0 1 2 2v3" /></svg>
            Check bed availability
          </Link>
          <Link to="/vitals" className="dash-action-btn">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 12h4l2-7 4 14 2-7h6" /></svg>
            Monitor patient vitals
          </Link>
          <Link to="/simulation" className="dash-action-btn">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 3v18h18M7 16l4-8 4 5 4-9" /></svg>
            Run what-if scenario
          </Link>
          <Link to="/sandbox" className="dash-action-btn">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M9 3h6l2 4H7l2-4zM7 7v10a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V7M12 11v4M10 13h4" /></svg>
            Open sandbox
          </Link>
        </div>
      </div>
    </div>
  );
}
