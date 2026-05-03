import { useEffect, useState } from "react";
import { fetchJson } from "../api";

interface ScenarioResult {
  scenarioId: string;
  name: string;
  status: string;
  parameterOverrides: Record<string, number>;
  metrics?: Record<string, number>;
}

interface Template {
  id: string;
  name: string;
  description: string;
  defaultOverrides: Record<string, number>;
}

export default function WisePanel() {
  const [scenarioId, setScenarioId] = useState<string | null>(null);
  const [result, setResult] = useState<ScenarioResult | null>(null);
  const [busyLevel, setBusyLevel] = useState(35);
  const [bedDelta, setBedDelta] = useState(0);
  const [staffMult, setStaffMult] = useState(100);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [compareResults, setCompareResults] = useState<ScenarioResult[]>([]);
  const [history, setHistory] = useState<ScenarioResult[]>([]);

  const multiplier = 1 + busyLevel / 100;

  useEffect(() => {
    fetchJson<{ templates: Template[] }>("/simulations/templates")
      .then((r) => setTemplates(r.templates))
      .catch(() => {});
    fetchJson<{ scenarios: ScenarioResult[] }>("/simulations/history")
      .then((r) => setHistory(r.scenarios))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!scenarioId) return;
    const t = setInterval(() => {
      fetchJson<ScenarioResult>(`/simulations/scenarios/${scenarioId}/results`)
        .then((r) => {
          setResult(r);
          if (r.status === "complete") {
            clearInterval(t);
            setCompareIds((prev) => {
              if (prev.includes(scenarioId)) return prev;
              return [...prev, scenarioId].slice(-4);
            });
            fetchJson<{ scenarios: ScenarioResult[] }>("/simulations/history")
              .then((h) => setHistory(h.scenarios))
              .catch(() => {});
          }
        })
        .catch(console.error);
    }, 500);
    return () => clearInterval(t);
  }, [scenarioId]);

  const runScenario = (name: string, overrides: Record<string, number>, template?: string) => {
    fetchJson<{ scenarioId: string }>("/simulations/scenarios", {
      method: "POST",
      body: JSON.stringify({
        name,
        createdBy: "planner-demo",
        parameterOverrides: overrides,
        template,
      }),
    })
      .then((r) => {
        setScenarioId(r.scenarioId);
        setResult(null);
      })
      .catch(console.error);
  };

  const loadComparison = () => {
    if (compareIds.length < 2) return;
    fetchJson<{ scenarios: ScenarioResult[] }>(
      `/simulations/scenarios/compare?ids=${compareIds.join(",")}`
    )
      .then((r) => setCompareResults(r.scenarios))
      .catch(() => {});
  };

  const metrics = result?.metrics;

  const metricLabels: Record<string, string> = {
    avgERWaitMinutes: "ER wait (min)",
    avgLOSDays: "Avg LOS (days)",
    peakOccupancy: "Peak occupancy",
    staffOvertimeHours: "Overtime (h)",
    equipmentUtilisation: "Equip. use",
    diversionEvents: "Diversions",
  };

  return (
    <div className="card">
      <h2 className="card-title">Plan for a busier day</h2>
      <p className="card-sub">
        Adjust parameters and run simulations. Use preset templates for common
        scenarios or compare results side-by-side.
      </p>

      {templates.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <h3 className="card-title" style={{ fontSize: "0.95rem" }}>
            Quick templates
          </h3>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {templates.map((t) => (
              <button
                key={t.id}
                type="button"
                className="btn"
                title={t.description}
                onClick={() => runScenario(t.name, t.defaultOverrides, t.id)}
              >
                {t.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="sim-control">
        <label className="field-label" htmlFor="busy">
          Admission rate: <strong>{busyLevel}%</strong> busier ({multiplier.toFixed(2)}x)
        </label>
        <input
          id="busy"
          type="range"
          min={0}
          max={80}
          value={busyLevel}
          className="sim-slider"
          onChange={(e) => setBusyLevel(Number(e.target.value))}
        />
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 8 }}>
          <label className="field-label" style={{ flex: 1, minWidth: 140 }}>
            Bed count change: <strong>{bedDelta >= 0 ? "+" : ""}{bedDelta}</strong>
            <input
              type="range"
              min={-10}
              max={20}
              value={bedDelta}
              className="sim-slider"
              onChange={(e) => setBedDelta(Number(e.target.value))}
            />
          </label>
          <label className="field-label" style={{ flex: 1, minWidth: 140 }}>
            Staff level: <strong>{staffMult}%</strong>
            <input
              type="range"
              min={50}
              max={150}
              value={staffMult}
              className="sim-slider"
              onChange={(e) => setStaffMult(Number(e.target.value))}
            />
          </label>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          style={{ marginTop: 12 }}
          onClick={() =>
            runScenario("Custom scenario", {
              admissionRateMultiplier: multiplier,
              bedCountDelta: bedDelta,
              staffLevelMultiplier: staffMult / 100,
            })
          }
        >
          Run simulation
        </button>
      </div>

      {scenarioId ? (
        <p className="muted" style={{ marginTop: 8 }}>
          Run id:{" "}
          <code style={{ color: "var(--text)" }}>
            {scenarioId.slice(0, 8)}...
          </code>
        </p>
      ) : null}

      {metrics ? (
        <div className="metric-grid">
          <div className="metric-tile">
            <div className="m-label">Typical ER wait</div>
            <div className="m-val">
              {metrics.avgERWaitMinutes?.toFixed(0)} min
            </div>
          </div>
          <div className="metric-tile">
            <div className="m-label">Avg. length of stay</div>
            <div className="m-val">
              {metrics.avgLOSDays?.toFixed(1)} days
            </div>
          </div>
          <div className="metric-tile">
            <div className="m-label">Peak crowding</div>
            <div className="m-val">
              {metrics.peakOccupancy != null
                ? `${Math.round(metrics.peakOccupancy * 100)}%`
                : "—"}
            </div>
          </div>
          <div className="metric-tile">
            <div className="m-label">Staff overtime</div>
            <div className="m-val">
              {metrics.staffOvertimeHours?.toFixed(0)} h
            </div>
          </div>
          <div className="metric-tile">
            <div className="m-label">Equipment use</div>
            <div className="m-val">
              {metrics.equipmentUtilisation != null
                ? `${Math.round(metrics.equipmentUtilisation * 100)}%`
                : "—"}
            </div>
          </div>
          <div className="metric-tile">
            <div className="m-label">Patient diversions</div>
            <div className="m-val">{metrics.diversionEvents ?? 0}</div>
          </div>
        </div>
      ) : result?.status === "pending" || result?.status === "running" ? (
        <p className="muted" style={{ marginTop: 16 }}>
          Running simulation...
        </p>
      ) : null}

      {compareIds.length >= 2 && (
        <div style={{ marginTop: 24 }}>
          <h3 className="card-title" style={{ fontSize: "0.95rem" }}>
            Scenario comparison ({compareIds.length} runs)
          </h3>
          <button
            type="button"
            className="btn btn-primary"
            onClick={loadComparison}
          >
            Compare side-by-side
          </button>
          {compareResults.length >= 2 && (
            <div style={{ overflowX: "auto", marginTop: 12 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: "6px 8px", borderBottom: "1px solid var(--border)", color: "var(--muted)" }}>
                      Metric
                    </th>
                    {compareResults.map((s) => (
                      <th
                        key={s.scenarioId}
                        style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid var(--border)", color: "var(--muted)" }}
                      >
                        {s.name.slice(0, 20)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Object.keys(metricLabels).map((key) => (
                    <tr key={key}>
                      <td style={{ padding: "6px 8px", borderBottom: "1px solid var(--border)" }}>
                        {metricLabels[key]}
                      </td>
                      {compareResults.map((s) => {
                        const v = s.metrics?.[key];
                        const display =
                          key === "peakOccupancy" || key === "equipmentUtilisation"
                            ? v != null ? `${Math.round(v * 100)}%` : "—"
                            : v != null ? v.toFixed(1) : "—";
                        return (
                          <td
                            key={s.scenarioId}
                            style={{
                              textAlign: "right",
                              padding: "6px 8px",
                              borderBottom: "1px solid var(--border)",
                              fontVariantNumeric: "tabular-nums",
                              fontWeight: 600,
                            }}
                          >
                            {display}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {history.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <h3 className="card-title" style={{ fontSize: "0.95rem" }}>
            Run history
          </h3>
          {history.slice(0, 8).map((s) => (
            <div
              key={s.scenarioId}
              style={{
                padding: "0.4rem 0.75rem",
                background: "var(--surface2)",
                borderRadius: 8,
                marginBottom: 4,
                border: "1px solid var(--border)",
                fontSize: "0.8rem",
                display: "flex",
                justifyContent: "space-between",
              }}
            >
              <span>
                <strong>{s.name}</strong> ({s.status})
              </span>
              <span className="muted">{s.scenarioId.slice(0, 8)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
