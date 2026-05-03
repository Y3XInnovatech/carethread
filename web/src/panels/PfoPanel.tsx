import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchJson } from "../api";
import { roomDisplayName, wardDisplayName } from "../labels";

interface RoomRow {
  roomId: string;
  wardId: string;
  bedCount: number;
  occupiedBeds: number;
  cleaningStatus: string;
  occupancyRate: number;
  patients: { bed: string; patientId: string; displayName: string }[];
}

interface ErSurge {
  active: boolean;
  arrivalsPerHour: number;
  surgeThreshold: number;
  projectedShortages: { wardId: string; shortfallBeds: number; horizonHours: number }[];
}

interface BedSuggestion {
  roomId: string;
  wardId: string;
  bed: string;
  wardSpecialisation: string;
  score: number;
}

interface ERQueueEntry {
  entryId: string;
  patientName: string;
  arrivalTime: string;
  triageLevel: number;
  chiefComplaint: string;
  estimatedWaitMinutes: number;
  status: string;
}

interface DischargeWF {
  workflowId: string;
  patientId: string;
  patientName: string;
  status: string;
  destination: string;
  checklist: { id: string; label: string; completed: boolean }[];
}

interface TurnaroundInfo {
  turnarounds: { turnaroundId: string; roomId: string; bed: string; vacatedAt: string; readyAt?: string }[];
  activeCleaning: number;
  avgTurnaroundMinutes: number;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2)
    return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

