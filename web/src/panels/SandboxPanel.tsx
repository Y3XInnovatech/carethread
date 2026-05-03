import { useCallback, useEffect, useState } from "react";
import { fetchJson } from "../api";

interface RoomInfo {
  roomId: string;
  wardId: string;
  bedCount: number;
  occupiedBeds: number;
  patients: { bed: string; patientId: string; displayName: string }[];
}

interface StaffInfo {
  staffId: string;
  role: string;
  specialisations: string[];
  currentWardId: string;
  workloadScore: number;
}

interface AssetInfo {
  deviceId: string;
  deviceType: string;
  location: string;
  assetHealthScore: number;
  maintenanceStatus: string;
}

function Collapsible({ title, children, defaultOpen }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  return (
    <div className="sandbox-section">
      <div className={`collapsible-header ${open ? "open" : ""}`} onClick={() => setOpen(!open)}>
        <span>{title}</span>
        <span className="chevron">{open ? "▲" : "▼"}</span>
      </div>
      {open && <div className="collapsible-body">{children}</div>}
    </div>
  );
}

export default function SandboxPanel({ onRefresh }: { onRefresh: () => void }) {
  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  const [staff, setStaff] = useState<StaffInfo[]>([]);
  const [assets, setAssets] = useState<AssetInfo[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Patient form
  const [pName, setPName] = useState("New Patient");
  const [pAge, setPAge] = useState(50);
  const [pAcuity, setPAcuity] = useState(3);
  const [pWard, setPWard] = useState("");
  const [pRoom, setPRoom] = useState("");
  const [pBed, setPBed] = useState("");

  // Staff form
  const [sRole, setSRole] = useState("RN");
  const [sWard, setSWard] = useState("");
  const [sSpecs, setSSpecs] = useState("");

  // Asset form
  const [aType, setAType] = useState("Monitor");
  const [aLocation, setALocation] = useState("");
  const [aHealth, setAHealth] = useState(85);

  // ER params
  const [erArrivals, setErArrivals] = useState(8.2);
  const [erThreshold, setErThreshold] = useState(12);

  const refresh = useCallback(() => {
    fetchJson<{ rooms: RoomInfo[] }>("/twins/rooms").then(r => setRooms(r.rooms)).catch(() => {});
    fetchJson<{ staff: StaffInfo[] }>("/twins/staff").then(r => setStaff(r.staff)).catch(() => {});
    fetchJson<{ assets: AssetInfo[] }>("/twins/assets").then(r => setAssets(r.assets)).catch(() => {});
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const wards = [...new Set(rooms.map(r => r.wardId))];
  const filteredRooms = pWard ? rooms.filter(r => r.wardId === pWard) : rooms;
  const selectedRoom = filteredRooms.find(r => r.roomId === pRoom);
  const occupiedBedIds = new Set(selectedRoom?.patients.map(p => p.bed) ?? []);
  const emptyBeds: string[] = [];
  if (selectedRoom) {
    for (let i = 1; i <= selectedRoom.bedCount; i++) {
      const bed = `bed-${i}`;
      if (!occupiedBedIds.has(bed)) emptyBeds.push(bed);
    }
  }

  useEffect(() => {
    if (wards.length && !pWard) setPWard(wards[0]!);
    if (wards.length && !sWard) setSWard(wards[0]!);
  }, [wards.length]);

  useEffect(() => {
    if (filteredRooms.length && !filteredRooms.find(r => r.roomId === pRoom)) {
      setPRoom(filteredRooms[0]?.roomId ?? "");
    }
  }, [pWard]);

  useEffect(() => {
    if (emptyBeds.length && !emptyBeds.includes(pBed)) {
      setPBed(emptyBeds[0] ?? "");
    }
  }, [pRoom]);

  const flash = (msg: string) => {
    setStatus(msg);
    setTimeout(() => setStatus(null), 3500);
  };

  const action = async (fn: () => Promise<void>) => {
    setLoading(true);
    try { await fn(); refresh(); onRefresh(); } catch (e: unknown) { flash(`Error: ${e}`); }
    setLoading(false);
  };

  const admitPatient = () => action(async () => {
    await fetchJson("/sandbox/patients", {
      method: "POST",
      body: JSON.stringify({ name: pName, age: pAge, acuity: pAcuity, wardId: pWard, roomId: pRoom, bed: pBed }),
    });
    flash(`Admitted ${pName} → ${pRoom} / ${pBed}`);
  });

  const dischargePatient = (id: string, name: string) => action(async () => {
    await fetchJson(`/sandbox/patients/${id}`, { method: "DELETE" });
    flash(`Discharged ${name}`);
  });

  const addStaffMember = () => action(async () => {
    await fetchJson("/sandbox/staff", {
      method: "POST",
      body: JSON.stringify({ role: sRole, wardId: sWard, specialisations: sSpecs.split(",").map(s => s.trim()).filter(Boolean), certifications: [] }),
    });
    flash(`Added ${sRole} to ${sWard}`);
  });

  const removeStaffMember = (id: string) => action(async () => {
    await fetchJson(`/sandbox/staff/${id}`, { method: "DELETE" });
    flash(`Removed staff ${id}`);
  });

  const addDevice = () => action(async () => {
    await fetchJson("/sandbox/assets", {
      method: "POST",
      body: JSON.stringify({ deviceType: aType, location: aLocation || rooms[0]?.roomId || "ward-med-a", assetHealthScore: aHealth }),
    });
    flash(`Added ${aType}`);
  });

  const removeDevice = (id: string) => action(async () => {
    await fetchJson(`/sandbox/assets/${id}`, { method: "DELETE" });
    flash(`Removed ${id}`);
  });

  const quickPatientSpike = () => action(async () => {
    const r = await fetchJson<{ count: number }>("/sandbox/events/patient-spike", {
      method: "POST",
      body: JSON.stringify({ count: 3, acuityRange: [2, 6] }),
    });
    flash(`Created ${r.count} patients`);
  });

  const quickAdmitRandom = () => action(async () => {
    const names = ["Alex Kim", "Jordan Lee", "Sam Rivera", "Taylor Chen", "Morgan Patel"];
    const name = names[Math.floor(Math.random() * names.length)]!;
    const emptyBed = findAnyEmptyBed();
    if (!emptyBed) { flash("No empty beds available"); return; }
    await fetchJson("/sandbox/patients", {
      method: "POST",
      body: JSON.stringify({ name, age: 30 + Math.floor(Math.random() * 40), acuity: 1 + Math.floor(Math.random() * 6), wardId: emptyBed.wardId, roomId: emptyBed.roomId, bed: emptyBed.bed }),
    });
    flash(`Admitted ${name}`);
  });

  const quickEquipFailure = () => action(async () => {
    if (!assets.length) { flash("No assets to fail"); return; }
    const a = assets[Math.floor(Math.random() * assets.length)]!;
    await fetchJson("/sandbox/events/equipment-failure", {
      method: "POST",
      body: JSON.stringify({ deviceId: a.deviceId }),
    });
    flash(`${a.deviceType} (${a.deviceId}) failed!`);
  });

  const quickSurge = () => action(async () => {
    await fetchJson("/sandbox/events/surge", { method: "POST" });
    flash("ER surge activated!");
  });

  const quickReset = () => {
    if (!confirm("Reset all sandbox changes to defaults?")) return;
    action(async () => {
      await fetchJson("/sandbox/reset", { method: "POST" });
      flash("Reset to defaults");
    });
  };

  const applyErMetrics = () => action(async () => {
    await fetchJson("/sandbox/er-metrics", {
      method: "PUT",
      body: JSON.stringify({ arrivalsPerHour: erArrivals, surgeThreshold: erThreshold }),
    });
    flash(`ER: ${erArrivals}/hr, threshold ${erThreshold}`);
  });

  function findAnyEmptyBed() {
    for (const room of rooms) {
      const occupied = new Set(room.patients.map(p => p.bed));
      for (let i = 1; i <= room.bedCount; i++) {
        const bed = `bed-${i}`;
        if (!occupied.has(bed)) return { wardId: room.wardId, roomId: room.roomId, bed };
      }
    }
    return null;
  }

  const allPatients = rooms.flatMap(r => r.patients.map(p => ({ ...p, roomId: r.roomId, wardId: r.wardId })));

  return (
    <>
      {status && <div className="toast">{status}</div>}

      <div className="sandbox-quick-grid">
        <button className="btn" onClick={quickAdmitRandom} disabled={loading}>+ Admit random patient</button>
        <button className="btn" onClick={quickPatientSpike} disabled={loading}>+ Patient spike (3)</button>
        <button className="btn btn-warn" onClick={quickEquipFailure} disabled={loading}>⚡ Equipment failure</button>
        <button className="btn btn-danger" onClick={quickSurge} disabled={loading}>🚨 Force ER surge</button>
        <button className="btn" onClick={quickReset} disabled={loading}>↺ Reset to defaults</button>
      </div>

      <div className="grid cols-2">
        <div>
          <Collapsible title="Admit Patient" defaultOpen>
            <div className="sandbox-form">
              <div className="field">
                <label>Name</label>
                <input value={pName} onChange={e => setPName(e.target.value)} />
              </div>
              <div className="field">
                <label>Age</label>
                <input type="number" value={pAge} onChange={e => setPAge(+e.target.value)} min={1} max={120} />
              </div>
              <div className="field full">
                <label>Acuity (NEWS2 target): {pAcuity}</label>
                <input type="range" min={0} max={10} value={pAcuity} onChange={e => setPAcuity(+e.target.value)} />
              </div>
              <div className="field">
                <label>Ward</label>
                <select value={pWard} onChange={e => setPWard(e.target.value)}>
                  {wards.map(w => <option key={w} value={w}>{w}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Room</label>
                <select value={pRoom} onChange={e => setPRoom(e.target.value)}>
                  {filteredRooms.map(r => <option key={r.roomId} value={r.roomId}>{r.roomId} ({r.occupiedBeds}/{r.bedCount})</option>)}
                </select>
              </div>
              <div className="field">
                <label>Bed</label>
                <select value={pBed} onChange={e => setPBed(e.target.value)}>
                  {emptyBeds.length ? emptyBeds.map(b => <option key={b} value={b}>{b}</option>) : <option value="">No empty beds</option>}
                </select>
              </div>
              <div className="field full">
                <button className="btn-primary" onClick={admitPatient} disabled={loading || !pBed}>Admit patient</button>
              </div>
            </div>
          </Collapsible>

          <Collapsible title={`Current Patients (${allPatients.length})`}>
            <div className="sandbox-list">
              {allPatients.map(p => (
                <div key={p.patientId} className="sandbox-list-item">
                  <span>{p.displayName} <span style={{ color: "var(--muted)", fontSize: "0.72rem" }}>{p.roomId}/{p.bed}</span></span>
                  <button className="btn-danger" onClick={() => dischargePatient(p.patientId, p.displayName)} disabled={loading}>Discharge</button>
                </div>
              ))}
              {!allPatients.length && <div style={{ color: "var(--muted)", fontSize: "0.82rem" }}>No patients</div>}
            </div>
          </Collapsible>
        </div>

        <div>
          <Collapsible title="Add Staff">
            <div className="sandbox-form">
              <div className="field">
                <label>Role</label>
                <select value={sRole} onChange={e => setSRole(e.target.value)}>
                  <option value="RN">RN (Nurse)</option>
                  <option value="MD">MD (Doctor)</option>
                  <option value="Tech">Technician</option>
                  <option value="CNA">CNA</option>
                </select>
              </div>
              <div className="field">
                <label>Ward</label>
                <select value={sWard} onChange={e => setSWard(e.target.value)}>
                  {wards.map(w => <option key={w} value={w}>{w}</option>)}
                </select>
              </div>
              <div className="field full">
                <label>Specialisations (comma-separated)</label>
                <input value={sSpecs} onChange={e => setSSpecs(e.target.value)} placeholder="ICU, ACLS, IV certified" />
              </div>
              <div className="field full">
                <button className="btn-primary" onClick={addStaffMember} disabled={loading}>Add staff</button>
              </div>
            </div>
            <div className="sandbox-list" style={{ marginTop: "0.75rem" }}>
              {staff.map(s => (
                <div key={s.staffId} className="sandbox-list-item">
                  <span>{s.role} <span style={{ color: "var(--muted)", fontSize: "0.72rem" }}>{s.staffId} — {s.currentWardId}</span></span>
                  <button className="btn-danger" onClick={() => removeStaffMember(s.staffId)} disabled={loading}>Remove</button>
                </div>
              ))}
            </div>
          </Collapsible>

          <Collapsible title="Add Equipment">
            <div className="sandbox-form">
              <div className="field">
                <label>Device Type</label>
                <select value={aType} onChange={e => setAType(e.target.value)}>
                  <option value="Monitor">Patient Monitor</option>
                  <option value="Ventilator">Ventilator</option>
                  <option value="Infusion Pump">Infusion Pump</option>
                  <option value="Defibrillator">Defibrillator</option>
                  <option value="Ultrasound">Ultrasound</option>
                </select>
              </div>
              <div className="field">
                <label>Location</label>
                <input value={aLocation} onChange={e => setALocation(e.target.value)} placeholder="icu-01" />
              </div>
              <div className="field full">
                <label>Health Score: {aHealth}%</label>
                <input type="range" min={0} max={100} value={aHealth} onChange={e => setAHealth(+e.target.value)} />
              </div>
              <div className="field full">
                <button className="btn-primary" onClick={addDevice} disabled={loading}>Add device</button>
              </div>
            </div>
            <div className="sandbox-list" style={{ marginTop: "0.75rem" }}>
              {assets.map(a => (
                <div key={a.deviceId} className="sandbox-list-item">
                  <span>{a.deviceType} <span style={{ color: "var(--muted)", fontSize: "0.72rem" }}>{a.deviceId} — {a.assetHealthScore}%</span></span>
                  <button className="btn-danger" onClick={() => removeDevice(a.deviceId)} disabled={loading}>Remove</button>
                </div>
              ))}
            </div>
          </Collapsible>

          <Collapsible title="System Parameters">
            <div className="sandbox-form">
              <div className="field full">
                <label>ER Arrivals/hr: {erArrivals}</label>
                <input type="range" min={0} max={30} step={0.5} value={erArrivals} onChange={e => setErArrivals(+e.target.value)} />
              </div>
              <div className="field full">
                <label>Surge Threshold: {erThreshold}</label>
                <input type="range" min={5} max={25} step={1} value={erThreshold} onChange={e => setErThreshold(+e.target.value)} />
              </div>
              <div className="field full">
                <button className="btn-primary" onClick={applyErMetrics} disabled={loading}>Apply ER settings</button>
              </div>
            </div>
          </Collapsible>
        </div>
      </div>
    </>
  );
}
