import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { DEMO_DATA_DIR } from "./paths.js";
import type { DemoEhrIndex } from "./fhir/loadDemoEhr.js";
import {
  computeNews2,
  contributingFactors,
  type Vitals,
} from "./cews/news2.js";

export type AlertSeverity = "advisory" | "warning" | "critical";

export interface RuntimeAlert {
  alertId: string;
  severity: AlertSeverity;
  type: string;
  patientId: string;
  timestamp: string;
  acknowledged: boolean;
  acknowledgedBy?: string;
  acknowledgedAt?: string;
  responseCode?: string;
  message: string;
  escalationLevel: number;
  escalatedAt?: string;
}

export interface VitalsReading {
  timestamp: string;
  heartRate: number;
  bpSystolic: number;
  bpDiastolic: number;
  spO2: number;
  respiratoryRate: number;
  temperatureC: number;
  cewsScore: number;
}

export interface PatientRuntime {
  patientId: string;
  vitals: Vitals;
  cewsScore: number;
  deteriorationProb30m: number;
  deteriorationProb60m: number;
  sepsisFlag: boolean;
  fallRiskScore: number;
  lastUpdated: string;
}

export interface OperationalSeed {
  wards: {
    id: string;
    name: string;
    specialisation: string;
    capacity: number;
    staffRatio: number;
  }[];
  rooms: {
    id: string;
    wardId: string;
    bedCount: number;
    occupiedBeds: number;
    roomType: string;
    cleaningStatus: string;
    bedPatientMap: Record<string, string>;
  }[];
  staff: {
    staffId: string;
    role: string;
    specialisations: string[];
    certifications: string[];
    shiftPattern: string;
    currentWardId: string;
    assignedPatientIds: string[];
  }[];
  assets: {
    deviceId: string;
    deviceType: string;
    manufacturer: string;
    serialNumber: string;
    location: string;
    assetHealthScore: number;
    failureProbability24h: number;
    failureProbability48h: number;
    failureProbability72h: number;
    lastMaintenanceDate: string;
    calibrationDueDate: string;
    maintenanceStatus: string;
  }[];
  erMetrics: {
    arrivalsPerHour: number;
    surgeThreshold: number;
    projectedBedShortageWards: {
      wardId: string;
      shortfallBeds: number;
      horizonHours: number;
    }[];
  };
}

export interface SkillGap {
  wardId: string;
  wardName: string;
  requiredSkill: string;
  patientsNeedingSkill: number;
  qualifiedStaffCount: number;
  gap: number;
}

export interface ComplianceViolation {
  staffId: string;
  rule: string;
  description: string;
  severity: "warning" | "violation";
}

export interface UnderstaffingAlert {
  wardId: string;
  wardName: string;
  horizonHours: number;
  currentStaff: number;
  requiredStaff: number;
  shortfall: number;
}

export interface HealthScoreFactor {
  id: string;
  label: string;
  score: number;
  weight: number;
  contribution: number;
  status: "ok" | "warn" | "crit";
  detail: string;
}

export interface HealthScoreBreakdown {
  overall: number;
  grade: "A" | "B" | "C" | "D" | "F";
  factors: HealthScoreFactor[];
  worstFactors: string[];
  timestamp: string;
}

export interface DischargeWorkflow {
  workflowId: string;
  patientId: string;
  patientName: string;
  initiatedAt: string;
  status: "initiated" | "in_progress" | "ready" | "completed";
  destination: "home" | "rehab" | "ltc" | "transfer" | "ama";
  checklist: { id: string; label: string; completed: boolean; completedBy?: string }[];
  followUpNotes: string;
  estimatedDischargeTime?: string;
}

export interface TransferRequest {
  transferId: string;
  patientId: string;
  patientName: string;
  sourceWardId: string;
  sourceRoomId: string;
  sourceBed: string;
  targetWardId: string;
  targetRoomId: string;
  targetBed: string;
  reason: string;
  status: "pending" | "completed";
  createdAt: string;
}

export interface ERQueueEntry {
  entryId: string;
  patientName: string;
  arrivalTime: string;
  triageLevel: 1 | 2 | 3 | 4 | 5;
  chiefComplaint: string;
  estimatedWaitMinutes: number;
  status: "waiting" | "in_triage" | "being_seen" | "admitted" | "discharged";
}

export interface HandoffNote {
  noteId: string;
  patientId: string;
  fromStaffId: string;
  toStaffId: string;
  timestamp: string;
  situation: string;
  background: string;
  assessment: string;
  recommendation: string;
}

export interface BedTurnaround {
  turnaroundId: string;
  roomId: string;
  bed: string;
  vacatedAt: string;
  cleaningStartedAt?: string;
  readyAt?: string;
  turnaroundMinutes?: number;
}

const ESCALATION_WINDOWS_MS: Record<AlertSeverity, number> = {
  advisory: 5 * 60_000,
  warning: 3 * 60_000,
  critical: 1 * 60_000,
};

const MAX_VITALS_HISTORY = 1000;

const DEFAULT_DISCHARGE_CHECKLIST = [
  { id: "1", label: "Physician discharge order signed", completed: false },
  { id: "2", label: "Medication reconciliation complete", completed: false },
  { id: "3", label: "Discharge instructions reviewed with patient", completed: false },
  { id: "4", label: "Follow-up appointments scheduled", completed: false },
  { id: "5", label: "Transport arranged", completed: false },
  { id: "6", label: "Room cleaning ordered", completed: false },
];

const ESI_BASE_WAIT: Record<number, number> = { 1: 0, 2: 15, 3: 45, 4: 90, 5: 120 };

export class CareThreadStore {
  seed!: OperationalSeed;
  private seedSnapshot!: string;
  ehr!: DemoEhrIndex;
  patients: Map<string, PatientRuntime> = new Map();
  alerts: Map<string, RuntimeAlert> = new Map();
  vitalsHistory: Map<string, VitalsReading[]> = new Map();
  workOrders: {
    workOrderId: string;
    deviceId: string;
    priority: string;
    scheduledDate: string;
    status: string;
    createdAt: string;
  }[] = [];
  simulations: Map<
    string,
    {
      scenarioId: string;
      name: string;
      createdBy: string;
      baselineSnapshotDate: string;
      parameterOverrides: Record<string, number>;
      status: "pending" | "running" | "complete";
      runDurationSeconds?: number;
      metrics?: Record<string, number>;
    }
  > = new Map();
  erSurgeActive = false;
  dischargeWorkflows: Map<string, DischargeWorkflow> = new Map();
  transfers: Map<string, TransferRequest> = new Map();
  erQueue: ERQueueEntry[] = [];
  handoffNotes: Map<string, HandoffNote[]> = new Map();
  bedTurnarounds: BedTurnaround[] = [];