export default function PfoPanel({
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
  const [erSurge, setErSurge] = useState<ErSurge | null>(null);
  const [bedSuggestions, setBedSuggestions] = useState<BedSuggestion[]>([]);
  const [showBedSuggest, setShowBedSuggest] = useState(false);
  const [erQueue, setErQueue] = useState<ERQueueEntry[]>([]);
  const [erQueueAvg, setErQueueAvg] = useState(0);
  const [discharges, setDischarges] = useState<DischargeWF[]>([]);
  const [turnaround, setTurnaround] = useState<TurnaroundInfo | null>(null);
  const [showDischargeFor, setShowDischargeFor] = useState<string | null>(null);
  const [dischargeDest, setDischargeDest] = useState<string>("home");

  // ER Queue add form
  const [erName, setErName] = useState("");
  const [erTriage, setErTriage] = useState(3);
  const [erComplaint, setErComplaint] = useState("");

  useEffect(() => {
    const load = () =>
      fetchJson<ErSurge>("/er/surge")
        .then(setErSurge)
        .catch(() => {});
    load();
    const id = setInterval(load, 10_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const load = () => {
      fetchJson<{ queue: ERQueueEntry[]; avgWaitMinutes: number }>("/er/queue").then(r => { setErQueue(r.queue); setErQueueAvg(r.avgWaitMinutes); }).catch(() => {});
      fetchJson<{ workflows: DischargeWF[] }>("/discharge/active").then(r => setDischarges(r.workflows)).catch(() => {});
      fetchJson<TurnaroundInfo>("/beds/turnaround").then(setTurnaround).catch(() => {});
    };
    load();
    const id = setInterval(load, 10_000);
    return () => clearInterval(id);
  }, []);

  const initiateDischarge = (patientId: string) => {
    fetchJson("/discharge/initiate", {
      method: "POST",
      body: JSON.stringify({ patientId, destination: dischargeDest }),
    }).then(() => {
      setShowDischargeFor(null);
      fetchJson<{ workflows: DischargeWF[] }>("/discharge/active").then(r => setDischarges(r.workflows));
    }).catch(() => {});
  };

  const toggleChecklistItem = (wfId: string, itemId: string, completed: boolean) => {
    fetchJson(`/discharge/${wfId}/checklist/${itemId}`, {
      method: "PUT",
      body: JSON.stringify({ completed, completedBy: "demo-user" }),
    }).then(() => {
      fetchJson<{ workflows: DischargeWF[] }>("/discharge/active").then(r => setDischarges(r.workflows));
    }).catch(() => {});
  };

  const completeDischargeWf = (wfId: string) => {
    fetchJson(`/discharge/${wfId}/complete`, { method: "PUT" }).then(() => {
      fetchJson<{ workflows: DischargeWF[] }>("/discharge/active").then(r => setDischarges(r.workflows));
      onRefresh();
    }).catch(() => {});
  };

  const addToErQueue = () => {
    if (!erName || !erComplaint) return;
    fetchJson("/er/queue", {
      method: "POST",
      body: JSON.stringify({ patientName: erName, triageLevel: erTriage, chiefComplaint: erComplaint }),
    }).then(() => {
      setErName(""); setErComplaint("");
      fetchJson<{ queue: ERQueueEntry[]; avgWaitMinutes: number }>("/er/queue").then(r => { setErQueue(r.queue); setErQueueAvg(r.avgWaitMinutes); });
    }).catch(() => {});
  };

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
    fetchJson<typeof forecast>(`/twins/rooms/${roomId}/forecast`)
      .then(setForecast)
      .catch(() => setForecast(null));
  };

  const suggestBed = useCallback(() => {
    setShowBedSuggest(true);
    fetchJson<{ suggestions: BedSuggestion[] }>("/beds/suggest", {
      method: "POST",
      body: JSON.stringify({ acuityScore: 3 }),
    })
      .then((r) => setBedSuggestions(r.suggestions))
      .catch(() => setBedSuggestions([]));
  }, []);

  const cleaningLabel = (s: string) =>
    s === "clean" ? "Ready" : s === "needs_cleaning" ? "Needs turnover" : s;

  return (
    <>
      {erSurge?.active && (
        <div className="surge-banner">
          <strong>ER surge active</strong> — {erSurge.arrivalsPerHour.toFixed(1)}{" "}
          arrivals/hr (threshold: {erSurge.surgeThreshold}).
          {erSurge.projectedShortages.map((s) => (
            <span key={s.wardId}>
              {" "}
              {wardDisplayName[s.wardId] ?? s.wardId}: {s.shortfallBeds} beds short in{" "}
              {s.horizonHours}h.
            </span>
          ))}
        </div>
      )}
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
            <p className="muted">Loading layout...</p>
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
                      {wardDisplayName[r.wardId] ?? r.wardId} .{" "}
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
                    <span
                      style={{
                        width: `${Math.min(100, r.occupancyRate * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button type="button" className="btn" onClick={onRefresh}>
              Refresh numbers
            </button>
            <button type="button" className="btn btn-primary" onClick={suggestBed}>
              Suggest bed for new patient
            </button>
          </div>
          {showBedSuggest && (
            <div style={{ marginTop: 12 }}>
              <h3 className="card-title" style={{ fontSize: "0.95rem" }}>
                Bed allocation suggestions
              </h3>
              {bedSuggestions.length === 0 ? (
                <p className="muted">No available beds found.</p>
              ) : (
                bedSuggestions.map((s, i) => (
                  <div
                    key={i}
                    style={{
                      padding: "0.5rem 0.75rem",
                      background: "var(--surface2)",
                      borderRadius: 8,
                      marginBottom: 6,
                      border: "1px solid var(--border)",
                      fontSize: "0.9rem",
                    }}
                  >
                    <strong>{roomDisplayName[s.roomId] ?? s.roomId}</strong> /{" "}
                    {s.bed} — {wardDisplayName[s.wardId] ?? s.wardId} (
                    {s.wardSpecialisation}) — score: {s.score}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
        <div className="card">
          <h2 className="card-title">Crowding outlook</h2>
          <p className="card-sub">
            After you tap "See forecast" on a room, bars show how full that room
            might be in about 2, 4, and 8 hours (demo estimate).
          </p>
          {forecastRoomId ? (
            <p className="muted" style={{ marginBottom: 8 }}>
              Room:{" "}
              <strong>
                {roomDisplayName[forecastRoomId] ?? forecastRoomId}
              </strong>
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
                    <span
                      style={{
                        textAlign: "right",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {beds != null ? `${beds} beds` : `${Math.round(pct)}%`}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="empty-hint">
              Choose <strong>See forecast</strong> on any room to fill this
              chart.
            </div>
          )}
        </div>
      </div>

      {/* ── ER Queue ─────────────────────────────────────────────── */}
      <div className="grid cols-2" style={{ marginTop: "1rem" }}>
        <div className="card">
          <h2 className="card-title">ER Queue</h2>
          <p className="card-sub">
            {erQueue.filter(e => e.status === "waiting").length} waiting · avg wait {erQueueAvg} min
          </p>
          {erQueue.length > 0 ? (
            <table className="er-queue-table">
              <thead>
                <tr><th>ESI</th><th>Patient</th><th>Complaint</th><th>Wait</th><th>Status</th></tr>
              </thead>
              <tbody>
                {erQueue.filter(e => e.status !== "admitted" && e.status !== "discharged").map(e => (
                  <tr key={e.entryId}>
                    <td><span className={`triage-badge triage-${e.triageLevel}`}>{e.triageLevel}</span></td>
                    <td>{e.patientName}</td>
                    <td>{e.chiefComplaint}</td>
                    <td>{e.estimatedWaitMinutes}m</td>
                    <td><span className="pill ok">{e.status.replace(/_/g, " ")}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted">No patients in ER queue.</p>
          )}
          <div style={{ marginTop: "0.75rem", display: "flex", gap: "0.4rem", flexWrap: "wrap", alignItems: "flex-end" }}>
            <input value={erName} onChange={e => setErName(e.target.value)} placeholder="Patient name" style={{ flex: 1, minWidth: 100, padding: "0.4rem 0.5rem", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text)", fontFamily: "var(--font)", fontSize: "0.8rem" }} />
            <select value={erTriage} onChange={e => setErTriage(+e.target.value)} style={{ padding: "0.4rem", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text)", fontFamily: "var(--font)", fontSize: "0.8rem" }}>
              <option value={1}>ESI 1</option><option value={2}>ESI 2</option><option value={3}>ESI 3</option><option value={4}>ESI 4</option><option value={5}>ESI 5</option>
            </select>
            <input value={erComplaint} onChange={e => setErComplaint(e.target.value)} placeholder="Chief complaint" style={{ flex: 2, minWidth: 120, padding: "0.4rem 0.5rem", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text)", fontFamily: "var(--font)", fontSize: "0.8rem" }} />
            <button className="btn btn-primary" onClick={addToErQueue} style={{ fontSize: "0.8rem", padding: "0.4rem 0.7rem" }}>Add</button>
          </div>
        </div>

        <div className="card">
          <h2 className="card-title">Bed Turnaround</h2>
          <p className="card-sub">
            {turnaround?.activeCleaning ?? 0} beds cleaning · avg {turnaround?.avgTurnaroundMinutes ?? 0} min turnaround
          </p>
          {turnaround && turnaround.turnarounds.filter(t => !t.readyAt).length > 0 ? (
            <div className="sandbox-list">
              {turnaround.turnarounds.filter(t => !t.readyAt).map(t => (
                <div key={t.turnaroundId} className="sandbox-list-item">
                  <span>{t.roomId} / {t.bed} — vacated {new Date(t.vacatedAt).toLocaleTimeString()}</span>
                  <button className="btn btn-primary" style={{ fontSize: "0.72rem", padding: "0.25rem 0.5rem" }}
                    onClick={() => {
                      fetchJson(`/beds/turnaround/${t.turnaroundId}/ready`, { method: "PUT" }).then(() => {
                        fetchJson<TurnaroundInfo>("/beds/turnaround").then(setTurnaround);
                        onRefresh();
                      });
                    }}>Mark ready</button>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">No beds currently in turnaround.</p>
          )}
        </div>
      </div>

      {/* ── Active Discharges ────────────────────────────────────── */}
      {(discharges.length > 0 || rooms.some(r => r.patients.length > 0)) && (
        <div className="card" style={{ marginTop: "1rem" }}>
          <h2 className="card-title">Discharge Coordination</h2>
          <p className="card-sub">
            {discharges.length} active discharge workflow{discharges.length !== 1 ? "s" : ""}. Click a patient below to start one.
          </p>

          {/* Quick discharge initiation */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", marginBottom: "0.75rem" }}>
            {rooms.flatMap(r => r.patients).map(p => (
              <button key={p.patientId} className={`btn ${showDischargeFor === p.patientId ? "btn-primary" : ""}`}
                style={{ fontSize: "0.75rem", padding: "0.3rem 0.55rem" }}
                onClick={() => setShowDischargeFor(showDischargeFor === p.patientId ? null : p.patientId)}>
                {p.displayName}
              </button>
            ))}
          </div>

          {showDischargeFor && (
            <div className="discharge-drawer">
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "0.5rem" }}>
                <label style={{ fontSize: "0.8rem", fontWeight: 600 }}>Destination:</label>
                <select value={dischargeDest} onChange={e => setDischargeDest(e.target.value)} style={{ padding: "0.35rem", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text)", fontFamily: "var(--font)", fontSize: "0.8rem" }}>
                  <option value="home">Home</option>
                  <option value="rehab">Rehab</option>
                  <option value="ltc">Long-term care</option>
                  <option value="transfer">Transfer</option>
                  <option value="ama">AMA</option>
                </select>
                <button className="btn btn-primary" style={{ fontSize: "0.8rem" }} onClick={() => initiateDischarge(showDischargeFor)}>Start discharge</button>
              </div>
            </div>
          )}

          {discharges.map(wf => (
            <div key={wf.workflowId} className="discharge-drawer" style={{ marginTop: "0.5rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                <strong style={{ fontSize: "0.85rem" }}>{wf.patientName}</strong>
                <span className="pill ok" style={{ fontSize: "0.7rem" }}>{wf.status} → {wf.destination}</span>
              </div>
              {wf.checklist.map(item => (
                <div key={item.id} className={`checklist-item ${item.completed ? "done" : ""}`}>
                  <input type="checkbox" checked={item.completed} onChange={e => toggleChecklistItem(wf.workflowId, item.id, e.target.checked)} />
                  <span>{item.label}</span>
                </div>
              ))}
              {wf.checklist.every(c => c.completed) && (
                <button className="btn btn-primary" style={{ marginTop: "0.5rem", width: "100%" }} onClick={() => completeDischargeWf(wf.workflowId)}>
                  Complete discharge & free bed
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
