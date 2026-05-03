/**
 * Simplified NEWS2-style aggregate (scale 1 SpO2, room air assumption for demo).
 * Not a certified clinical calculator — demo only.
 */

export interface Vitals {
  heartRate: number;
  bpSystolic: number;
  bpDiastolic: number;
  spO2: number;
  respiratoryRate: number;
  temperatureC: number;
  onSupplementalO2?: boolean;
  consciousness?: "alert" | "cvpu";
}

function rrScore(rr: number): number {
  if (rr <= 8) return 3;
  if (rr <= 11) return 1;
  if (rr <= 20) return 0;
  if (rr <= 24) return 2;
  return 3;
}

function spo2ScoreScale1(spo2: number, onO2: boolean): number {
  if (onO2) {
    if (spo2 <= 83) return 3;
    if (spo2 <= 85) return 2;
    if (spo2 <= 87) return 1;
    return 0;
  }
  if (spo2 <= 91) return 3;
  if (spo2 <= 93) return 2;
  if (spo2 <= 95) return 1;
  return 0;
}

function bpScore(sys: number): number {
  if (sys <= 90) return 3;
  if (sys <= 100) return 2;
  if (sys <= 110) return 1;
  if (sys <= 219) return 0;
  return 3;
}

function hrScore(hr: number): number {
  if (hr <= 40) return 3;
  if (hr <= 50) return 1;
  if (hr <= 90) return 0;
  if (hr <= 110) return 1;
  if (hr <= 130) return 2;
  return 3;
}

function tempScore(t: number): number {
  if (t <= 35) return 3;
  if (t <= 36) return 1;
  if (t <= 38) return 0;
  if (t <= 39) return 1;
  if (t <= 40) return 2;
  return 3;
}

export function computeNews2(v: Vitals): { total: number; subscores: Record<string, number> } {
  const onO2 = v.onSupplementalO2 ?? false;
  const subscores = {
    respiratoryRate: rrScore(v.respiratoryRate),
    spO2: spo2ScoreScale1(v.spO2, onO2),
    supplementalO2: onO2 ? 2 : 0,
    bloodPressure: bpScore(v.bpSystolic),
    heartRate: hrScore(v.heartRate),
    consciousness: v.consciousness === "cvpu" ? 3 : 0,
    temperature: tempScore(v.temperatureC),
  };
  const total = Object.values(subscores).reduce((a, b) => a + b, 0);
  return { total, subscores };
}

export function contributingFactors(
  subscores: Record<string, number>
): { feature: string; weight: number }[] {
  return Object.entries(subscores)
    .filter(([, w]) => w > 0)
    .map(([feature, weight]) => ({ feature, weight }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 5);
}