  async init(ehr: DemoEhrIndex) {
    this.ehr = ehr;
    const raw = await readFile(
      join(DEMO_DATA_DIR, "operational-seed.json"),
      "utf-8"
    );
    this.seedSnapshot = raw;
    this.seed = JSON.parse(raw) as OperationalSeed;

    const patientIds = new Set<string>();
    for (const r of this.seed.rooms) {
      for (const pid of Object.values(r.bedPatientMap)) {
        patientIds.add(pid);
      }
    }
    for (const pid of patientIds) {
      this.patients.set(pid, this.initialPatientRuntime(pid));
      this.vitalsHistory.set(pid, []);
    }
  }

  private initialPatientRuntime(patientId: string): PatientRuntime {
    const base = this.vitalsFromEhrOrDefault(patientId);
    const { total } = computeNews2(base);
    return {
      patientId,
      vitals: base,
      cewsScore: total,
      deteriorationProb30m: this.riskFromNews2(total, 30),
      deteriorationProb60m: this.riskFromNews2(total, 60),
      sepsisFlag: this.roughSepsisScreen(base),
      fallRiskScore: 2.5 + (total > 7 ? 1.2 : 0),
      lastUpdated: new Date().toISOString(),
    };
  }

  private vitalsFromEhrOrDefault(patientId: string): Vitals {
    const obsList = this.ehr.observationsByPatient.get(patientId) ?? [];
    const latest = obsList[obsList.length - 1];
    if (latest?.resourceType === "Observation") {
      const comp = (latest.component ?? []) as {
        code?: { coding?: { code?: string }[] };
        valueQuantity?: { value?: number };
      }[];
      const byLoinc = (code: string) =>
        comp.find((c) => c.code?.coding?.some((x) => x.code === code))
          ?.valueQuantity?.value;
      const hr = byLoinc("8867-4") ?? 88;
      const sys = byLoinc("8480-6") ?? 120;
      const temp = byLoinc("8310-5") ?? 36.8;
      const spo2 = byLoinc("2708-6") ?? 97;
      const rr = byLoinc("9279-1") ?? 16;
      return {
        heartRate: hr,
        bpSystolic: sys,
        bpDiastolic: byLoinc("8462-4") ?? 78,
        spO2: spo2,
        respiratoryRate: rr,
        temperatureC: temp,
        onSupplementalO2: false,
        consciousness: "alert",
      };
    }
    const jitter = (n: number, d: number) =>
      Math.round((n + (Math.random() * 2 - 1) * d) * 10) / 10;
    return {
      heartRate: jitter(82, 6),
      bpSystolic: jitter(118, 8),
      bpDiastolic: jitter(76, 5),
      spO2: jitter(96, 2),
      respiratoryRate: jitter(18, 3),
      temperatureC: jitter(37.0, 0.4),
      onSupplementalO2: false,
      consciousness: "alert",
    };
  }

  private riskFromNews2(news2: number, horizon: 30 | 60): number {
    const base = Math.min(0.92, news2 / 20 + (news2 >= 7 ? 0.15 : 0));
    const horizonBoost = horizon === 60 ? 0.08 : 0;
    return Math.round((base + horizonBoost + (Math.random() - 0.5) * 0.04) * 1000) / 1000;
  }

  private roughSepsisScreen(v: Vitals): boolean {
    const rrHigh = v.respiratoryRate >= 22;
    const sysLow = v.bpSystolic <= 100;
    const altered = v.spO2 <= 94;
    return (rrHigh ? 1 : 0) + (sysLow ? 1 : 0) + (altered ? 1 : 0) >= 2;
  }

  tickVitals() {
    const now = new Date().toISOString();
    for (const pr of this.patients.values()) {
      const v = pr.vitals;
      const drift = () => (Math.random() - 0.5) * 0.8;
      pr.vitals = {
        ...v,
        heartRate: Math.max(40, Math.min(160, v.heartRate + drift())),
        bpSystolic: Math.max(70, Math.min(200, v.bpSystolic + drift() * 2)),
        bpDiastolic: Math.max(40, Math.min(110, v.bpDiastolic + drift())),
        spO2: Math.max(85, Math.min(100, v.spO2 + drift() * 0.3)),
        respiratoryRate: Math.max(8, Math.min(36, v.respiratoryRate + drift() * 0.5)),
        temperatureC: Math.max(35, Math.min(40.5, v.temperatureC + drift() * 0.05)),
      };
      const { total, subscores } = computeNews2(pr.vitals);
      pr.cewsScore = total;
      pr.deteriorationProb30m = this.riskFromNews2(total, 30);
      pr.deteriorationProb60m = this.riskFromNews2(total, 60);
      pr.sepsisFlag = this.roughSepsisScreen(pr.vitals);
      pr.fallRiskScore = 2.5 + (total > 7 ? 1.2 : 0);
      pr.lastUpdated = now;

      this.recordVitals(pr);
      this.maybeRaiseAlert(pr, subscores);
    }

    this.checkErSurge();
    this.checkCalibrationAlerts();
    this.escalateAlerts();
  }

  private recordVitals(pr: PatientRuntime) {
    let history = this.vitalsHistory.get(pr.patientId);
    if (!history) {
      history = [];
      this.vitalsHistory.set(pr.patientId, history);
    }
    history.push({
      timestamp: pr.lastUpdated,
      heartRate: pr.vitals.heartRate,
      bpSystolic: pr.vitals.bpSystolic,
      bpDiastolic: pr.vitals.bpDiastolic,
      spO2: pr.vitals.spO2,
      respiratoryRate: pr.vitals.respiratoryRate,
      temperatureC: pr.vitals.temperatureC,
      cewsScore: pr.cewsScore,
    });
    if (history.length > MAX_VITALS_HISTORY) {
      history.splice(0, history.length - MAX_VITALS_HISTORY);
    }
  }

  getVitalsHistory(patientId: string, hours: number = 24): VitalsReading[] {
    const history = this.vitalsHistory.get(patientId) ?? [];
    const cutoff = Date.now() - hours * 3600_000;
    return history.filter((r) => new Date(r.timestamp).getTime() >= cutoff);
  }

  private checkErSurge() {
    const er = this.seed.erMetrics;
    const simulatedArrivals = er.arrivalsPerHour + (Math.random() - 0.5) * 2;
    const wasActive = this.erSurgeActive;
    this.erSurgeActive = simulatedArrivals >= er.surgeThreshold;

    if (this.erSurgeActive && !wasActive) {
      const alertId = randomUUID();
      const shortages = er.projectedBedShortageWards
        .map((w) => `${w.wardId}: ${w.shortfallBeds} beds short in ${w.horizonHours}h`)
        .join("; ");
      this.alerts.set(alertId, {
        alertId,
        severity: "critical",
        type: "er_surge",
        patientId: "",
        timestamp: new Date().toISOString(),
        acknowledged: false,
        message: `ER surge detected: ${simulatedArrivals.toFixed(1)} arrivals/hr (threshold ${er.surgeThreshold}). ${shortages}`,
        escalationLevel: 0,
      });
    }
  }

