import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth";
import AppLayout from "./layouts/AppLayout";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import BedsPage from "./pages/BedsPage";
import VitalsPage from "./pages/VitalsPage";
import EquipmentPage from "./pages/EquipmentPage";
import StaffPage from "./pages/StaffPage";
import SimulationPage from "./pages/SimulationPage";
import SandboxPage from "./pages/SandboxPage";

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="app-loading"><div className="app-loading-spinner" /></div>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function PublicOnly({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="app-loading"><div className="app-loading-spinner" /></div>;
  if (user) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<PublicOnly><LoginPage /></PublicOnly>} />
          <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
            <Route index element={<DashboardPage />} />
            <Route path="beds" element={<BedsPage />} />
            <Route path="vitals" element={<VitalsPage />} />
            <Route path="equipment" element={<EquipmentPage />} />
            <Route path="staff" element={<StaffPage />} />
            <Route path="simulation" element={<SimulationPage />} />
            <Route path="sandbox" element={<SandboxPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
