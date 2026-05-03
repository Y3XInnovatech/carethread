import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import { fetchJson, wsUrl } from "./api";
import {
  IconBeds,
  IconChart,
  IconDroplet,
  IconHeart,
  IconPeople,
  IconPulse,
  IconThermometer,
  IconWind,
  IconWrench,
} from "./icons";
import {
  alertSeverityLabel,
  friendlyFactor,
  roomDisplayName,
  staffDisplayName,
  wardDisplayName,
} from "./labels";

type Tab = "pfo" | "cews" | "pem" | "issa" | "wise";

interface RoomRow {
  roomId: string;
  wardId: string;
  bedCount: number;
  occupiedBeds: number;
  cleaningStatus: string;
  occupancyRate: number;
  patients: { bed: string; patientId: string; displayName: string }[];
}

interface PatientOption {
  id: string;
  label: string;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

function useToast() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 4200);
    return () => clearTimeout(t);
  }, [msg]);
  return { msg, show: setMsg };
}

const TAB_COPY: Record<
  Tab,
  { title: string; blurb: string }
> = {
  pfo: {
    title: "Beds & patient flow",
    blurb:
      "See which rooms have open beds and who is where. Tap “See forecast” for a simple picture of how full a room may get in the next few hours.",
  },
  cews: {
    title: "Early warning & vitals",
    blurb:
      "Pick a patient to view a comfort-style risk dial, live vital signs, and any alerts that need a quick response.",
  },
  pem: {
    title: "Medical equipment",
    blurb:
      "Each device shows a health bar. Schedule service when something looks like it may need attention soon.",
  },
  issa: {
    title: "Team workload",
    blurb:
      "Compare how busy each nurse is and get a plain-English suggestion if the load looks uneven.",
  },
  wise: {
    title: "“What if?” planning",
    blurb:
      "Slide how busy admissions might get, then run a short sample simulation to see rough wait times and crowding.",
  },
};

export default function App() {
  const [tab, setTab] = useState<Tab>("pfo");
  const [rooms, setRooms] = useState<RoomRow[]>([]);
  const [roomsError, setRoomsError] = useState<string | null>(null);
  const [alerts, setAlerts] = useState<
    {
      alertId: string;
      severity: string;
      patientId: string;
      message: string;
      timestamp: string;
      acknowledged?: boolean;
    }[]
  >([]);
  const [selectedPatient, setSelectedPatient] = useState("pat-1001");
  const toast = useToast();

  const refreshRooms = useCallback(() => {
    fetchJson<{ rooms: RoomRow[] }>("/twins/rooms")
      .then((r) => {
        setRooms(r.rooms);
        setRoomsError(null);
      })
      .catch((e: Error) => setRoomsError(e.message));
  }, []);

  useEffect(() => {
    refreshRooms();
    const id = setInterval(refreshRooms, 15000);
    return () => clearInterval(id);
  }, [refreshRooms]);

  useEffect(() => {
    const url = wsUrl("alerts");
    const ws = new WebSocket(url);
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as {
          payload?: { alerts?: typeof alerts };
        };
        if (msg.payload?.alerts) setAlerts(msg.payload.alerts);
      } catch {
        /* ignore */
      }
    };
    return () => ws.close();
  }, []);

  const patientOptions = useMemo((): PatientOption[] => {
    const map = new Map<string, string>();
    for (const r of rooms) {
      for (const p of r.patients) {
        if (!map.has(p.patientId)) {
          map.set(p.patientId, p.displayName);
        }
      }
    }
    return [...map.entries()].map(([id, name]) => ({
      id,
      label: `${name}`,
    }));
  }, [rooms]);

  useEffect(() => {
    if (
      patientOptions.length &&
      !patientOptions.some((p) => p.id === selectedPatient)
    ) {
      setSelectedPatient(patientOptions[0]!.id);
    }
  }, [patientOptions, selectedPatient]);

  const intro = TAB_COPY[tab];

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-brand">
          <div className="app-logo" aria-hidden>
            C
          </div>
          <div>
            <h1>CareThread</h1>
            <p className="app-tagline">
              Hospital operations at a glance — demo data for training and
              walkthroughs.
            </p>
          </div>
        </div>
        <span className="badge">Practice mode · not for real patients</span>
      </header>
      <nav className="tabs" aria-label="Main sections">
        {(
          [
            ["pfo", "Beds & flow", IconBeds],
            ["cews", "Vitals & alerts", IconPulse],
            ["pem", "Equipment", IconWrench],
            ["issa", "Staff load", IconPeople],
            ["wise", "What-if", IconChart],
          ] as const
        ).map(([id, label, Ico]) => (
          <button
            key={id}
            type="button"
            className={`tab-btn ${tab === id ? "active" : ""}`}
            onClick={() => setTab(id)}
          >
            <Ico />
            {label}
          </button>
        ))}
      </nav>
      <main>
        <p className="page-intro">
          <strong>{intro.title}.</strong> {intro.blurb}
        </p>
        {tab === "pfo" && (
          <PfoPanel
            rooms={rooms}
            error={roomsError}
            onRefresh={refreshRooms}
          />
        )}
        {tab === "cews" && (
          <CewsPanel
            patientId={selectedPatient}
            patientOptions={patientOptions}
            onPatientChange={setSelectedPatient}
            alerts={alerts}
            onAck={() => refreshRooms()}
          />
        )}
        {tab === "pem" && <PemPanel onNotify={(m) => toast.show(m)} />}
        {tab === "issa" && <IssaPanel />}
        {tab === "wise" && <WisePanel />}
      </main>
      {toast.msg ? <div className="toast">{toast.msg}</div> : null}
    </div>
  );
}