  private checkCalibrationAlerts() {
    const now = Date.now();
    for (const asset of this.seed.assets) {
      const dueDate = new Date(asset.calibrationDueDate).getTime();
      const daysUntilDue = (dueDate - now) / 86400_000;

      const alertDays = [7, 3, 1];
      for (const threshold of alertDays) {
        if (daysUntilDue <= threshold && daysUntilDue > threshold - 1) {
          const existing = [...this.alerts.values()].find(
            (a) =>
              a.type === "calibration_due" &&
              a.message.includes(asset.deviceId) &&
              !a.acknowledged &&
              Date.now() - new Date(a.timestamp).getTime() < 86400_000
          );
          if (existing) break;

          const alertId = randomUUID();
          this.alerts.set(alertId, {
            alertId,
            severity: threshold <= 1 ? "critical" : threshold <= 3 ? "warning" : "advisory",
            type: "calibration_due",
            patientId: "",
            timestamp: new Date().toISOString(),
            acknowledged: false,
            message: `${asset.deviceType} (${asset.deviceId}) calibration due in ${Math.ceil(daysUntilDue)} day(s)`,
            escalationLevel: 0,
          });
          break;
        }
      }
    }
  }

  private escalateAlerts() {
    const now = Date.now();
    for (const alert of this.alerts.values()) {
      if (alert.acknowledged) continue;
      const window = ESCALATION_WINDOWS_MS[alert.severity];
      const elapsed = now - new Date(alert.timestamp).getTime();

      if (elapsed > window && alert.escalationLevel < 3) {
        const nextSeverity: AlertSeverity =
          alert.severity === "advisory"
            ? "warning"
            : alert.severity === "warning"
            ? "critical"
            : "critical";
        alert.severity = nextSeverity;
        alert.escalationLevel += 1;
        alert.escalatedAt = new Date().toISOString();
      }
    }
  }

  private maybeRaiseAlert(
    pr: PatientRuntime,
    subscores: Record<string, number>
  ) {
    const dupWindowMs = 120_000;
    const recent = [...this.alerts.values()].filter(
      (a) =>
        a.patientId === pr.patientId &&
        a.type === "cews_deterioration" &&
        !a.acknowledged &&
        Date.now() - new Date(a.timestamp).getTime() < dupWindowMs
    );
    if (recent.length) return;

    let severity: AlertSeverity | null = null;
    if (pr.cewsScore >= 7 || pr.deteriorationProb30m >= 0.35) {
      severity = "critical";
    } else if (pr.cewsScore >= 5 || pr.deteriorationProb30m >= 0.22) {
      severity = "warning";
    } else if (pr.cewsScore >= 3) {
      severity = "advisory";
    }
    if (!severity) return;

    const alertId = randomUUID();
    const factors = contributingFactors(subscores);
    const alert: RuntimeAlert = {
      alertId,
      severity,
      type: "cews_deterioration",
      patientId: pr.patientId,
      timestamp: new Date().toISOString(),
      acknowledged: false,
      message: `CEWS ${pr.cewsScore.toFixed(0)} — top drivers: ${factors
        .map((f) => `${f.feature}(${f.weight})`)
        .join(", ")}`,
      escalationLevel: 0,
    };
    this.alerts.set(alertId, alert);
  }

  acknowledgeAlert(alertId: string, body: { userId: string; reasonCode: string }) {
    const a = this.alerts.get(alertId);
    if (!a) return null;
    a.acknowledged = true;
    a.acknowledgedBy = body.userId;
    a.acknowledgedAt = new Date().toISOString();
    a.responseCode = body.reasonCode;
    return a;
  }

  getErSurgeStatus() {
    const er = this.seed.erMetrics;
    return {
      active: this.erSurgeActive,
      arrivalsPerHour: er.arrivalsPerHour,
      surgeThreshold: er.surgeThreshold,
      projectedShortages: er.projectedBedShortageWards,
    };
  }

  suggestBedAllocation(acuityScore: number, preferredWard?: string) {
    const emptyBeds: {
      roomId: string;
      wardId: string;
      bed: string;
      wardSpecialisation: string;
      score: number;
    }[] = [];

    for (const room of this.seed.rooms) {
      const occupied = new Set(Object.values(room.bedPatientMap));
      for (let i = 1; i <= room.bedCount; i++) {
        const bedId = `bed-${i}`;
        if (!occupied.has(bedId) && !room.bedPatientMap[bedId]) {
          const ward = this.seed.wards.find((w) => w.id === room.wardId);
          let score = 50;
          if (acuityScore >= 4 && ward?.specialisation === "Critical Care") score += 30;
          else if (acuityScore < 4 && ward?.specialisation === "General Medicine") score += 20;
          if (preferredWard && room.wardId === preferredWard) score += 15;
          if (room.cleaningStatus === "clean") score += 10;
          emptyBeds.push({
            roomId: room.id,
            wardId: room.wardId,
            bed: bedId,
            wardSpecialisation: ward?.specialisation ?? "Unknown",
            score,
          });
        }
      }
    }

    return emptyBeds.sort((a, b) => b.score - a.score).slice(0, 3);
  }

  checkSkillGaps(): SkillGap[] {
    const gaps: SkillGap[] = [];

    for (const ward of this.seed.wards) {
      const wardStaff = this.seed.staff.filter((s) => s.currentWardId === ward.id);
      const wardPatientIds = new Set<string>();
      for (const room of this.seed.rooms.filter((r) => r.wardId === ward.id)) {
        for (const pid of Object.values(room.bedPatientMap)) {
          wardPatientIds.add(pid);
        }
      }

      const requiredSkills: Map<string, number> = new Map();
      if (ward.specialisation === "Critical Care") {
        const icuPatients = wardPatientIds.size;
        if (icuPatients > 0) {
          requiredSkills.set("ICU", icuPatients);
          requiredSkills.set("Ventilator qualified", icuPatients);
        }
      }
      for (const pid of wardPatientIds) {
        const pr = this.patients.get(pid);
        if (pr && pr.cewsScore >= 5) {
          requiredSkills.set("ACLS", (requiredSkills.get("ACLS") ?? 0) + 1);
        }
      }

      for (const [skill, needed] of requiredSkills) {
        const qualified = wardStaff.filter(
          (s) => s.specialisations.includes(skill) || s.certifications.includes(skill)
        ).length;
        if (qualified < Math.ceil(needed / 2)) {
          gaps.push({
            wardId: ward.id,
            wardName: ward.name,
            requiredSkill: skill,
            patientsNeedingSkill: needed,
            qualifiedStaffCount: qualified,
            gap: Math.ceil(needed / 2) - qualified,
          });
        }
      }
    }

    return gaps;
  }

