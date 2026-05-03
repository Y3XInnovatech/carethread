import { useEffect, useRef, useState } from "react";
import { fetchJson, wsUrl } from "../api";

interface HealthScoreFactor {
  id: string;
  label: string;
  score: number;
  weight: number;
  contribution: number;
  status: "ok" | "warn" | "crit";
  detail: string;
}

interface HealthScoreBreakdown {
  overall: number;
  grade: "A" | "B" | "C" | "D" | "F";
  factors: HealthScoreFactor[];
  worstFactors: string[];
  timestamp: string;
}

function statusColor(status: "ok" | "warn" | "crit") {
  if (status === "ok") return "var(--ok)";
  if (status === "warn") return "var(--warn)";
  return "var(--crit)";
}

function scoreColor(score: number) {
  if (score >= 70) return "var(--ok)";
  if (score >= 40) return "var(--warn)";
  return "var(--crit)";
}

export default function HealthScoreBadge() {
  const [data, setData] = useState<HealthScoreBreakdown | null>(null);
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchJson<HealthScoreBreakdown>("/hospital/health-score")
      .then(setData)
      .catch(() => {});

    const ws = new WebSocket(wsUrl("hospital-health"));
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as {
          payload?: HealthScoreBreakdown;
        };
        if (msg.payload?.overall !== undefined) setData(msg.payload);
      } catch {}
    };
    return () => ws.close();
  }, []);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  if (!data) return null;

  return (
    <div className="health-badge-wrap" ref={panelRef}>
      <button
        type="button"
        className="health-badge"
        style={{ borderColor: scoreColor(data.overall) }}
        onClick={() => setOpen((v) => !v)}
        title="Hospital Health Score — click for details"
      >
        <span className="health-badge-score" style={{ color: scoreColor(data.overall) }}>
          {data.overall}
        </span>
        <span className="health-badge-grade" style={{ color: scoreColor(data.overall) }}>
          {data.grade}
        </span>
      </button>

      {open && (
        <div className="health-detail-panel">
          <div className="health-detail-header">
            <div
              className="health-detail-ring"
              style={{
                background: `conic-gradient(${scoreColor(data.overall)} ${data.overall * 3.6}deg, var(--surface2) 0deg)`,
              }}
            >
              <span>{data.overall}</span>
            </div>
            <div>
              <h3>Hospital Health</h3>
              <span className="pill" style={{ background: scoreColor(data.overall), color: "#000" }}>
                Grade {data.grade}
              </span>
            </div>
          </div>

          <div className="health-factors">
            {data.factors.map((f) => (
              <div key={f.id} className="health-factor-row">
                <div className="health-factor-label">
                  <span>{f.label}</span>
                  <span className="health-factor-pct" style={{ color: statusColor(f.status) }}>
                    {f.score}
                  </span>
                </div>
                <div className="health-factor-track">
                  <div
                    className="health-factor-bar"
                    style={{
                      width: `${f.score}%`,
                      background: statusColor(f.status),
                    }}
                  />
                </div>
                <div className="health-factor-detail">{f.detail}</div>
              </div>
            ))}
          </div>

          {data.worstFactors.length > 0 && (
            <div className="health-issues">
              <strong>Issues:</strong>
              {data.factors
                .filter((f) => data.worstFactors.includes(f.id))
                .map((f) => (
                  <div key={f.id} className="health-issue-item" style={{ borderLeftColor: statusColor(f.status) }}>
                    {f.label}: {f.detail}
                  </div>
                ))}
            </div>
          )}

          <div className="health-detail-ts">
            Updated {new Date(data.timestamp).toLocaleTimeString()}
          </div>
        </div>
      )}
    </div>
  );
}
