import { useState } from "react";
import PemPanel from "../panels/PemPanel";

export default function EquipmentPage() {
  const [toast, setToast] = useState<string | null>(null);

  return (
    <div className="page-wrapper">
      <div className="page-desc">
        Each device shows a health bar and calibration status. Schedule service when something looks like it may need attention soon.
      </div>
      <PemPanel onNotify={(m) => { setToast(m); setTimeout(() => setToast(null), 4200); }} />
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