  checkScheduleCompliance(
    shifts: { staffId: string; startHour: number; endHour: number; day: number }[]
  ): ComplianceViolation[] {
    const violations: ComplianceViolation[] = [];

    const weeklyHours = new Map<string, number>();
    const shiftsByStaff = new Map<string, typeof shifts>();

    for (const shift of shifts) {
      const hours = shift.endHour > shift.startHour
        ? shift.endHour - shift.startHour
        : 24 - shift.startHour + shift.endHour;
      weeklyHours.set(shift.staffId, (weeklyHours.get(shift.staffId) ?? 0) + hours);

      let list = shiftsByStaff.get(shift.staffId);
      if (!list) {
        list = [];
        shiftsByStaff.set(shift.staffId, list);
      }
      list.push(shift);
    }

    for (const [staffId, hours] of weeklyHours) {
      if (hours > 48) {
        violations.push({
          staffId,
          rule: "EU_WTD_48H",
          description: `Weekly hours ${hours}h exceeds 48h limit (EU Working Time Directive)`,
          severity: "violation",
        });
      } else if (hours > 40) {
        violations.push({
          staffId,
          rule: "OVERTIME_WARNING",
          description: `Weekly hours ${hours}h exceeds 40h standard`,
          severity: "warning",
        });
      }
    }

    for (const [staffId, staffShifts] of shiftsByStaff) {
      const sorted = [...staffShifts].sort((a, b) => a.day * 24 + a.startHour - (b.day * 24 + b.startHour));
      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1];
        const curr = sorted[i];
        const prevEnd = prev.day * 24 + prev.endHour;
        const currStart = curr.day * 24 + curr.startHour;
        const restHours = currStart - prevEnd;
        if (restHours < 11 && restHours >= 0) {
          violations.push({
            staffId,
            rule: "EU_WTD_11H_REST",
            description: `Only ${restHours}h rest between shifts on days ${prev.day}-${curr.day} (minimum 11h required)`,
            severity: "violation",
          });
        }
      }
    }

    return violations;
  }

  predictUnderstaffing(): UnderstaffingAlert[] {
    const alerts: UnderstaffingAlert[] = [];

    for (const ward of this.seed.wards) {
      const currentStaff = this.seed.staff.filter(
        (s) => s.currentWardId === ward.id
      ).length;

      const wardRooms = this.seed.rooms.filter((r) => r.wardId === ward.id);
      const currentPatients = wardRooms.reduce((sum, r) => sum + r.occupiedBeds, 0);
      const totalBeds = wardRooms.reduce((sum, r) => sum + r.bedCount, 0);

      for (const horizon of [24, 48]) {
        const projectedPatients = Math.min(
          totalBeds,
          currentPatients + Math.round(this.seed.erMetrics.arrivalsPerHour * 0.3 * (horizon / 24))
        );
        const requiredStaff = Math.ceil(projectedPatients / ward.staffRatio);

        if (requiredStaff > currentStaff) {
          alerts.push({
            wardId: ward.id,
            wardName: ward.name,
            horizonHours: horizon,
            currentStaff,
            requiredStaff,
            shortfall: requiredStaff - currentStaff,
          });
        }
      }
    }

    return alerts;
  }

  getAlertFatigueMetrics() {
    const byWard = new Map<string, { total: number; acknowledged: number; avgResponseMs: number }>();

    for (const ward of this.seed.wards) {
      byWard.set(ward.id, { total: 0, acknowledged: 0, avgResponseMs: 0 });
    }

    for (const alert of this.alerts.values()) {
      if (!alert.patientId) continue;
      let wardId: string | null = null;
      for (const room of this.seed.rooms) {
        if (Object.values(room.bedPatientMap).includes(alert.patientId)) {
          wardId = room.wardId;
          break;
        }
      }
      if (!wardId) continue;

      const metrics = byWard.get(wardId);
      if (!metrics) continue;
      metrics.total += 1;
      if (alert.acknowledged) {
        metrics.acknowledged += 1;
        if (alert.acknowledgedAt) {
          const responseMs = new Date(alert.acknowledgedAt).getTime() - new Date(alert.timestamp).getTime();
          metrics.avgResponseMs = (metrics.avgResponseMs * (metrics.acknowledged - 1) + responseMs) / metrics.acknowledged;
        }
      }
    }

    return [...byWard.entries()].map(([wardId, m]) => ({
      wardId,
      totalAlerts: m.total,
      acknowledgedAlerts: m.acknowledged,
      alertToActionRatio: m.total > 0 ? m.acknowledged / m.total : 0,
      avgResponseSeconds: Math.round(m.avgResponseMs / 1000),
    }));
  }

  forecastRoom(roomId: string) {
    const room = this.seed.rooms.find((r) => r.id === roomId);
    if (!room) return null;
    const occRate = room.bedCount ? room.occupiedBeds / room.bedCount : 0;
    const noise = () => (Math.random() - 0.5) * 0.06;
    return {
      roomId,
      horizons: {
        h2: Math.min(1, Math.max(0, occRate + noise() + 0.02)),
        h4: Math.min(1, Math.max(0, occRate + noise() + 0.05)),
        h8: Math.min(1, Math.max(0, occRate + noise() + 0.08)),
      },
      predictedOccupiedBeds: {
        h2: Math.round(room.bedCount * (occRate + noise() + 0.02)),
        h4: Math.round(room.bedCount * (occRate + noise() + 0.05)),
        h8: Math.round(room.bedCount * (occRate + noise() + 0.08)),
      },
    };
  }

  wardOccupancyBroadcast() {
    const byWard = new Map<
      string,
      { wardId: string; occupiedBeds: number; totalBeds: number }
    >();
    for (const w of this.seed.wards) {
      byWard.set(w.id, {
        wardId: w.id,
        occupiedBeds: 0,
        totalBeds: 0,
      });
    }
    for (const r of this.seed.rooms) {
      const agg = byWard.get(r.wardId);
      if (!agg) continue;
      agg.occupiedBeds += r.occupiedBeds;
      agg.totalBeds += r.bedCount;
    }
    return [...byWard.values()];
  }

  // ── Sandbox: Patients ───────────────────────────────────────────────

  generateVitalsForAcuity(target: number): Vitals {
    const v: Vitals = { heartRate: 75, bpSystolic: 120, bpDiastolic: 78, spO2: 97, respiratoryRate: 16, temperatureC: 37.0, onSupplementalO2: false, consciousness: "alert" };
    if (target <= 2) return v;
    if (target >= 3) v.respiratoryRate = 22;
    if (target >= 5) { v.heartRate = 45; v.spO2 = 93; }
    if (target >= 7) { v.bpSystolic = 88; v.temperatureC = 39.5; v.respiratoryRate = 26; }
    if (target >= 9) { v.spO2 = 90; v.consciousness = "cvpu"; }
    return v;
  }

  addPatient(opts: { name: string; age: number; acuity: number; wardId: string; roomId: string; bed: string }) {
    const room = this.seed.rooms.find(r => r.id === opts.roomId);
    if (!room) return { error: "Room not found" };
    if (room.bedPatientMap[opts.bed]) return { error: "Bed already occupied" };

    const patientId = `pat-${Date.now().toString(36)}`;
    room.bedPatientMap[opts.bed] = patientId;
    room.occupiedBeds = Object.keys(room.bedPatientMap).length;

    const vitals = this.generateVitalsForAcuity(opts.acuity);
    const { total } = computeNews2(vitals);
    const pr: PatientRuntime = {
      patientId,
      vitals,
      cewsScore: total,
      deteriorationProb30m: this.riskFromNews2(total, 30),
      deteriorationProb60m: this.riskFromNews2(total, 60),
      sepsisFlag: this.roughSepsisScreen(vitals),
      fallRiskScore: 2.5 + (total > 7 ? 1.2 : 0),
      lastUpdated: new Date().toISOString(),
    };
    this.patients.set(patientId, pr);
    this.vitalsHistory.set(patientId, []);

    this.ehr.patients.set(patientId, {
      resourceType: "Patient",
      id: patientId,
      name: [{ family: opts.name.split(" ").pop() ?? opts.name, given: [opts.name.split(" ")[0] ?? opts.name] }],
      gender: Math.random() > 0.5 ? "male" : "female",
      birthDate: `${2026 - opts.age}-01-01`,
    } as never);

    return { patientId, name: opts.name, wardId: opts.wardId, roomId: opts.roomId, bed: opts.bed };
  }

  dischargePatient(patientId: string) {
    let found = false;
    for (const room of this.seed.rooms) {
      for (const [bed, pid] of Object.entries(room.bedPatientMap)) {
        if (pid === patientId) {
          delete room.bedPatientMap[bed];
          room.occupiedBeds = Object.keys(room.bedPatientMap).length;
          room.cleaningStatus = "needs_cleaning";
          this.bedTurnarounds.push({
            turnaroundId: randomUUID(),
            roomId: room.id,
            bed,
            vacatedAt: new Date().toISOString(),
          });
          found = true;
          break;
        }
      }
      if (found) break;
    }
    for (const staff of this.seed.staff) {
      staff.assignedPatientIds = staff.assignedPatientIds.filter(id => id !== patientId);
    }
    this.patients.delete(patientId);
    this.vitalsHistory.delete(patientId);
    this.ehr.patients.delete(patientId);
    return found;
  }

  deterioratePatient(patientId: string, targetScore: number) {
    const pr = this.patients.get(patientId);
    if (!pr) return false;
    pr.vitals = this.generateVitalsForAcuity(targetScore);
    const { total } = computeNews2(pr.vitals);
    pr.cewsScore = total;
    pr.deteriorationProb30m = this.riskFromNews2(total, 30);
    pr.deteriorationProb60m = this.riskFromNews2(total, 60);
    pr.sepsisFlag = this.roughSepsisScreen(pr.vitals);
    pr.fallRiskScore = 2.5 + (total > 7 ? 1.2 : 0);
    pr.lastUpdated = new Date().toISOString();
    return true;
  }

  triggerPatientSpike(count: number, acuityRange: [number, number]) {
    const created: string[] = [];
    const names = ["Alex Kim", "Jordan Lee", "Sam Rivera", "Taylor Chen", "Morgan Patel", "Casey Wu", "Riley Ahmed", "Quinn Okafor", "Avery Torres", "Blake Santos"];
    for (let i = 0; i < count; i++) {
      let placed = false;
      for (const room of this.seed.rooms) {
        for (let b = 1; b <= room.bedCount; b++) {
          const bed = `bed-${b}`;
          if (!room.bedPatientMap[bed]) {
            const acuity = Math.round(acuityRange[0] + Math.random() * (acuityRange[1] - acuityRange[0]));
            const result = this.addPatient({
              name: names[i % names.length] ?? `Patient ${i + 1}`,
              age: 30 + Math.floor(Math.random() * 50),
              acuity,
              wardId: room.wardId,
              roomId: room.id,
              bed,
            });
            if ("patientId" in result && result.patientId) created.push(result.patientId as string);
            placed = true;
            break;
          }
        }
        if (placed) break;
      }
    }
    return created;
  }

  // ── Sandbox: Staff ────────────────────────────────────────────────

  addStaff(opts: { role: string; specialisations: string[]; certifications: string[]; shiftPattern: string; wardId: string }) {
    const staffId = `staff-sandbox-${Date.now().toString(36)}`;
    this.seed.staff.push({
      staffId,
      role: opts.role,
      specialisations: opts.specialisations,
      certifications: opts.certifications,
      shiftPattern: opts.shiftPattern,
      currentWardId: opts.wardId,
      assignedPatientIds: [],
    });
    return { staffId };
  }

  removeStaff(staffId: string) {
    const idx = this.seed.staff.findIndex(s => s.staffId === staffId);
    if (idx === -1) return false;
    this.seed.staff.splice(idx, 1);
    return true;
  }

  updateStaff(staffId: string, patch: { wardId?: string; assignedPatientIds?: string[]; specialisations?: string[]; certifications?: string[] }) {
    const s = this.seed.staff.find(x => x.staffId === staffId);
    if (!s) return false;
    if (patch.wardId) s.currentWardId = patch.wardId;
    if (patch.assignedPatientIds) s.assignedPatientIds = patch.assignedPatientIds;
    if (patch.specialisations) s.specialisations = patch.specialisations;
    if (patch.certifications) s.certifications = patch.certifications;
    return true;
  }

  // ── Sandbox: Assets ───────────────────────────────────────────────

  addAsset(opts: { deviceType: string; manufacturer: string; location: string; assetHealthScore: number; failureProbability24h: number; failureProbability48h: number; failureProbability72h: number }) {
    const deviceId = `asset-sandbox-${Date.now().toString(36)}`;
    this.seed.assets.push({
      deviceId,
      deviceType: opts.deviceType,
      manufacturer: opts.manufacturer,
      serialNumber: `SN-${Date.now()}`,
      location: opts.location,
      assetHealthScore: opts.assetHealthScore,
      failureProbability24h: opts.failureProbability24h,
      failureProbability48h: opts.failureProbability48h,
      failureProbability72h: opts.failureProbability72h,
      lastMaintenanceDate: new Date().toISOString(),
      calibrationDueDate: new Date(Date.now() + 30 * 86400_000).toISOString(),
      maintenanceStatus: "operational",
    });
    return { deviceId };
  }

  updateAsset(deviceId: string, patch: { assetHealthScore?: number; failureProbability24h?: number; maintenanceStatus?: string }) {
    const a = this.seed.assets.find(x => x.deviceId === deviceId);
    if (!a) return false;
    if (patch.assetHealthScore !== undefined) a.assetHealthScore = patch.assetHealthScore;
    if (patch.failureProbability24h !== undefined) a.failureProbability24h = patch.failureProbability24h;
    if (patch.maintenanceStatus !== undefined) a.maintenanceStatus = patch.maintenanceStatus;
    return true;
  }

  removeAsset(deviceId: string) {
    const idx = this.seed.assets.findIndex(a => a.deviceId === deviceId);
    if (idx === -1) return false;
    this.seed.assets.splice(idx, 1);
    return true;
  }

  triggerEquipmentFailure(deviceId: string) {
    const a = this.seed.assets.find(x => x.deviceId === deviceId);
    if (!a) return false;
    a.assetHealthScore = 12;
    a.failureProbability24h = 0.95;
    a.failureProbability48h = 0.98;
    a.failureProbability72h = 0.99;
    a.maintenanceStatus = "critical_failure";
    const alertId = randomUUID();
    this.alerts.set(alertId, {
      alertId,
      severity: "critical",
      type: "equipment_failure",
      patientId: "",
      timestamp: new Date().toISOString(),
      acknowledged: false,
      message: `CRITICAL: ${a.deviceType} (${a.deviceId}) has failed. Health score: ${a.assetHealthScore}%`,
      escalationLevel: 0,
    });
    return true;
  }

  // ── Sandbox: System Parameters ────────────────────────────────────

  updateErMetrics(patch: { arrivalsPerHour?: number; surgeThreshold?: number }) {
    if (patch.arrivalsPerHour !== undefined) this.seed.erMetrics.arrivalsPerHour = patch.arrivalsPerHour;
    if (patch.surgeThreshold !== undefined) this.seed.erMetrics.surgeThreshold = patch.surgeThreshold;
  }

  updateWard(wardId: string, patch: { staffRatio?: number; capacity?: number }) {
    const w = this.seed.wards.find(x => x.id === wardId);
    if (!w) return false;
    if (patch.staffRatio !== undefined) w.staffRatio = patch.staffRatio;
    if (patch.capacity !== undefined) w.capacity = patch.capacity;
    return true;
  }

  triggerSurge() {
    this.seed.erMetrics.arrivalsPerHour = this.seed.erMetrics.surgeThreshold + 4;
    this.erSurgeActive = true;
    const alertId = randomUUID();
    this.alerts.set(alertId, {
      alertId,
      severity: "critical",
      type: "er_surge",
      patientId: "",
      timestamp: new Date().toISOString(),
      acknowledged: false,
      message: `ER surge manually triggered: ${this.seed.erMetrics.arrivalsPerHour}/hr arrivals`,
      escalationLevel: 0,
    });
  }

  async resetToSeed() {
    this.seed = JSON.parse(this.seedSnapshot) as OperationalSeed;
    this.patients.clear();
    this.alerts.clear();
    this.vitalsHistory.clear();
    this.workOrders = [];
    this.simulations.clear();
    this.erSurgeActive = false;
    this.dischargeWorkflows.clear();
    this.transfers.clear();
    this.erQueue = [];
    this.handoffNotes.clear();
    this.bedTurnarounds = [];

    const patientIds = new Set<string>();
    for (const r of this.seed.rooms) {
      for (const pid of Object.values(r.bedPatientMap)) {
        patientIds.add(pid);
      }
    }
    for (const pid of patientIds) {
      this.patients.set(pid, this.initialPatientRuntime(pid));
      this.vitalsHistory.set(pid, []);
    }
  }

  // ── Discharge Workflow ────────────────────────────────────────────

  initiateDischarge(patientId: string, destination: DischargeWorkflow["destination"]) {
    const name = this.getPatientName(patientId);
    const wf: DischargeWorkflow = {
      workflowId: randomUUID(),
      patientId,
      patientName: name,
      initiatedAt: new Date().toISOString(),
      status: "initiated",
      destination,
      checklist: DEFAULT_DISCHARGE_CHECKLIST.map(c => ({ ...c })),
      followUpNotes: "",
    };
    this.dischargeWorkflows.set(wf.workflowId, wf);
    return wf;
  }

  toggleDischargeChecklist(workflowId: string, itemId: string, completed: boolean, completedBy?: string) {
    const wf = this.dischargeWorkflows.get(workflowId);
    if (!wf) return null;
    const item = wf.checklist.find(c => c.id === itemId);
    if (!item) return null;
    item.completed = completed;
    item.completedBy = completedBy;
    const allDone = wf.checklist.every(c => c.completed);
    if (allDone) wf.status = "ready";
    else if (wf.checklist.some(c => c.completed)) wf.status = "in_progress";
    return wf;
  }

  completeDischarge(workflowId: string) {
    const wf = this.dischargeWorkflows.get(workflowId);
    if (!wf) return null;
    wf.status = "completed";
    this.dischargePatient(wf.patientId);
    return wf;
  }

  // ── Patient Transfer ──────────────────────────────────────────────

  initiateTransfer(opts: { patientId: string; targetWardId: string; targetRoomId: string; targetBed: string; reason: string }) {
    let sourceWardId = "", sourceRoomId = "", sourceBed = "";
    for (const room of this.seed.rooms) {
      for (const [bed, pid] of Object.entries(room.bedPatientMap)) {
        if (pid === opts.patientId) {
          sourceWardId = room.wardId;
          sourceRoomId = room.id;
          sourceBed = bed;
        }
      }
    }
    if (!sourceRoomId) return { error: "Patient not found in any room" };

    const targetRoom = this.seed.rooms.find(r => r.id === opts.targetRoomId);
    if (!targetRoom) return { error: "Target room not found" };
    if (targetRoom.bedPatientMap[opts.targetBed]) return { error: "Target bed occupied" };

    const t: TransferRequest = {
      transferId: randomUUID(),
      patientId: opts.patientId,
      patientName: this.getPatientName(opts.patientId),
      sourceWardId, sourceRoomId, sourceBed,
      targetWardId: opts.targetWardId,
      targetRoomId: opts.targetRoomId,
      targetBed: opts.targetBed,
      reason: opts.reason,
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    this.transfers.set(t.transferId, t);
    return t;
  }

  completeTransfer(transferId: string) {
    const t = this.transfers.get(transferId);
    if (!t || t.status === "completed") return null;

    const srcRoom = this.seed.rooms.find(r => r.id === t.sourceRoomId);
    const tgtRoom = this.seed.rooms.find(r => r.id === t.targetRoomId);
    if (!srcRoom || !tgtRoom) return null;

    delete srcRoom.bedPatientMap[t.sourceBed];
    srcRoom.occupiedBeds = Object.keys(srcRoom.bedPatientMap).length;
    srcRoom.cleaningStatus = "needs_cleaning";

    tgtRoom.bedPatientMap[t.targetBed] = t.patientId;
    tgtRoom.occupiedBeds = Object.keys(tgtRoom.bedPatientMap).length;

    for (const staff of this.seed.staff) {
      if (staff.currentWardId === t.sourceWardId) {
        staff.assignedPatientIds = staff.assignedPatientIds.filter(id => id !== t.patientId);
      }
    }

    this.bedTurnarounds.push({
      turnaroundId: randomUUID(),
      roomId: t.sourceRoomId,
      bed: t.sourceBed,
      vacatedAt: new Date().toISOString(),
    });

    t.status = "completed";
    return t;
  }

  // ── ER Queue ──────────────────────────────────────────────────────

  addToERQueue(opts: { patientName: string; triageLevel: 1 | 2 | 3 | 4 | 5; chiefComplaint: string }) {
    const waitingCount = this.erQueue.filter(e => e.status === "waiting").length;
    const surgeMultiplier = this.erSurgeActive ? 1.5 : 1;
    const baseWait = ESI_BASE_WAIT[opts.triageLevel] ?? 60;
    const estimatedWait = Math.round(baseWait * (1 + waitingCount * 0.15) * surgeMultiplier);

    const entry: ERQueueEntry = {
      entryId: randomUUID(),
      patientName: opts.patientName,
      arrivalTime: new Date().toISOString(),
      triageLevel: opts.triageLevel,
      chiefComplaint: opts.chiefComplaint,
      estimatedWaitMinutes: estimatedWait,
      status: "waiting",
    };
    this.erQueue.push(entry);
    return entry;
  }

  updateERQueueStatus(entryId: string, status: ERQueueEntry["status"]) {
    const entry = this.erQueue.find(e => e.entryId === entryId);
    if (!entry) return null;
    entry.status = status;
    return entry;
  }

  // ── Handoff Notes ─────────────────────────────────────────────────

  addHandoffNote(opts: { patientId: string; fromStaffId: string; toStaffId: string; situation: string; background: string; assessment: string; recommendation: string }) {
    const note: HandoffNote = {
      noteId: randomUUID(),
      ...opts,
      timestamp: new Date().toISOString(),
    };
    let list = this.handoffNotes.get(opts.patientId);
    if (!list) {
      list = [];
      this.handoffNotes.set(opts.patientId, list);
    }
    list.push(note);
    return note;
  }

  // ── Bed Turnaround ────────────────────────────────────────────────

  startCleaning(turnaroundId: string) {
    const t = this.bedTurnarounds.find(x => x.turnaroundId === turnaroundId);
    if (!t) return null;
    t.cleaningStartedAt = new Date().toISOString();
    return t;
  }

  markBedReady(turnaroundId: string) {
    const t = this.bedTurnarounds.find(x => x.turnaroundId === turnaroundId);
    if (!t) return null;
    t.readyAt = new Date().toISOString();
    t.turnaroundMinutes = Math.round((new Date(t.readyAt).getTime() - new Date(t.vacatedAt).getTime()) / 60_000);
    const room = this.seed.rooms.find(r => r.id === t.roomId);
    if (room) room.cleaningStatus = "clean";
    return t;
  }

  // ── Helpers ───────────────────────────────────────────────────────

  private getPatientName(patientId: string): string {
    const p = this.ehr.patients.get(patientId);
    if (!p) return patientId;
    const names = p.name as { family?: string; given?: string[] }[] | undefined;
    const n = names?.[0];
    return n ? [n.given?.join(" "), n.family].filter(Boolean).join(" ") : patientId;
  }

  computeHealthScore(): HealthScoreBreakdown {
    const clamp = (v: number) => Math.round(Math.max(0, Math.min(100, v)));
    const lerp = (val: number, lo: number, hi: number) =>
      clamp(((val - lo) / (hi - lo)) * 100);

    // 1. Bed Occupancy (weight 0.20) — 100 at ≤70%, 0 at 100%
    const occ = this.wardOccupancyBroadcast();
    const totalBeds = occ.reduce((s, w) => s + w.totalBeds, 0);
    const totalOccupied = occ.reduce((s, w) => s + w.occupiedBeds, 0);
    const occRate = totalBeds > 0 ? totalOccupied / totalBeds : 0;
    const bedScore = clamp(occRate <= 0.7 ? 100 : ((1 - occRate) / 0.3) * 100);

    // 2. Patient Acuity (weight 0.25) — 100 at avg NEWS2 ≤1, 0 at avg ≥7
    const patients = [...this.patients.values()];
    const avgCews = patients.length > 0
      ? patients.reduce((s, p) => s + p.cewsScore, 0) / patients.length
      : 0;
    const acuityScore = clamp(avgCews <= 1 ? 100 : 100 - lerp(avgCews, 1, 7));

    // 3. Alert Load (weight 0.15) — weighted count: crit×3, warn×2, adv×1
    const activeAlerts = [...this.alerts.values()].filter(a => !a.acknowledged);
    const alertWeight = activeAlerts.reduce((s, a) => {
      if (a.severity === "critical") return s + 3;
      if (a.severity === "warning") return s + 2;
      return s + 1;
    }, 0);
    const alertScore = clamp(alertWeight <= 0 ? 100 : 100 - (alertWeight / 10) * 100);

    // 4. Staff Wellbeing (weight 0.15) — avg fatigue index: 100 at ≤3, 0 at ≥9
    let avgFatigue = 0;
    if (this.seed.staff.length > 0) {
      const totalFatigue = this.seed.staff.reduce((sum, s) => {
        const acuityLoad = s.assignedPatientIds.reduce((acc, pid) => {
          const pr = this.patients.get(pid);
          return acc + (pr ? pr.cewsScore * 0.15 : 0);
        }, 0);
        const workload = Math.min(10, s.assignedPatientIds.length * 2.2 + acuityLoad);
        return sum + Math.min(10, workload * 0.85 + (s.shiftPattern === "Rotating" ? 1.2 : 0));
      }, 0);
      avgFatigue = totalFatigue / this.seed.staff.length;
    }
    const staffScore = clamp(avgFatigue <= 3 ? 100 : 100 - lerp(avgFatigue, 3, 9));

    // 5. Equipment Health (weight 0.15) — direct average of asset health scores
    const equipScore = this.seed.assets.length > 0
      ? clamp(this.seed.assets.reduce((s, a) => s + a.assetHealthScore, 0) / this.seed.assets.length)
      : 100;

    // 6. ER Surge (weight 0.10) — 100 if ratio <0.7, 0 if active surge
    const erRatio = this.seed.erMetrics.surgeThreshold > 0
      ? this.seed.erMetrics.arrivalsPerHour / this.seed.erMetrics.surgeThreshold
      : 0;
    const erScore = this.erSurgeActive ? 0 : clamp(erRatio < 0.7 ? 100 : ((1 - erRatio) / 0.3) * 100);

    const factors: HealthScoreFactor[] = [
      {
        id: "bed_occupancy", label: "Bed Occupancy", score: bedScore, weight: 0.20,
        contribution: Math.round(bedScore * 0.20 * 10) / 10,
        status: bedScore >= 70 ? "ok" : bedScore >= 40 ? "warn" : "crit",
        detail: `${Math.round(occRate * 100)}% occupied (${totalOccupied}/${totalBeds} beds)`,
      },
      {
        id: "patient_acuity", label: "Patient Acuity", score: acuityScore, weight: 0.25,
        contribution: Math.round(acuityScore * 0.25 * 10) / 10,
        status: acuityScore >= 70 ? "ok" : acuityScore >= 40 ? "warn" : "crit",
        detail: `Average NEWS2: ${avgCews.toFixed(1)} across ${patients.length} patients`,
      },
      {
        id: "alert_load", label: "Alert Load", score: alertScore, weight: 0.15,
        contribution: Math.round(alertScore * 0.15 * 10) / 10,
        status: alertScore >= 70 ? "ok" : alertScore >= 40 ? "warn" : "crit",
        detail: `${activeAlerts.length} unacknowledged (${activeAlerts.filter(a => a.severity === "critical").length} critical)`,
      },
      {
        id: "staff_wellbeing", label: "Staff Wellbeing", score: staffScore, weight: 0.15,
        contribution: Math.round(staffScore * 0.15 * 10) / 10,
        status: staffScore >= 70 ? "ok" : staffScore >= 40 ? "warn" : "crit",
        detail: `Avg fatigue: ${avgFatigue.toFixed(1)}/10 across ${this.seed.staff.length} staff`,
      },
      {
        id: "equipment_health", label: "Equipment Health", score: equipScore, weight: 0.15,
        contribution: Math.round(equipScore * 0.15 * 10) / 10,
        status: equipScore >= 70 ? "ok" : equipScore >= 40 ? "warn" : "crit",
        detail: `Avg health: ${equipScore}% across ${this.seed.assets.length} devices`,
      },
      {
        id: "er_surge", label: "ER Status", score: erScore, weight: 0.10,
        contribution: Math.round(erScore * 0.10 * 10) / 10,
        status: erScore >= 70 ? "ok" : erScore >= 40 ? "warn" : "crit",
        detail: this.erSurgeActive
          ? `SURGE ACTIVE: ${this.seed.erMetrics.arrivalsPerHour}/hr (threshold ${this.seed.erMetrics.surgeThreshold})`
          : `${this.seed.erMetrics.arrivalsPerHour}/hr arrivals (threshold ${this.seed.erMetrics.surgeThreshold})`,
      },
    ];

    const overall = clamp(Math.round(factors.reduce((s, f) => s + f.score * f.weight, 0)));
    const grade = overall >= 90 ? "A" : overall >= 75 ? "B" : overall >= 60 ? "C" : overall >= 40 ? "D" : "F";

    const worstFactors = factors
      .filter(f => f.status === "crit" || f.status === "warn")
      .sort((a, b) => a.score - b.score)
      .map(f => f.id);

    return { overall, grade, factors, worstFactors, timestamp: new Date().toISOString() };
  }

  runDiscreteEventSimulation(
    scenarioId: string,
    durationSec: number = 3
  ): Promise<void> {
    const s = this.simulations.get(scenarioId);
    if (!s) return Promise.resolve();
    s.status = "running";

    return new Promise((resolve) => {
      const surge = s.parameterOverrides.admissionRateMultiplier ?? 1;
      const beds = s.parameterOverrides.bedCountDelta ?? 0;
      const staffMultiplier = s.parameterOverrides.staffLevelMultiplier ?? 1;
      const procedureDuration = s.parameterOverrides.procedureDurationMultiplier ?? 1;

      const totalBeds = this.seed.rooms.reduce((sum, r) => sum + r.bedCount, 0) + beds;
      const totalPatients = this.seed.rooms.reduce((sum, r) => sum + r.occupiedBeds, 0);
      const baseOccupancy = totalBeds > 0 ? totalPatients / totalBeds : 0;

      const simSteps = Math.max(10, Math.round(durationSec * 20));
      let clock = 0;
      let occupancy = baseOccupancy;
      let waitSum = 0;
      let losSum = 0;
      let peakOcc = occupancy;
      let diversions = 0;
      let overtimeHrs = 0;

      const arrivalRate = (this.seed.erMetrics.arrivalsPerHour * surge) / 60;
      const dischargeRate = 1 / (4.2 * 24 * 60 * procedureDuration);

      for (let step = 0; step < simSteps; step++) {
        clock += 30;

        const arrivals = Math.random() < arrivalRate * 30 ? 1 : 0;
        const discharges = Math.random() < dischargeRate * 30 * totalPatients ? 1 : 0;

        occupancy = Math.max(0, Math.min(1.2, occupancy + (arrivals - discharges) / Math.max(1, totalBeds)));
        peakOcc = Math.max(peakOcc, occupancy);

        if (occupancy > 0.95) {
          waitSum += (occupancy - 0.95) * 200;
          diversions += Math.random() < 0.05 ? 1 : 0;
        }

        const staffNeeded = Math.ceil(occupancy * totalBeds / 4);
        const staffAvailable = Math.round(this.seed.staff.length * staffMultiplier);
        if (staffNeeded > staffAvailable) {
          overtimeHrs += (staffNeeded - staffAvailable) * 0.5;
        }

        losSum += 4.2 * procedureDuration + (occupancy > 0.85 ? 0.8 : 0);
      }

      setTimeout(() => {
        s.metrics = {
          avgERWaitMinutes: Math.max(0, Math.round((waitSum / simSteps + 15 * surge) * 10) / 10),
          avgLOSDays: Math.round((losSum / simSteps) * 100) / 100,
          peakOccupancy: Math.round(peakOcc * 1000) / 1000,
          staffOvertimeHours: Math.round(overtimeHrs * 10) / 10,
          equipmentUtilisation: Math.round(Math.min(1, 0.65 + occupancy * 0.3) * 1000) / 1000,
          diversionEvents: diversions,
        };
        s.runDurationSeconds = durationSec;
        s.status = "complete";
        s.baselineSnapshotDate = new Date().toISOString();
        resolve();
      }, durationSec * 1000);
    });
  }
}
