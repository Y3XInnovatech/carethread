import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchJson, wsUrl } from "../api";
import CewsPanel from "../panels/CewsPanel";

interface RoomRow {
  roomId: string;
  patients: { bed: string; patientId: string; displayName: string }[];
}

export default function VitalsPage() {
  const [rooms, setRooms] = useState<RoomRow[]>([]);
  const [selectedPatient, setSelectedPatient] = useState("pat-1001");
  const [alerts, setAlerts] = useState<
    {
      alertId: string;
      severity: string;
      patientId: string;
      message: string;
      timestamp: string;
      acknowledged?: boolean;
      escalationLevel?: number;
    }[]
  >([]);

  const refreshRooms = useCallback(() => {
    fetchJson<{ rooms: RoomRow[] }>("/twins/rooms")
      .then((r) => setRooms(r.rooms))
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshRooms();
    const id = setInterval(refreshRooms, 15000);
    return () => clearInterval(id);
  }, [refreshRooms]);

  useEffect(() => {
    const ws = new WebSocket(wsUrl("alerts"));
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as {
          payload?: { alerts?: typeof alerts };
        };
        if (msg.payload?.alerts) setAlerts(msg.payload.alerts);
      } catch {}
    };
    return () => ws.close();
  }, []);

  const patientOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rooms) {
      for (const p of r.patients) {
        if (!map.has(p.patientId)) map.set(p.patientId, p.displayName);
      }
    }
    return [...map.entries()].map(([id, name]) => ({ id, label: name }));
  }, [rooms]);

  useEffect(() => {
    if (patientOptions.length && !patientOptions.some((p) => p.id === selectedPatient)) {
      setSelectedPatient(patientOptions[0]!.id);
    }
  }, [patientOptions, selectedPatient]);

  return (
    <div className="page-wrapper">
      <div className="page-desc">
        Pick a patient to view a risk dial, live vital signs, trend charts, and any alerts that need a response.
      </div>
      <CewsPanel
        patientId={selectedPatient}
        patientOptions={patientOptions}
        onPatientChange={setSelectedPatient}
        alerts={alerts}
        onAck={refreshRooms}
      />
    </div>
  );
}
