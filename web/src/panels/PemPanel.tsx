import { useEffect, useState } from "react";
import { fetchJson } from "../api";
import { roomDisplayName } from "../labels";

interface AssetRow {
  deviceId: string;
  deviceType: string;
  location: string;
  assetHealthScore: number;
  failureProbability24h: number;
  failureProbability48h: number;
  failureProbability72h: number;
  calibrationDueDate: string;
  daysUntilCalibration: number;
  calibrationStatus: string;
}

function calibrationBadge(status: string, days: number) {
  if (status === "overdue")
    return <span className="pill crit">Calibration overdue</span>;
  if (status === "due_soon")
    return <span className="pill warn">Due in {days}d</span>;
  if (status === "upcoming")
    return <span className="pill ok">Due in {days}d</span>;
  return null;
}

export default function PemPanel({
  onNotify,
}: {
  onNotify: (m: string) => void;
}) {
  const [assets, setAssets] = useState<AssetRow[]>([]);

  useEffect(() => {
    fetchJson<{ assets: AssetRow[] }>("/twins/assets")
      .then((r) => setAssets(r.assets))
      .catch(console.error);
  }, []);

  return (
    <div className="card">
      <h2 className="card-title">Equipment health</h2>
      <p className="card-sub">
        Higher bar is better. If the chance of a problem in the next day looks
        high, schedule a check.
      </p>
      <div className="device-grid">
        {assets.map((a) => (
          <div key={a.deviceId} className="device-card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 6 }}>
              <h3 style={{ margin: 0 }}>{a.deviceType}</h3>
              {calibrationBadge(a.calibrationStatus, a.daysUntilCalibration)}
            </div>
            <div className="device-meta">
              {roomDisplayName[a.location] ?? a.location} . {a.deviceId}
            </div>
            <div className="bar-labels">
              <span>Needs attention</span>
              <span>Healthy</span>
            </div>
            <div className="health-track">
              <span style={{ width: `${a.assetHealthScore}%` }} />
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", fontSize: "0.8rem", color: "var(--muted)", margin: "0.35rem 0 0.75rem" }}>
              <span>24h: <strong>{(a.failureProbability24h * 100).toFixed(0)}%</strong></span>
              <span>48h: <strong>{(a.failureProbability48h * 100).toFixed(0)}%</strong></span>
              <span>72h: <strong>{(a.failureProbability72h * 100).toFixed(0)}%</strong></span>
            </div>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() =>
                fetchJson<{
                  workOrderId?: string;
                  suggestedReplacements?: { deviceId: string; location: string; assetHealthScore: number }[];
                }>(`/assets/${a.deviceId}/maintenance`, {
                  method: "POST",
                  body: JSON.stringify({ priority: "urgent" }),
                })
                  .then((x) => {
                    let msg = `Service scheduled — ticket ${x.workOrderId?.slice(0, 8) ?? "created"}.`;
                    if (x.suggestedReplacements?.length) {
                      msg += ` Suggested replacement: ${x.suggestedReplacements[0].deviceId} (health: ${x.suggestedReplacements[0].assetHealthScore}%)`;
                    }
                    onNotify(msg);
                  })
                  .catch(console.error)
              }
            >
              Schedule service
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
