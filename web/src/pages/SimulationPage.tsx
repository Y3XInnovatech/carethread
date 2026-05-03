import WisePanel from "../panels/WisePanel";

export default function SimulationPage() {
  return (
    <div className="page-wrapper">
      <div className="page-desc">
        Run simulations with custom parameters or preset templates, then compare results side-by-side.
      </div>
      <WisePanel />
    </div>
  );
}
