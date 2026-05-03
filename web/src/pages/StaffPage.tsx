import IssaPanel from "../panels/IssaPanel";

export default function StaffPage() {
  return (
    <div className="page-wrapper">
      <div className="page-desc">
        Compare how busy each team member is, check skill coverage gaps, and get staffing predictions.
      </div>
      <IssaPanel />
    </div>
  );
}
