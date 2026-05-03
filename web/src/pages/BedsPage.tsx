import { useCallback, useEffect, useState } from "react";
import { fetchJson } from "../api";
import PfoPanel from "../panels/PfoPanel";

interface RoomRow {
  roomId: string;
  wardId: string;
  bedCount: number;
  occupiedBeds: number;
  cleaningStatus: string;
  occupancyRate: number;
  patients: { bed: string; patientId: string; displayName: string }[];
}

export default function BedsPage() {
  const [rooms, setRooms] = useState<RoomRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    fetchJson<{ rooms: RoomRow[] }>("/twins/rooms")
      .then((r) => { setRooms(r.rooms); setError(null); })
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 15000);
    return () => clearInterval(id);
  }, [refresh]);

  return (
    <div className="page-wrapper">
      <div className="page-desc">
        See which rooms have open beds and who is where. Tap "See forecast" for a picture of how full a room may get in the next few hours.
      </div>
      <PfoPanel rooms={rooms} error={error} onRefresh={refresh} />
    </div>
  );
}
