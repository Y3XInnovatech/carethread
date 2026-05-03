import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { fetchJson, wsUrl } from "../api";
import {
  IconDroplet,
  IconHeart,
  IconPulse,
  IconThermometer,
  IconWind,
} from "../icons";
import { alertSeverityLabel, friendlyFactor } from "../labels";

interface PatientOption {
  id: string;
  label: string;
}

interface VitalsReading {
  timestamp: string;
  heartRate: number;
  bpSystolic: number;
  bpDiastolic: number;
  spO2: number;
  respiratoryRate: number;
  temperatureC: number;
  cewsScore: number;
}

function Sparkline({
  data,
  min,
  max,
  color,
  thresholdLow,
  thresholdHigh,
}: {
  data: number[];
  min: number;
  max: number;
  color: string;
  thresholdLow?: number;
  thresholdHigh?: number;
}) {
  if (data.length < 2) return null;
  const w = 200;
  const h = 48;
  const range = max - min || 1;
  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - ((v - min) / range) * h;
      return `${x},${y}`;
    })
    .join(" ");

  const thresholdLines: JSX.Element[] = [];
  if (thresholdLow != null) {
    const y = h - ((thresholdLow - min) / range) * h;
    thresholdLines.push(
      <line key="lo" x1={0} x2={w} y1={y} y2={y} stroke="var(--warn)" strokeWidth={0.8} strokeDasharray="4 2" />
    );
  }
  if (thresholdHigh != null) {
    const y = h - ((thresholdHigh - min) / range) * h;
    thresholdLines.push(
      <line key="hi" x1={0} x2={w} y1={y} y2={y} stroke="var(--crit)" strokeWidth={0.8} strokeDasharray="4 2" />
    );
  }

  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", height: 48 }} preserveAspectRatio="none">
      {thresholdLines}
      <polyline fill="none" stroke={color} strokeWidth={1.5} points={points} />
    </svg>
  );
}