function PfoPanel({
  rooms,
  error,
  onRefresh,
}: {
  rooms: RoomRow[];
  error: string | null;
  onRefresh: () => void;
}) {
  const [forecastRoomId, setForecastRoomId] = useState<string | null>(null);
  const [forecast, setForecast] = useState<{
    horizons?: { h2?: number; h4?: number; h8?: number };
    predictedOccupiedBeds?: { h2?: number; h4?: number; h8?: number };
  } | null>(null);

  const totals = useMemo(() => {
    let occ = 0;
    let cap = 0;
    for (const r of rooms) {
      occ += r.occupiedBeds;
      cap += r.bedCount;
    }
    return { occ, cap, rate: cap ? Math.round((occ / cap) * 100) : 0 };
  }, [rooms]);

  const loadForecast = (roomId: string) => {
    setForecastRoomId(roomId);
    fetchJson<{
      horizons?: { h2?: number; h4?: number; h8?: number };
      predictedOccupiedBeds?: { h2?: number; h4?: number; h8?: number };
    }>(`/twins/rooms/${roomId}/forecast`)
      .then(setForecast)
      .catch(() => setForecast(null));
  };

  const cleaningLabel = (s: string) =>
    s === "clean" ? "Ready" : s === "needs_cleaning" ? "Needs turnover" : s;

  return (
    <div className="grid cols-2">
      <div className="card">
        <h2 className="card-title">Hospital snapshot</h2>
        <p className="card-sub">
          Filled beds compared to total demo beds. Rooms below show who is in
          each bed.
        </p>
        {error ? <p className="error">{error}</p> : null}
        <div className="stat-row">
          <div className="stat-card">
            <div className="label">Beds in use</div>
            <div className="value">
              {totals.occ}
              <span> / {totals.cap}</span>
            </div>
          </div>
          <div className="stat-card">
            <div className="label">Overall fullness</div>
            <div className="value">{totals.rate}%</div>
          </div>
        </div>
        {!rooms.length && !error ? (
          <p className="muted">Loading layout…</p>
        ) : null}
        {rooms.map((r) => {
          const beds: { filled: boolean; label: string; sub?: string }[] = [];
          const byBed = new Map(r.patients.map((p) => [p.bed, p]));
          for (let i = 1; i <= r.bedCount; i++) {
            const bedId = `bed-${i}`;
            const p = byBed.get(bedId);
            beds.push({
              filled: !!p,
              label: p ? initials(p.displayName) : "—",
              sub: p?.displayName,
            });
          }
          return (
            <div key={r.roomId} className="room-card">
              <div className="room-card-head">
                <div>
                  <div className="room-name">
                    {roomDisplayName[r.roomId] ?? r.roomId}
                  </div>
                  <div className="room-ward">
                    {wardDisplayName[r.wardId] ?? r.wardId} ·{" "}
                    {cleaningLabel(r.cleaningStatus)}
                  </div>
                </div>
                <div className="room-actions">
                  <span className="pill ok">
                    {r.occupiedBeds}/{r.bedCount} filled
                  </span>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => loadForecast(r.roomId)}
                  >
                    See forecast
                  </button>
                </div>
              </div>
              <div className="bed-strip" aria-label="Beds in this room">
                {beds.map((b, idx) => (
                  <div key={idx} className="bed-slot">
                    <div
                      className={`bed-dot ${b.filled ? "bed-dot--filled" : ""}`}
                      title={b.sub ?? "Empty"}
                    >
                      {b.label}
                    </div>
                    <span className="bed-label">Bed {idx + 1}</span>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span className="muted" style={{ fontSize: "0.8rem" }}>
                  How full
                </span>
                <div className="occ-meter">
                  <span style={{ width: `${Math.min(100, r.occupancyRate * 100)}%` }} />
                </div>
              </div>
            </div>
          );
        })}
        <button type="button" className="btn" style={{ marginTop: 8 }} onClick={onRefresh}>
          Refresh numbers
        </button>
      </div>
      <div className="card">
        <h2 className="card-title">Crowding outlook</h2>
        <p className="card-sub">
          After you tap “See forecast” on a room, bars show how full that room
          might be in about 2, 4, and 8 hours (demo estimate).
        </p>
        {forecastRoomId ? (
          <p className="muted" style={{ marginBottom: 8 }}>
            Room:{" "}
            <strong>{roomDisplayName[forecastRoomId] ?? forecastRoomId}</strong>
          </p>
        ) : null}
        {forecast?.horizons ? (
          <div className="horizon-chart">
            {(
              [
                ["h2", "~2 hours"],
                ["h4", "~4 hours"],
                ["h8", "~8 hours"],
              ] as const
            ).map(([key, label]) => {
              const v = forecast.horizons?.[key] ?? 0;
              const pct = Math.min(100, Math.max(0, v * 100));
              const beds = forecast.predictedOccupiedBeds?.[key];
              return (
                <div key={key} className="horizon-row">
                  <span>{label}</span>
                  <div className="bar-wrap">
                    <div className="bar" style={{ width: `${pct}%` }} />
                  </div>
                  <span style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                    {beds != null ? `${beds} beds` : `${Math.round(pct)}%`}
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="empty-hint">
            Choose <strong>See forecast</strong> on any room to fill this chart.
          </div>
        )}
      </div>
    </div>
  );
}

function CewsPanel({
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
  }[];
  onAck: () => void;
}) {
  const [cews, setCews] = useState<Record<string, unknown> | null>(null);
  const [live, setLive] = useState<Record<string, unknown> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [reason, setReason] = useState("Reviewed — patient stable");

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
        const msg = JSON.parse(ev.data as string) as { payload?: Record<string, unknown> };
        if (msg.payload) setLive(msg.payload);
      } catch {
        /* ignore */
      }
    };
    return () => ws.close();
  }, [patientId]);

  const score = Number(cews?.cewsScore ?? 0);
  const ringP = Math.min(1, score / 14);
  const ringColor =
    score >= 7 ? "var(--crit)" : score >= 5 ? "var(--warn)" : "var(--ok)";

  const sevClass = (s: string) =>
    s === "critical" ? "sev-critical" : s === "warning" ? "sev-warning" : "sev-advisory";

  const vitals = live ?? {};
  const hr = Number(vitals.heartRate ?? vitals.hr ?? "—");
  const sys = Number(vitals.bpSystolic ?? "—");
  const dia = Number(vitals.bpDiastolic ?? "—");
  const spo2 = Number(vitals.spO2 ?? "—");
  const rr = Number(vitals.respiratoryRate ?? "—");
  const temp = Number(vitals.temperatureC ?? vitals.temp ?? "—");

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
                    Next 30 min: {Math.round(Number(cews.deteriorationProbability30m) * 100)}%
                  </span>
                  <span className="pill ok">
                    Next hour: {Math.round(Number(cews.deteriorationProbability60m) * 100)}%
                  </span>
                </div>
                <p className="muted" style={{ marginTop: "0.65rem", maxWidth: 320 }}>
                  {cews.sepsisFlag ? (
                    <>
                      <strong>Screening flag:</strong> extra checks for infection
                      may be useful (demo rule).
                    </>
                  ) : (
                    "No extra infection screen flag right now."
                  )}
                </p>
              </div>
            </div>
            <h3 className="card-title" style={{ fontSize: "0.95rem", marginTop: "1rem" }}>
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
            <h3 className="card-title" style={{ fontSize: "0.95rem", marginTop: "1.25rem" }}>
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
                    {Number.isFinite(hr) ? hr : "—"}{" "}
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
                    {Number.isFinite(spo2) ? spo2 : "—"}{" "}
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
                    {Number.isFinite(rr) ? rr : "—"}{" "}
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
                    <span className="v-unit">°C</span>
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
                Waiting for the next live update (a few seconds)…
              </p>
            ) : null}
          </>
        ) : (
          <p className="muted">Loading…</p>
        )}
      </div>
      <div className="card">
        <h2 className="card-title">Alerts inbox</h2>
        <p className="card-sub">
          When something needs attention, it appears here. Add a short note and
          tap <strong>Done</strong> to record that someone looked at it.
        </p>
        {!alerts.length ? (
          <div className="empty-hint">You’re all caught up — no open alerts.</div>
        ) : null}
        {alerts.map((a) => (
          <div key={a.alertId} className={`alert-card ${sevClass(a.severity)}`}>
            <div className="title-row">
              <span className="pill warn">{alertSeverityLabel(a.severity)}</span>
              <span className="muted" style={{ fontSize: "0.8rem" }}>
                {new Date(a.timestamp).toLocaleString()}
              </span>
            </div>
            <p className="alert-msg">{a.message}</p>
            <p className="muted" style={{ fontSize: "0.8rem", margin: 0 }}>
              Patient record: {a.patientId}
            </p>
            <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
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

function PemPanel({ onNotify }: { onNotify: (m: string) => void }) {
  const [assets, setAssets] = useState<
    {
      deviceId: string;
      deviceType: string;
      location: string;
      assetHealthScore: number;
      failureProbability24h: number;
    }[]
  >([]);

  useEffect(() => {
    fetchJson<{ assets: typeof assets }>("/twins/assets")
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
            <h3>{a.deviceType}</h3>
            <div className="device-meta">
              {roomDisplayName[a.location] ?? a.location} · {a.deviceId}
            </div>
            <div className="bar-labels">
              <span>Needs attention</span>
              <span>Healthy</span>
            </div>
            <div className="health-track">
              <span style={{ width: `${a.assetHealthScore}%` }} />
            </div>
            <p className="muted" style={{ margin: "0.35rem 0 0.75rem" }}>
              Rough chance of issue in 24h:{" "}
              <strong>{(a.failureProbability24h * 100).toFixed(0)}%</strong>
            </p>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() =>
                fetchJson<{ workOrderId?: string }>(`/assets/${a.deviceId}/maintenance`, {
                  method: "POST",
                  body: JSON.stringify({ priority: "urgent" }),
                })
                  .then((x) =>
                    onNotify(
                      `Service scheduled — ticket ${x.workOrderId?.slice(0, 8) ?? "created"}.`
                    )
                  )
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

function IssaPanel() {
  const [data, setData] = useState<{
    staff: {
      staffId: string;
      workloadScore: number;
      fatigueIndex: number;
      burnoutRisk: string;
      assignedPatientIds: string[];
    }[];
  } | null>(null);
  const [rec, setRec] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    fetchJson<typeof data>("/twins/staff")
      .then(setData)
      .catch(console.error);
  }, []);

  const recObj = rec as {
    imbalance?: boolean;
    recommendations?: {
      action?: string;
      fromStaffId?: string;
      toStaffId?: string;
      patientId?: string;
    }[];
  } | null;

  return (
    <div className="grid cols-2">
      <div className="card">
        <h2 className="card-title">Who is busiest</h2>
        <p className="card-sub">
          Bars compare workload on a 0–10 scale (demo). Patient codes show who
          they are paired with.
        </p>
        {!data ? <p className="muted">Loading…</p> : null}
        {data?.staff.map((s) => (
          <div key={s.staffId} className="staff-row">
            <div className="staff-name">{staffDisplayName[s.staffId] ?? s.staffId}</div>
            <div className="bar-labels">
              <span>Workload</span>
              <span>
                {s.workloadScore.toFixed(1)} / 10 ·{" "}
                <span
                  className={`pill ${
                    s.burnoutRisk === "high"
                      ? "crit"
                      : s.burnoutRisk === "medium"
                        ? "warn"
                        : "ok"
                  }`}
                >
                  {s.burnoutRisk === "high"
                    ? "High strain"
                    : s.burnoutRisk === "medium"
                      ? "Watch closely"
                      : "Looks OK"}
                </span>
              </span>
            </div>
            <div className="workload-bar">
              <span style={{ width: `${Math.min(100, s.workloadScore * 10)}%` }} />
            </div>
            <p className="muted" style={{ margin: "0.35rem 0 0", fontSize: "0.8rem" }}>
              Assigned patients: {s.assignedPatientIds.join(", ") || "—"}
            </p>
          </div>
        ))}
      </div>
      <div className="card">
        <h2 className="card-title">Balance suggestion</h2>
        <p className="card-sub">
          If one nurse is much busier than another, we suggest one small change
          you could consider (demo only).
        </p>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() =>
            fetchJson<Record<string, unknown>>("/scheduling/recommendations")
              .then(setRec)
              .catch(console.error)
          }
        >
          Check balance
        </button>
        {recObj?.imbalance && recObj.recommendations?.[0] ? (
          <div
            style={{
              marginTop: 16,
              padding: "1rem",
              background: "var(--surface2)",
              borderRadius: 12,
              border: "1px solid var(--border)",
            }}
          >
            <p style={{ margin: 0, fontSize: "0.95rem" }}>
              Consider moving patient{" "}
              <strong>{recObj.recommendations[0].patientId}</strong> from{" "}
              <strong>
                {staffDisplayName[recObj.recommendations[0].fromStaffId ?? ""] ??
                  recObj.recommendations[0].fromStaffId}
              </strong>{" "}
              to{" "}
              <strong>
                {staffDisplayName[recObj.recommendations[0].toStaffId ?? ""] ??
                  recObj.recommendations[0].toStaffId}
              </strong>{" "}
              to even out the day.
            </p>
          </div>
        ) : rec !== null ? (
          <p className="muted" style={{ marginTop: 16 }}>
            Loads look fairly even — no change suggested.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function WisePanel() {
  const [scenarioId, setScenarioId] = useState<string | null>(null);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [busyLevel, setBusyLevel] = useState(35);

  const multiplier = 1 + busyLevel / 100;

  useEffect(() => {
    if (!scenarioId) return;
    const t = setInterval(() => {
      fetchJson<Record<string, unknown>>(`/simulations/scenarios/${scenarioId}/results`)
        .then((r) => {
          setResult(r);
          if (r.status === "complete") clearInterval(t);
        })
        .catch(console.error);
    }, 500);
    return () => clearInterval(t);
  }, [scenarioId]);

  const metrics = result?.metrics as Record<string, number> | undefined;

  return (
    <div className="card">
      <h2 className="card-title">Plan for a busier day</h2>
      <p className="card-sub">
        Drag the slider to say how much busier admissions might be than usual.
        Then run a quick sample to see rough wait times and crowding — useful
        for tabletop exercises.
      </p>
      <div className="sim-control">
        <label className="field-label" htmlFor="busy">
          How much busier than usual? <strong>{busyLevel}%</strong> → about{" "}
          <strong>{multiplier.toFixed(2)}×</strong> usual arrivals (demo)
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
        <button
          type="button"
          className="btn btn-primary"
          onClick={() =>
            fetchJson<{ scenarioId: string }>("/simulations/scenarios", {
              method: "POST",
              body: JSON.stringify({
                name: "Busy day preview",
                createdBy: "planner-demo",
                parameterOverrides: {
                  admissionRateMultiplier: multiplier,
                  bedCountDelta: 0,
                },
              }),
            })
              .then((r) => {
                setScenarioId(r.scenarioId);
                setResult(null);
              })
              .catch(console.error)
          }
        >
          Run sample
        </button>
      </div>
      {scenarioId ? (
        <p className="muted" style={{ marginTop: 8 }}>
          Run id: <code style={{ color: "var(--text)" }}>{scenarioId.slice(0, 8)}…</code>
        </p>
      ) : null}
      {metrics ? (
        <div className="metric-grid">
          <div className="metric-tile">
            <div className="m-label">Typical ER wait (demo)</div>
            <div className="m-val">{metrics.avgERWaitMinutes?.toFixed(0)} min</div>
          </div>
          <div className="metric-tile">
            <div className="m-label">Avg. length of stay</div>
            <div className="m-val">{metrics.avgLOSDays?.toFixed(1)} days</div>
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
            <div className="m-label">Staff overtime (demo hours)</div>
            <div className="m-val">{metrics.staffOvertimeHours?.toFixed(0)} h</div>
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
            <div className="m-label">Patient diversions (demo)</div>
            <div className="m-val">{metrics.diversionEvents ?? 0}</div>
          </div>
        </div>
      ) : result?.status === "pending" ? (
        <p className="muted" style={{ marginTop: 16 }}>
          Running sample…
        </p>
      ) : null}
    </div>
  );
}
