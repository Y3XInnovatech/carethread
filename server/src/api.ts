import type { Express, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import type { CareThreadStore } from "./store.js";
import { computeNews2, contributingFactors } from "./cews/news2.js";

function patientDisplayName(store: CareThreadStore, patientId: string): string {
  const p = store.ehr.patients.get(patientId);
  if (!p) return patientId;
  const names = p.name as { family?: string; given?: string[] }[] | undefined;
  const n = names?.[0];
  if (!n) return patientId;
  return [n.given?.join(" "), n.family].filter(Boolean).join(" ");
}

export function registerApi(app: Express, store: CareThreadStore) {
  const v1 = "/api/v1";

  app.get(`${v1}/twins/rooms`, (_req: Request, res: Response) => {
    const rooms = store.seed.rooms.map((r) => ({
      roomId: r.id,
      wardId: r.wardId,
      bedCount: r.bedCount,
      occupiedBeds: r.occupiedBeds,
      roomType: r.roomType,
      cleaningStatus: r.cleaningStatus,
      occupancyRate: r.bedCount ? r.occupiedBeds / r.bedCount : 0,
      patients: Object.entries(r.bedPatientMap).map(([bed, patientId]) => ({
        bed,
        patientId,
        displayName: patientDisplayName(store, patientId),
      })),
    }));
    res.json({ rooms, updatedAt: new Date().toISOString() });
  });

  app.get(`${v1}/twins/rooms/:roomId/forecast`, (req: Request, res: Response) => {
    const f = store.forecastRoom(req.params.roomId);
    if (!f) return res.status(404).json({ error: "room not found" });
    res.json(f);
  });

  app.post(`${v1}/alerts/discharge`, (req: Request, res: Response) => {
    const patientId = (req.body as { patientId?: string }).patientId;
    if (!patientId) return res.status(400).json({ error: "patientId required" });
    const alertId = randomUUID();
    store.alerts.set(alertId, {
      alertId,
      severity: "advisory",
      type: "discharge_readiness",
      patientId,
      timestamp: new Date().toISOString(),
      acknowledged: false,
      message: `Discharge coordination suggested for ${patientDisplayName(store, patientId)}`,
    });
    res.status(201).json({ alertId, patientId });
  });

  app.get(`${v1}/twins/patients/:patientId/vitals`, (req: Request, res: Response) => {
    const pr = store.patients.get(req.params.patientId);
    if (!pr) return res.status(404).json({ error: "patient twin not found" });
    res.json({
      patientId: pr.patientId,
      ...pr.vitals,
      timestamp: pr.lastUpdated,
    });
  });

  app.get(`${v1}/twins/patients/:patientId/cews`, (req: Request, res: Response) => {
    const pr = store.patients.get(req.params.patientId);
    if (!pr) return res.status(404).json({ error: "patient twin not found" });
    const { subscores } = computeNews2(pr.vitals);
    res.json({
      patientId: pr.patientId,
      cewsScore: pr.cewsScore,
      deteriorationProbability30m: pr.deteriorationProb30m,
      deteriorationProbability60m: pr.deteriorationProb60m,
      sepsisFlag: pr.sepsisFlag,
      fallRiskScore: pr.fallRiskScore,
      contributingFactors: contributingFactors(subscores).map((c) => ({
        feature: c.feature,
        relativeWeight: c.weight,
      })),
      lastUpdated: pr.lastUpdated,
    });
  });

  app.post(`${v1}/alerts/:alertId/acknowledge`, (req: Request, res: Response) => {
    const { userId, reasonCode } = req.body as {
      userId?: string;
      reasonCode?: string;
    };
    if (!userId || !reasonCode) {
      return res.status(400).json({ error: "userId and reasonCode required" });
    }
    const a = store.acknowledgeAlert(req.params.alertId, { userId, reasonCode });
    if (!a) return res.status(404).json({ error: "alert not found" });
    res.json(a);
  });

  app.get(`${v1}/twins/assets`, (_req: Request, res: Response) => {
    res.json({
      assets: store.seed.assets.map((a) => ({
        deviceId: a.deviceId,
        deviceType: a.deviceType,
        location: a.location,
        assetHealthScore: a.assetHealthScore,
        maintenanceStatus: a.maintenanceStatus,
        failureProbability24h: a.failureProbability24h,
      })),
    });
  });

  app.get(`${v1}/twins/assets/:assetId/health`, (req: Request, res: Response) => {
    const a = store.seed.assets.find((x) => x.deviceId === req.params.assetId);
    if (!a) return res.status(404).json({ error: "asset not found" });
    res.json({
      ...a,
      telemetry: {
        cycleCount: 128_400 + Math.floor(Math.random() * 2000),
        internalTempC: 41 + Math.random() * 2,
        vibrationRMS: 0.8 + Math.random() * 0.15,
        errorCodeRate: a.failureProbability24h * 0.5,
        timestamp: new Date().toISOString(),
      },
    });
  });

  app.post(`${v1}/assets/:assetId/maintenance`, (req: Request, res: Response) => {
    const a = store.seed.assets.find((x) => x.deviceId === req.params.assetId);
    if (!a) return res.status(404).json({ error: "asset not found" });
    const priority = (req.body as { priority?: string }).priority ?? "routine";
    const wo = {
      workOrderId: randomUUID(),
      deviceId: a.deviceId,
      priority,
      scheduledDate: new Date(Date.now() + 86400000).toISOString(),
      status: "scheduled",
    };
    store.workOrders.push(wo);
    res.status(201).json(wo);
  });

  app.get(`${v1}/twins/staff`, (_req: Request, res: Response) => {
    const out = store.seed.staff.map((s) => {
      const acuityLoad = s.assignedPatientIds.reduce((sum, pid) => {
        const pr = store.patients.get(pid);
        return sum + (pr ? pr.cewsScore * 0.15 : 0);
      }, 0);
      const workloadScore = Math.min(
        10,
        s.assignedPatientIds.length * 2.2 + acuityLoad
      );
      const fatigueIndex = Math.min(
        10,
        workloadScore * 0.85 + (s.shiftPattern === "Rotating" ? 1.2 : 0)
      );
      return {
        staffId: s.staffId,
        role: s.role,
        specialisations: s.specialisations,
        currentWardId: s.currentWardId,
        assignedPatientIds: s.assignedPatientIds,
        workloadScore: Math.round(workloadScore * 10) / 10,
        fatigueIndex: Math.round(fatigueIndex * 10) / 10,
        burnoutRisk:
          fatigueIndex > 7.5 ? "high" : fatigueIndex > 5.5 ? "medium" : "low",
      };
    });
    res.json({ staff: out });
  });

  app.get(`${v1}/scheduling/recommendations`, (_req: Request, res: Response) => {
    const staff = store.seed.staff.map((s) => {
      const load = s.assignedPatientIds.length;
      return { staffId: s.staffId, load };
    });
    const sorted = [...staff].sort((a, b) => b.load - a.load);
    const [high, low] = [sorted[0], sorted[sorted.length - 1]];
    if (!high || !low || high.staffId === low.staffId) {
      return res.json({ imbalance: false, recommendations: [] });
    }
    const movable =
      store.seed.staff.find((s) => s.staffId === high.staffId)
        ?.assignedPatientIds[0] ?? null;
    res.json({
      imbalance: true,
      recommendations: [
        {
          action: "reassign_patient",
          fromStaffId: high.staffId,
          toStaffId: low.staffId,
          patientId: movable,
          expectedDeltaWorkload: {
            [high.staffId]: -2.1,
            [low.staffId]: 2.1,
          },
        },
      ],
    });
  });

  app.post(`${v1}/scheduling/schedules`, (req: Request, res: Response) => {
    const body = req.body as { wardId?: string; shifts?: unknown[] };
    if (!body.wardId) return res.status(400).json({ error: "wardId required" });
    res.json({
      scheduleId: randomUUID(),
      wardId: body.wardId,
      complianceStatus: "ok",
      violations: [],
      publishedAt: null,
    });
  });

  app.post(`${v1}/simulations/scenarios`, (req: Request, res: Response) => {
    const body = req.body as {
      name?: string;
      createdBy?: string;
      parameterOverrides?: Record<string, number>;
    };
    const scenarioId = randomUUID();
    store.simulations.set(scenarioId, {
      scenarioId,
      name: body.name ?? "Unnamed scenario",
      createdBy: body.createdBy ?? "demo-user",
      baselineSnapshotDate: new Date().toISOString(),
      parameterOverrides: body.parameterOverrides ?? {
        admissionRateMultiplier: 1,
        bedCountDelta: 0,
      },
      status: "pending",
    });
    void store.runDiscreteEventSimulation(scenarioId, 2);
    res.status(201).json({ scenarioId, status: "pending" });
  });

  app.get(`${v1}/simulations/scenarios/:id/results`, (req: Request, res: Response) => {
    const s = store.simulations.get(req.params.id);
    if (!s) return res.status(404).json({ error: "scenario not found" });
    res.json(s);
  });

  app.get(`${v1}/simulations/scenarios/compare`, (req: Request, res: Response) => {
    const ids = String(req.query.ids ?? "")
      .split(",")
      .filter(Boolean)
      .slice(0, 4);
    const scenarios = ids
      .map((id) => store.simulations.get(id))
      .filter(Boolean);
    res.json({ scenarios });
  });

  app.get(`${v1}/dtdl/models`, (_req: Request, res: Response) => {
    res.json({
      interfaces: [
        "dtmi:carethread:hospital:Room;1",
        "dtmi:carethread:clinical:PatientTwin;1",
        "dtmi:carethread:asset:MedicalDevice;1",
        "dtmi:carethread:staff:StaffMember;1",
      ],
      note: "JSON definitions live in /carethread/dtdl (demo — not uploaded to ADT)",
    });
  });

  app.get(`${v1}/demo/ehr/summary`, (_req: Request, res: Response) => {
    res.json({
      patients: store.ehr.patients.size,
      encounters: store.ehr.encounters.size,
      bundleFile: "demo-data/fhir/demo-ehr-bundle.json",
    });
  });
}
