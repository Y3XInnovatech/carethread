import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../auth";
import HealthScoreBadge from "../components/HealthScoreBadge";
import {
  IconBeds,
  IconChart,
  IconDashboard,
  IconLogout,
  IconPeople,
  IconPulse,
  IconSandbox,
  IconWrench,
} from "../icons";
import { useEffect, useState } from "react";
import { wsUrl } from "../api";

const NAV_ITEMS = [
  { to: "/", icon: IconDashboard, label: "Dashboard", end: true },
  { to: "/beds", icon: IconBeds, label: "Beds & Flow" },
  { to: "/vitals", icon: IconPulse, label: "Vitals & Alerts" },
  { to: "/equipment", icon: IconWrench, label: "Equipment" },
  { to: "/staff", icon: IconPeople, label: "Staff" },
  { to: "/simulation", icon: IconChart, label: "What-If" },
  { to: "/sandbox", icon: IconSandbox, label: "Sandbox" },
];

export default function AppLayout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [alertCount, setAlertCount] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const ws = new WebSocket(wsUrl("alerts"));
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as {
          payload?: { alerts?: { acknowledged?: boolean }[] };
        };
        if (msg.payload?.alerts) {
          setAlertCount(msg.payload.alerts.filter((a) => !a.acknowledged).length);
        }
      } catch {}
    };
    return () => ws.close();
  }, []);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  const pageTitle = NAV_ITEMS.find(
    (n) => n.end ? location.pathname === n.to : location.pathname.startsWith(n.to)
  )?.label ?? "CareThread";

  return (
    <div className={`app-layout ${collapsed ? "sidebar-collapsed" : ""}`}>
      {mobileOpen && <div className="sidebar-overlay" onClick={() => setMobileOpen(false)} />}

      <aside className={`sidebar ${mobileOpen ? "sidebar-mobile-open" : ""}`}>
        <div className="sidebar-header">
          <div className="sidebar-brand">
            <div className="sidebar-logo">C</div>
            {!collapsed && <span className="sidebar-brand-text">CareThread</span>}
          </div>
          <button
            type="button"
            className="sidebar-collapse-btn"
            onClick={() => setCollapsed(!collapsed)}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? "»" : "«"}
          </button>
        </div>

        <nav className="sidebar-nav">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `sidebar-link ${isActive ? "sidebar-link-active" : ""}`
              }
              title={collapsed ? item.label : undefined}
            >
              <item.icon />
              {!collapsed && <span>{item.label}</span>}
              {item.to === "/vitals" && alertCount > 0 && (
                <span className="sidebar-badge">{alertCount}</span>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer">
          {user && !collapsed && (
            <div className="sidebar-user">
              <div className="sidebar-avatar">{user.email[0]?.toUpperCase()}</div>
              <div className="sidebar-user-info">
                <div className="sidebar-user-name">{user.displayName}</div>
                <div className="sidebar-user-role">{user.role}</div>
              </div>
            </div>
          )}
          {user && collapsed && (
            <div className="sidebar-avatar" title={user.displayName} style={{ margin: "0 auto" }}>
              {user.email[0]?.toUpperCase()}
            </div>
          )}
          <button
            type="button"
            className="sidebar-link sidebar-logout"
            onClick={logout}
            title="Sign out"
          >
            <IconLogout />
            {!collapsed && <span>Sign out</span>}
          </button>
        </div>
      </aside>

      <div className="main-area">
        <header className="topbar">
          <button
            type="button"
            className="mobile-menu-btn"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label="Toggle menu"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M3 6h18M3 12h18M3 18h18" />
            </svg>
          </button>
          <h1 className="topbar-title">{pageTitle}</h1>
          <div className="topbar-right">
            <HealthScoreBadge />
            <span className="badge">Practice mode</span>
          </div>
        </header>

        <main className="page-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