export default function CewsPanel({
  patientId,
  patientOptions,
  onPatientChange,
  alerts,
  onAck,
}: {
  patientId: string;
  patientOptions: PatientOption[];
  onPatientChange: (id: string) => void;
  alerts: {
    alertId: string;
    severity: string;
    patientId: string;
    message: string;
    timestamp: string;
    acknowledged?: boolean;
    escalationLevel?: number;
  }[];
  onAck: () => void;
}) {
  const [cews, setCews] = useState<Record<string, unknown> | null>(null);
  const [live, setLive] = useState<Record<string, unknown> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [reason, setReason] = useState("Reviewed — patient stable");
  const [history, setHistory] = useState<VitalsReading[]>([]);
  const [showTrends, setShowTrends] = useState(false);

  const load = useCallback(() => {
    fetchJson<Record<string, unknown>>(`/twins/patients/${patientId}/cews`)
      .then(setCews)
      .catch((e: Error) => setErr(e.message));
  }, [patientId]);

  useEffect(() => {
    load();
    const id = setInterval(load, 10000);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    const url = wsUrl("vitals", { patientId });
    const ws = new WebSocket(url);
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as {
          payload?: Record<string, unknown>;
        };
        if (msg.payload) setLive(msg.payload);
      } catch {
        /* ignore */
      }
    };
    return () => ws.close();
  }, [patientId]);

  useEffect(() => {
    if (!showTrends) return;
    fetchJson<{ readings: VitalsReading[] }>(
      `/twins/patients/${patientId}/vitals/history?hours=1`
    )
      .then((r) => setHistory(r.readings))
      .catch(() => setHistory([]));
    const id = setInterval(() => {
      fetchJson<{ readings: VitalsReading[] }>(
        `/twins/patients/${patientId}/vitals/history?hours=1`
      )
        .then((r) => setHistory(r.readings))
        .catch(() => {});
    }, 15000);
    return () => clearInterval(id);
  }, [patientId, showTrends]);

  const score = Number(cews?.cewsScore ?? 0);
  const ringP = Math.min(1, score / 14);
  const ringColor =
    score >= 7 ? "var(--crit)" : score >= 5 ? "var(--warn)" : "var(--ok)";

  const sevClass = (s: string) =>
    s === "critical"
      ? "sev-critical"
      : s === "warning"
      ? "sev-warning"
      : "sev-advisory";

  const vitals = live ?? {};
  const hr = Number(vitals.heartRate ?? vitals.hr ?? NaN);
  const sys = Number(vitals.bpSystolic ?? NaN);
  const dia = Number(vitals.bpDiastolic ?? NaN);
  const spo2 = Number(vitals.spO2 ?? NaN);
  const rr = Number(vitals.respiratoryRate ?? NaN);
  const temp = Number(vitals.temperatureC ?? vitals.temp ?? NaN);

  return (
    <div className="grid cols-2">
      <div className="card">
        <h2 className="card-title">Patient watch</h2>
        <p className="card-sub">
          Choose someone on the unit. The dial summarizes the early-warning
          score; tiles update every few seconds in this demo.
        </p>
        <label className="field-label" htmlFor="pt">
          Patient
        </label>
        <select
          id="pt"
          className="input"
          style={{ width: "100%", maxWidth: 360 }}
          value={patientId}
          onChange={(e) => onPatientChange(e.target.value)}
        >
          {patientOptions.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        {err ? <p className="error">{err}</p> : null}
        {cews ? (
          <>
            <div className="score-wrap">
              <div
                className="score-ring"
                style={
                  {
                    "--p": ringP,
                    "--ring-color": ringColor,
                  } as CSSProperties
                }
              >
                <div className="score-ring-inner">
                  <div className="num">{score}</div>
                  <div className="lbl">Risk score</div>
                </div>
              </div>
              <div>
                <div className="risk-badges">
                  <span className="pill ok">
                    Next 30 min:{" "}
                    {Math.round(
                      Number(cews.deteriorationProbability30m) * 100
                    )}
                    %
                  </span>
                  <span className="pill ok">
                    Next hour:{" "}
                    {Math.round(
                      Number(cews.deteriorationProbability60m) * 100
                    )}
                    %
                  </span>
                </div>
                <p
                  className="muted"
                  style={{ marginTop: "0.65rem", maxWidth: 320 }}
                >
                  {cews.sepsisFlag ? (
                    <>
                      <strong>Screening flag:</strong> extra checks for
                      infection may be useful (demo rule).
                    </>
                  ) : (
                    "No extra infection screen flag right now."
                  )}
                </p>
              </div>
            </div>
            <h3
              className="card-title"
              style={{ fontSize: "0.95rem", marginTop: "1rem" }}
            >
              What is driving the score
            </h3>
            <ul className="factor-list">
              {(
                cews.contributingFactors as
                  | { feature: string; relativeWeight: number }[]
                  | undefined
              )?.map((c) => (
                <li key={c.feature}>
                  <span>{friendlyFactor(c.feature)}</span>
                  <span className="factor-w">+{c.relativeWeight}</span>
                </li>
              ))}
            </ul>
            <h3
              className="card-title"
              style={{ fontSize: "0.95rem", marginTop: "1.25rem" }}
            >
              Live vitals
            </h3>
            <div className="vital-grid">
              <div className="vital-tile">
                <span className="ic">
                  <IconHeart />
                </span>
                <div>
                  <div className="v-label">Heart rate</div>
                  <div className="v-value">
                    {Number.isFinite(hr) ? hr.toFixed(0) : "—"}{" "}
                    <span className="v-unit">bpm</span>
                  </div>
                </div>
              </div>
              <div className="vital-tile">
                <span className="ic">
                  <IconDroplet />
                </span>
                <div>
                  <div className="v-label">Oxygen</div>
                  <div className="v-value">
                    {Number.isFinite(spo2) ? spo2.toFixed(1) : "—"}{" "}
                    <span className="v-unit">%</span>
                  </div>
                </div>
              </div>
              <div className="vital-tile">
                <span className="ic">
                  <IconWind />
                </span>
                <div>
                  <div className="v-label">Breathing</div>
                  <div className="v-value">
                    {Number.isFinite(rr) ? rr.toFixed(0) : "—"}{" "}
                    <span className="v-unit">/min</span>
                  </div>
                </div>
              </div>
              <div className="vital-tile">
                <span className="ic">
                  <IconThermometer />
                </span>
                <div>
                  <div className="v-label">Temperature</div>
                  <div className="v-value">
                    {Number.isFinite(temp) ? temp.toFixed(1) : "—"}{" "}
                    <span className="v-unit">&deg;C</span>
                  </div>
                </div>
              </div>
              <div className="vital-tile">
                <span className="ic">
                  <IconPulse />
                </span>
                <div>
                  <div className="v-label">Blood pressure</div>
                  <div className="v-value">
                    {Number.isFinite(sys) && Number.isFinite(dia)
                      ? `${Math.round(sys)}/${Math.round(dia)}`
                      : "—"}{" "}
                    <span className="v-unit">mmHg</span>
                  </div>
                </div>
              </div>
            </div>
            {!live ? (
              <p className="muted" style={{ marginTop: 10 }}>
                Waiting for the next live update (a few seconds)...
              </p>
            ) : null}

            <button
              type="button"
              className="btn"
              style={{ marginTop: 12 }}
              onClick={() => setShowTrends(!showTrends)}
            >
              {showTrends ? "Hide trends" : "Show trend charts"}
            </button>

            {showTrends && history.length > 1 && (
              <div style={{ marginTop: 12 }}>
                <h3 className="card-title" style={{ fontSize: "0.95rem" }}>
                  Vital sign trends (last hour)
                </h3>
                {(
                  [
                    { key: "heartRate" as const, label: "Heart rate (bpm)", color: "var(--crit)", min: 40, max: 160, thresholdLow: undefined, thresholdHigh: 130 },
                    { key: "spO2" as const, label: "SpO2 (%)", color: "var(--accent)", min: 85, max: 100, thresholdLow: 92, thresholdHigh: undefined },
                    { key: "respiratoryRate" as const, label: "Resp. rate (/min)", color: "var(--ok)", min: 8, max: 36, thresholdLow: undefined, thresholdHigh: 25 },
                    { key: "temperatureC" as const, label: "Temperature (°C)", color: "var(--warn)", min: 35, max: 41, thresholdLow: undefined, thresholdHigh: 39 },
                    { key: "cewsScore" as const, label: "CEWS score", color: "#818cf8", min: 0, max: 20, thresholdLow: undefined, thresholdHigh: 7 },
                  ] as const
                ).map((cfg) => (
                  <div key={cfg.key} style={{ marginBottom: 10 }}>
                    <div className="muted" style={{ fontSize: "0.75rem", marginBottom: 2 }}>
                      {cfg.label}
                    </div>
                    <Sparkline
                      data={history.map((r) => r[cfg.key])}
                      min={cfg.min}
                      max={cfg.max}
                      color={cfg.color}
                      thresholdLow={cfg.thresholdLow}
                      thresholdHigh={cfg.thresholdHigh}
                    />
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <p className="muted">Loading...</p>
        )}
      </div>
      <div className="card">
        <h2 className="card-title">Alerts inbox</h2>
        <p className="card-sub">
          When something needs attention, it appears here. Add a short note and
          tap <strong>Done</strong> to record that someone looked at it.
        </p>
        {!alerts.length ? (
          <div className="empty-hint">
            You're all caught up — no open alerts.
          </div>
        ) : null}
        {alerts.map((a) => (
          <div
            key={a.alertId}
            className={`alert-card ${sevClass(a.severity)}`}
          >
            <div className="title-row">
              <span className="pill warn">
                {alertSeverityLabel(a.severity)}
              </span>
              {(a.escalationLevel ?? 0) > 0 && (
                <span className="pill crit" style={{ fontSize: "0.7rem" }}>
                  Escalated x{a.escalationLevel}
                </span>
              )}
              <span className="muted" style={{ fontSize: "0.8rem" }}>
                {new Date(a.timestamp).toLocaleString()}
              </span>
            </div>
            <p className="alert-msg">{a.message}</p>
            <p className="muted" style={{ fontSize: "0.8rem", margin: 0 }}>
              Patient record: {a.patientId || "System-wide"}
            </p>
            <div
              style={{
                marginTop: 12,
                display: "flex",
                gap: 8,
                flexWrap: "wrap",
              }}
            >
              <input
                className="input"
                style={{ flex: 1, minWidth: 180 }}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="What did you do or see?"
              />
              <button
                type="button"
                className="btn btn-primary"
                onClick={() =>
                  fetchJson(`/alerts/${a.alertId}/acknowledge`, {
                    method: "POST",
                    body: JSON.stringify({
                      userId: "demo-clinician",
                      reasonCode: reason,
                    }),
                  })
                    .then(() => onAck())
                    .catch(console.error)
                }
              >
                Done — log review
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
