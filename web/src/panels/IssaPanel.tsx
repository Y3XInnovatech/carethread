import { useEffect, useState } from "react";
import { fetchJson } from "../api";
import { staffDisplayName } from "../labels";

interface StaffRow {
  staffId: string;
  role: string;
  specialisations: string[];
  certifications: string[];
  workloadScore: number;
  fatigueIndex: number;
  burnoutRisk: string;
  assignedPatientIds: string[];
}

interface SkillGap {
  wardId: string;
  wardName: string;
  requiredSkill: string;
  patientsNeedingSkill: number;
  qualifiedStaffCount: number;
  gap: number;
}

interface UnderstaffingAlert {
  wardId: string;
  wardName: string;
  horizonHours: number;
  currentStaff: number;
  requiredStaff: number;
  shortfall: number;
}

interface Recommendation {
  action?: string;
  fromStaffId?: string;
  toStaffId?: string;
  patientId?: string;
}

interface HandoffNote {
  noteId: string;
  patientId: string;
  fromStaffId: string;
  toStaffId: string;
  timestamp: string;
  situation: string;
  background: string;
  assessment: string;
  recommendation: string;
}

export default function IssaPanel() {
  const [data, setData] = useState<{ staff: StaffRow[] } | null>(null);
  const [rec, setRec] = useState<{
    imbalance?: boolean;
    recommendations?: Recommendation[];
    skillGaps?: SkillGap[];
    understaffing?: UnderstaffingAlert[];
  } | null>(null);

  const [handoffs, setHandoffs] = useState<HandoffNote[]>([]);
  const [hoPatientId, setHoPatientId] = useState("");
  const [hoFrom, setHoFrom] = useState("");
  const [hoTo, setHoTo] = useState("");
  const [hoSituation, setHoSituation] = useState("");
  const [hoBg, setHoBg] = useState("");
  const [hoAssess, setHoAssess] = useState("");
  const [hoRec, setHoRec] = useState("");

  useEffect(() => {
    fetchJson<{ staff: StaffRow[] }>("/twins/staff")
      .then(setData)
      .catch(console.error);
  }, []);

  return (
    <div className="grid cols-2">
      <div className="card">
        <h2 className="card-title">Who is busiest</h2>
        <p className="card-sub">
          Bars compare workload on a 0–10 scale (demo). Patient codes show
          who they are paired with.
        </p>
        {!data ? <p className="muted">Loading...</p> : null}
        {data?.staff.map((s) => (
          <div key={s.staffId} className="staff-row">
            <div className="staff-name">
              {staffDisplayName[s.staffId] ?? s.staffId}
            </div>
            <div className="bar-labels">
              <span>Workload</span>
              <span>
                {s.workloadScore.toFixed(1)} / 10 .{" "}
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
              <span
                style={{
                  width: `${Math.min(100, s.workloadScore * 10)}%`,
                }}
              />
            </div>
            <p
              className="muted"
              style={{ margin: "0.35rem 0 0", fontSize: "0.8rem" }}
            >
              Assigned: {s.assignedPatientIds.join(", ") || "—"} |
              Skills: {s.specialisations.join(", ") || "—"} |
              Certs: {s.certifications.join(", ") || "—"}
            </p>
          </div>
        ))}
      </div>
      <div className="card">
        <h2 className="card-title">Balance & coverage</h2>
        <p className="card-sub">
          Check for workload imbalances, skill gaps, and upcoming staffing shortfalls.
        </p>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() =>
            fetchJson<typeof rec>("/scheduling/recommendations")
              .then(setRec)
              .catch(console.error)
          }
        >
          Check balance
        </button>

        {rec?.imbalance && rec.recommendations?.[0] && (
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
              <strong>{rec.recommendations[0].patientId}</strong> from{" "}
              <strong>
                {staffDisplayName[rec.recommendations[0].fromStaffId ?? ""] ??
                  rec.recommendations[0].fromStaffId}
              </strong>{" "}
              to{" "}
              <strong>
                {staffDisplayName[rec.recommendations[0].toStaffId ?? ""] ??
                  rec.recommendations[0].toStaffId}
              </strong>{" "}
              to even out the day.
            </p>
          </div>
        )}

        {rec && !rec.imbalance && (
          <p className="muted" style={{ marginTop: 16 }}>
            Loads look fairly even — no change suggested.
          </p>
        )}

        {rec?.skillGaps && rec.skillGaps.length > 0 && (
          <div style={{ marginTop: 20 }}>
            <h3 className="card-title" style={{ fontSize: "0.95rem" }}>
              Skill coverage gaps
            </h3>
            {rec.skillGaps.map((g, i) => (
              <div
                key={i}
                style={{
                  padding: "0.5rem 0.75rem",
                  background: "var(--warn-dim)",
                  borderRadius: 8,
                  marginBottom: 6,
                  border: "1px solid var(--border)",
                  fontSize: "0.9rem",
                }}
              >
                <strong>{g.wardName}</strong>: needs {g.requiredSkill} ({g.patientsNeedingSkill} patients),
                only {g.qualifiedStaffCount} qualified staff. Gap: {g.gap} staff needed.
              </div>
            ))}
          </div>
        )}

        {rec?.understaffing && rec.understaffing.length > 0 && (
          <div style={{ marginTop: 20 }}>
            <h3 className="card-title" style={{ fontSize: "0.95rem" }}>
              Understaffing predictions
            </h3>
            {rec.understaffing.map((u, i) => (
              <div
                key={i}
                style={{
                  padding: "0.5rem 0.75rem",
                  background: "var(--crit-dim)",
                  borderRadius: 8,
                  marginBottom: 6,
                  border: "1px solid var(--border)",
                  fontSize: "0.9rem",
                }}
              >
                <strong>{u.wardName}</strong> in {u.horizonHours}h:
                current {u.currentStaff} staff, need {u.requiredStaff}.
                Shortfall: <strong>{u.shortfall}</strong>.
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Handoff Notes (SBAR) ─────────────────────────────────── */}
      <div className="card" style={{ gridColumn: "1 / -1" }}>
        <h2 className="card-title">Shift Handoff Notes (SBAR)</h2>
        <p className="card-sub">
          Structured Situation-Background-Assessment-Recommendation for safe shift transitions.
        </p>
        <div className="sbar-form" style={{ maxWidth: 600 }}>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <select value={hoFrom} onChange={e => setHoFrom(e.target.value)} style={{ flex: 1, padding: "0.4rem", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text)", fontFamily: "var(--font)", fontSize: "0.8rem" }}>
              <option value="">From staff...</option>
              {data?.staff.map(s => <option key={s.staffId} value={s.staffId}>{staffDisplayName[s.staffId] ?? s.staffId}</option>)}
            </select>
            <select value={hoTo} onChange={e => setHoTo(e.target.value)} style={{ flex: 1, padding: "0.4rem", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text)", fontFamily: "var(--font)", fontSize: "0.8rem" }}>
              <option value="">To staff...</option>
              {data?.staff.map(s => <option key={s.staffId} value={s.staffId}>{staffDisplayName[s.staffId] ?? s.staffId}</option>)}
            </select>
            <input value={hoPatientId} onChange={e => setHoPatientId(e.target.value)} placeholder="Patient ID (e.g. pat-1001)" style={{ flex: 1, padding: "0.4rem", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text)", fontFamily: "var(--font)", fontSize: "0.8rem" }} />
          </div>
          <textarea value={hoSituation} onChange={e => setHoSituation(e.target.value)} placeholder="Situation — current patient state" />
          <textarea value={hoBg} onChange={e => setHoBg(e.target.value)} placeholder="Background — relevant history" />
          <textarea value={hoAssess} onChange={e => setHoAssess(e.target.value)} placeholder="Assessment — clinical impression" />
          <textarea value={hoRec} onChange={e => setHoRec(e.target.value)} placeholder="Recommendation — next steps" />
          <button className="btn btn-primary" style={{ alignSelf: "flex-start" }} onClick={() => {
            if (!hoPatientId || !hoFrom || !hoTo) return;
            fetchJson("/handoffs", {
              method: "POST",
              body: JSON.stringify({ patientId: hoPatientId, fromStaffId: hoFrom, toStaffId: hoTo, situation: hoSituation, background: hoBg, assessment: hoAssess, recommendation: hoRec }),
            }).then(() => {
              fetchJson<{ notes: HandoffNote[] }>(`/handoffs/${hoPatientId}`).then(r => setHandoffs(r.notes));
              setHoSituation(""); setHoBg(""); setHoAssess(""); setHoRec("");
            }).catch(() => {});
          }}>Submit handoff note</button>
        </div>

        {handoffs.length > 0 && (
          <div style={{ marginTop: "1rem" }}>
            {handoffs.map(n => (
              <div key={n.noteId} className="handoff-card">
                <h4>{staffDisplayName[n.fromStaffId] ?? n.fromStaffId} → {staffDisplayName[n.toStaffId] ?? n.toStaffId} · {new Date(n.timestamp).toLocaleTimeString()}</h4>
                {n.situation && <p><strong>S:</strong> {n.situation}</p>}
                {n.background && <p><strong>B:</strong> {n.background}</p>}
                {n.assessment && <p><strong>A:</strong> {n.assessment}</p>}
                {n.recommendation && <p><strong>R:</strong> {n.recommendation}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
