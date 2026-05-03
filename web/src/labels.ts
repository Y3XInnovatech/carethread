/** Plain-language labels for demo UI (not clinical certification). */

export const wardDisplayName: Record<string, string> = {
  "ward-med-a": "Medical Ward A",
  "ward-icu": "Intensive Care",
};

export const roomDisplayName: Record<string, string> = {
  "room-101": "Room 101",
  "room-102": "Room 102",
  "icu-01": "ICU Bay 1",
};

export const staffDisplayName: Record<string, string> = {
  "staff-nurse-01": "Elena Garcia, RN",
  "staff-nurse-02": "Second shift RN",
  "staff-icu-01": "ICU specialist RN",
};

export const factorPlainEnglish: Record<string, string> = {
  respiratoryRate: "Breathing rate",
  spO2: "Blood oxygen",
  bloodPressure: "Blood pressure",
  heartRate: "Heart rate",
  temperature: "Temperature",
  consciousness: "Alertness",
  supplementalO2: "Extra oxygen",
};

export function friendlyFactor(key: string): string {
  return factorPlainEnglish[key] ?? key.replace(/([A-Z])/g, " $1").trim();
}

export function alertSeverityLabel(s: string): string {
  if (s === "critical") return "Urgent";
  if (s === "warning") return "Needs attention";
  if (s === "advisory") return "Heads-up";
  return s;
}
