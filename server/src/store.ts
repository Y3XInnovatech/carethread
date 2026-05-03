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
  responseCode?: string;
  message: string;
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

export class CareThreadStore {
  seed!: OperationalSeed;
  ehr!: DemoEhrIndex;
  patients: Map<string, PatientRuntime> = new Map();
  alerts: Map<string, RuntimeAlert> = new Map();
  workOrders: {
    workOrderId: string;
    deviceId: string;
    priority: string;
    scheduledDate: string;
    status: string;
  }[] = [];
  simulations: Map<
    string,
    {
      scenarioId: string;
      name: string;
      createdBy: string;
      baselineSnapshotDate: string;
      parameterOverrides: Record<string, number>;
      status: "pending" | "complete";
      runDurationSeconds?: number;
      metrics?: Record<string, number>;
    }
  > = new Map();

  async init(ehr: DemoEhrIndex) {
    this.ehr = ehr;
    const raw = await readFile(
      join(DEMO_DATA_DIR, "operational-seed.json"),
      "utf-8"
    );
    this.seed = JSON.parse(raw) as OperationalSeed;

    const patientIds = new Set<string>();
    for (const r of this.seed.rooms) {
      for (const pid of Object.values(r.bedPatientMap)) {
        patientIds.add(pid);
      }
    }
    for (const pid of patientIds) {
      this.patients.set(pid, this.initialPatientRuntime(pid));
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

  /** IoT simulation tick — small drift + re-score */
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
      pr.lastUpdated = now;

      this.maybeRaiseAlert(pr, subscores);
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
    };
    this.alerts.set(alertId, alert);
  }

  acknowledgeAlert(alertId: string, body: { userId: string; reasonCode: string }) {
    const a = this.alerts.get(alertId);
    if (!a) return null;
    a.acknowledged = true;
    a.acknowledgedBy = body.userId;
    a.responseCode = body.reasonCode;
    return a;
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

  runDiscreteEventSimulation(
    scenarioId: string,
    durationSec: number = 3
  ): Promise<void> {
    const s = this.simulations.get(scenarioId);
    if (!s) return Promise.resolve();
    s.status = "pending";
    return new Promise((resolve) => {
      setTimeout(() => {
        const surge = s.parameterOverrides.admissionRateMultiplier ?? 1;
        const beds = s.parameterOverrides.bedCountDelta ?? 0;
        s.metrics = {
          avgERWaitMinutes: 45 * surge - beds * 0.8 + Math.random() * 8,
          avgLOSDays: 4.2 + surge * 0.6,
          peakOccupancy: 0.82 + surge * 0.07,
          staffOvertimeHours: 120 + surge * 40,
          equipmentUtilisation: 0.71 + surge * 0.05,
          diversionEvents: surge > 1.2 ? Math.round(surge * 2) : 0,
        };
        s.runDurationSeconds = durationSec;
        s.status = "complete";
        s.baselineSnapshotDate = new Date().toISOString();
        resolve();
      }, durationSec * 1000);
    });
  }
}
