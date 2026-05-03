import { useCallback } from "react";
import { fetchJson } from "../api";
import SandboxPanel from "../panels/SandboxPanel";

export default function SandboxPage() {
  const refresh = useCallback(() => {
    fetchJson("/twins/rooms").catch(() => {});
  }, []);

  return (
    <div className="page-wrapper">
      <div className="page-desc">
        Create patients, adjust staff, trigger events, and stress-test the hospital in real time. Changes are reflected across all pages.
      </div>
      <SandboxPanel onRefresh={refresh} />
    </div>
  );
}
