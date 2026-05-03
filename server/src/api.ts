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

  // ── PFO: Rooms & Patient Flow ──────────────────────────────────────

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

  app.get(`${v1}/er/surge`, (_req: Request, res: Response) => {
    res.json(store.getErSurgeStatus());
  });

  app.post(`${v1}/beds/suggest`, (req: Request, res: Response) => {
    const body = req.body as { acuityScore?: number; preferredWard?: string };
    const acuity = body.acuityScore ?? 2;
    const suggestions = store.suggestBedAllocation(acuity, body.preferredWard);
    res.json({ suggestions });
  });

  // ── PFO: Alerts ────────────────────────────────────────────────────

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
      escalationLevel: 0,
    });
    res.status(201).json({ alertId, patientId });
  });

  // ── CEWS: Patient vitals & scoring ─────────────────────────────────

  app.get(`${v1}/twins/patients/:patientId/vitals`, (req: Request, res: Response) => {
    const pr = store.patients.get(req.params.patientId);
    if (!pr) return res.status(404).json({ error: "patient twin not found" });
    res.json({
      patientId: pr.patientId,
      ...pr.vitals,
      timestamp: pr.lastUpdated,
    });
  });

  app.get(`${v1}/twins/patients/:patientId/vitals/history`, (req: Request, res: Response) => {
    const pr = store.patients.get(req.params.patientId);
    if (!pr) return res.status(404).json({ error: "patient twin not found" });
    const hours = Number(req.query.hours) || 24;
    const history = store.getVitalsHistory(req.params.patientId, hours);
    res.json({ patientId: req.params.patientId, hours, readings: history });
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

  // ── CEWS: Alert management ─────────────────────────────────────────

  app.get(`${v1}/alerts`, (_req: Request, res: Response) => {
    const alerts = [...store.alerts.values()].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
    res.json({ alerts });
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

  app.get(`${v1}/alerts/fatigue`, (_req: Request, res: Response) => {
    res.json({ metrics: store.getAlertFatigueMetrics() });
  });

  // ── PEM: Medical equipment ─────────────────────────────────────────

  app.get(`${v1}/twins/assets`, (_req: Request, res: Response) => {
    const now = Date.now();
    res.json({
      assets: store.seed.assets.map((a) => {
        const dueDate = new Date(a.calibrationDueDate).getTime();
        const daysUntilCalibration = Math.ceil((dueDate - now) / 86400_000);
        return {
          deviceId: a.deviceId,
          deviceType: a.deviceType,
          location: a.location,
          assetHealthScore: a.assetHealthScore,
          maintenanceStatus: a.maintenanceStatus,
          failureProbability24h: a.failureProbability24h,
          failureProbability48h: a.failureProbability48h,
          failureProbability72h: a.failureProbability72h,
          calibrationDueDate: a.calibrationDueDate,
          daysUntilCalibration,
          calibrationStatus:
            daysUntilCalibration <= 0 ? "overdue" :
            daysUntilCalibration <= 3 ? "due_soon" :
            daysUntilCalibration <= 7 ? "upcoming" : "ok",
        };
      }),
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

    const replacements = store.seed.assets
      .filter(
        (d) =>
          d.deviceType === a.deviceType &&
          d.deviceId !== a.deviceId &&
          d.maintenanceStatus === "operational" &&
          d.assetHealthScore > 70
      )
      .map((d) => ({
        deviceId: d.deviceId,
        location: d.location,
        assetHealthScore: d.assetHealthScore,
      }));

    const wo = {
      workOrderId: randomUUID(),
      deviceId: a.deviceId,
      priority,
      scheduledDate: new Date(Date.now() + 86400000).toISOString(),
      status: "scheduled",
      createdAt: new Date().toISOString(),
    };
    store.workOrders.push(wo);
    res.status(201).json({
      ...wo,
      suggestedReplacements: replacements,
    });
  });

  // ── ISSA: Staff scheduling ─────────────────────────────────────────

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
        certifications: s.certifications,
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
      return res.json({ imbalance: false, recommendations: [], skillGaps: [], understaffing: [] });
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
      skillGaps: store.checkSkillGaps(),
      understaffing: store.predictUnderstaffing(),
    });
  });

  app.post(`${v1}/scheduling/schedules`, (req: Request, res: Response) => {
    const body = req.body as {
      wardId?: string;
      shifts?: { staffId: string; startHour: number; endHour: number; day: number }[];
    };
    if (!body.wardId) return res.status(400).json({ error: "wardId required" });

    const violations = body.shifts ? store.checkScheduleCompliance(body.shifts) : [];

    res.json({
      scheduleId: randomUUID(),
      wardId: body.wardId,
      complianceStatus: violations.some((v) => v.severity === "violation") ? "failed" : "ok",
      violations,
      publishedAt: null,
    });
  });

  app.get(`${v1}/scheduling/understaffing`, (_req: Request, res: Response) => {
    res.json({ alerts: store.predictUnderstaffing() });
  });

  app.get(`${v1}/scheduling/skill-gaps`, (_req: Request, res: Response) => {
    res.json({ gaps: store.checkSkillGaps() });
  });

  // ── WISE: Simulation ───────────────────────────────────────────────

  app.post(`${v1}/simulations/scenarios`, (req: Request, res: Response) => {
    const body = req.body as {
      name?: string;
      createdBy?: string;
      parameterOverrides?: Record<string, number>;
      template?: string;
    };

    let overrides = body.parameterOverrides ?? {
      admissionRateMultiplier: 1,
      bedCountDelta: 0,
    };

    if (body.template === "flu_surge") {
      overrides = {
        admissionRateMultiplier: 1.6,
        bedCountDelta: 0,
        staffLevelMultiplier: 1,
        procedureDurationMultiplier: 1.1,
        ...overrides,
      };
    } else if (body.template === "mass_casualty") {
      overrides = {
        admissionRateMultiplier: 2.5,
        bedCountDelta: 0,
        staffLevelMultiplier: 1.2,
        procedureDurationMultiplier: 0.8,
        ...overrides,
      };
    } else if (body.template === "ward_expansion") {
      overrides = {
        admissionRateMultiplier: 1,
        bedCountDelta: 10,
        staffLevelMultiplier: 1.3,
        procedureDurationMultiplier: 1,
        ...overrides,
      };
    }

    const scenarioId = randomUUID();
    store.simulations.set(scenarioId, {
      scenarioId,
      name: body.name ?? "Unnamed scenario",
      createdBy: body.createdBy ?? "demo-user",
      baselineSnapshotDate: new Date().toISOString(),
      parameterOverrides: overrides,
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

  app.get(`${v1}/simulations/templates`, (_req: Request, res: Response) => {
    res.json({
      templates: [
        {
          id: "flu_surge",
          name: "Seasonal Flu Surge",
          description: "Models a 60% increase in admissions over 2 weeks with longer treatment durations",
          defaultOverrides: {
            admissionRateMultiplier: 1.6,
            procedureDurationMultiplier: 1.1,
          },
        },
        {
          id: "mass_casualty",
          name: "Mass Casualty Event",
          description: "Models a 150% admission spike with emergency staffing and shortened procedures",
          defaultOverrides: {
            admissionRateMultiplier: 2.5,
            staffLevelMultiplier: 1.2,
            procedureDurationMultiplier: 0.8,
          },
        },
        {
          id: "ward_expansion",
          name: "Ward Expansion",
          description: "Models adding 10 beds with proportional staff increase",
          defaultOverrides: {
            bedCountDelta: 10,
            staffLevelMultiplier: 1.3,
          },
        },
      ],
    });
  });

  app.get(`${v1}/simulations/history`, (_req: Request, res: Response) => {
    const all = [...store.simulations.values()]
      .sort((a, b) => new Date(b.baselineSnapshotDate).getTime() - new Date(a.baselineSnapshotDate).getTime());
    res.json({ scenarios: all });
  });

  // ── Hospital Health Score ───────────────────────────────────────────

  app.get(`${v1}/hospital/health-score`, (_req: Request, res: Response) => {
    res.json(store.computeHealthScore());
  });

  // ── Sandbox ────────────────────────────────────────────────────────

  app.post(`${v1}/sandbox/patients`, (req: Request, res: Response) => {
    const body = req.body as { name?: string; age?: number; acuity?: number; wardId?: string; roomId?: string; bed?: string };
    if (!body.name || !body.wardId || !body.roomId || !body.bed) {
      return res.status(400).json({ error: "name, wardId, roomId, bed required" });
    }
    const result = store.addPatient({
      name: body.name,
      age: body.age ?? 50,
      acuity: body.acuity ?? 2,
      wardId: body.wardId,
      roomId: body.roomId,
      bed: body.bed,
    });
    if ("error" in result) return res.status(400).json(result);
    res.status(201).json(result);
  });

  app.delete(`${v1}/sandbox/patients/:patientId`, (req: Request, res: Response) => {
    const ok = store.dischargePatient(req.params.patientId);
    if (!ok) return res.status(404).json({ error: "patient not found" });
    res.json({ discharged: req.params.patientId });
  });

  app.put(`${v1}/sandbox/patients/:patientId/deteriorate`, (req: Request, res: Response) => {
    const { targetCewsScore } = req.body as { targetCewsScore?: number };
    if (targetCewsScore === undefined) return res.status(400).json({ error: "targetCewsScore required" });
    const ok = store.deterioratePatient(req.params.patientId, targetCewsScore);
    if (!ok) return res.status(404).json({ error: "patient not found" });
    res.json({ patientId: req.params.patientId, targetCewsScore });
  });

  app.post(`${v1}/sandbox/staff`, (req: Request, res: Response) => {
    const body = req.body as { role?: string; specialisations?: string[]; certifications?: string[]; shiftPattern?: string; wardId?: string };
    if (!body.role || !body.wardId) return res.status(400).json({ error: "role, wardId required" });
    const result = store.addStaff({
      role: body.role,
      specialisations: body.specialisations ?? [],
      certifications: body.certifications ?? [],
      shiftPattern: body.shiftPattern ?? "Days",
      wardId: body.wardId,
    });
    res.status(201).json(result);
  });

  app.delete(`${v1}/sandbox/staff/:staffId`, (req: Request, res: Response) => {
    const ok = store.removeStaff(req.params.staffId);
    if (!ok) return res.status(404).json({ error: "staff not found" });
    res.json({ removed: req.params.staffId });
  });

  app.put(`${v1}/sandbox/staff/:staffId`, (req: Request, res: Response) => {
    const body = req.body as { wardId?: string; assignedPatientIds?: string[]; specialisations?: string[]; certifications?: string[] };
    const ok = store.updateStaff(req.params.staffId, body);
    if (!ok) return res.status(404).json({ error: "staff not found" });
    res.json({ updated: req.params.staffId });
  });

  app.post(`${v1}/sandbox/assets`, (req: Request, res: Response) => {
    const body = req.body as { deviceType?: string; manufacturer?: string; location?: string; assetHealthScore?: number; failureProbability24h?: number; failureProbability48h?: number; failureProbability72h?: number };
    if (!body.deviceType || !body.location) return res.status(400).json({ error: "deviceType, location required" });
    const result = store.addAsset({
      deviceType: body.deviceType,
      manufacturer: body.manufacturer ?? "Unknown",
      location: body.location,
      assetHealthScore: body.assetHealthScore ?? 90,
      failureProbability24h: body.failureProbability24h ?? 0.05,
      failureProbability48h: body.failureProbability48h ?? 0.08,
      failureProbability72h: body.failureProbability72h ?? 0.12,
    });
    res.status(201).json(result);
  });

  app.put(`${v1}/sandbox/assets/:deviceId`, (req: Request, res: Response) => {
    const body = req.body as { assetHealthScore?: number; failureProbability24h?: number; maintenanceStatus?: string };
    const ok = store.updateAsset(req.params.deviceId, body);
    if (!ok) return res.status(404).json({ error: "asset not found" });
    res.json({ updated: req.params.deviceId });
  });

  app.delete(`${v1}/sandbox/assets/:deviceId`, (req: Request, res: Response) => {
    const ok = store.removeAsset(req.params.deviceId);
    if (!ok) return res.status(404).json({ error: "asset not found" });
    res.json({ removed: req.params.deviceId });
  });

  app.put(`${v1}/sandbox/er-metrics`, (req: Request, res: Response) => {
    const body = req.body as { arrivalsPerHour?: number; surgeThreshold?: number };
    store.updateErMetrics(body);
    res.json({ erMetrics: store.seed.erMetrics });
  });

  app.put(`${v1}/sandbox/wards/:wardId`, (req: Request, res: Response) => {
    const body = req.body as { staffRatio?: number; capacity?: number };
    const ok = store.updateWard(req.params.wardId, body);
    if (!ok) return res.status(404).json({ error: "ward not found" });
    res.json({ updated: req.params.wardId });
  });

  app.post(`${v1}/sandbox/events/equipment-failure`, (req: Request, res: Response) => {
    const { deviceId } = req.body as { deviceId?: string };
    if (!deviceId) return res.status(400).json({ error: "deviceId required" });
    const ok = store.triggerEquipmentFailure(deviceId);
    if (!ok) return res.status(404).json({ error: "asset not found" });
    res.json({ triggered: deviceId });
  });

  app.post(`${v1}/sandbox/events/patient-spike`, (req: Request, res: Response) => {
    const body = req.body as { count?: number; acuityRange?: [number, number] };
    const count = body.count ?? 3;
    const range = body.acuityRange ?? [2, 6];
    const created = store.triggerPatientSpike(count, range);
    res.status(201).json({ created, count: created.length });
  });

  app.post(`${v1}/sandbox/events/surge`, (_req: Request, res: Response) => {
    store.triggerSurge();
    res.json({ surgeActive: true, arrivalsPerHour: store.seed.erMetrics.arrivalsPerHour });
  });

  app.post(`${v1}/sandbox/reset`, async (_req: Request, res: Response) => {
    await store.resetToSeed();
    res.json({ reset: true });
  });

  // ── Discharge Workflow ────────────────────────────────────────────

  app.post(`${v1}/discharge/initiate`, (req: Request, res: Response) => {
    const body = req.body as { patientId?: string; destination?: string };
    if (!body.patientId) return res.status(400).json({ error: "patientId required" });
    const dest = (body.destination ?? "home") as "home" | "rehab" | "ltc" | "transfer" | "ama";
    const wf = store.initiateDischarge(body.patientId, dest);
    res.status(201).json(wf);
  });

  app.get(`${v1}/discharge/active`, (_req: Request, res: Response) => {
    const workflows = [...store.dischargeWorkflows.values()].filter(w => w.status !== "completed");
    res.json({ workflows });
  });

  app.put(`${v1}/discharge/:workflowId/checklist/:itemId`, (req: Request, res: Response) => {
    const { completed, completedBy } = req.body as { completed?: boolean; completedBy?: string };
    const wf = store.toggleDischargeChecklist(req.params.workflowId, req.params.itemId, completed ?? true, completedBy);
    if (!wf) return res.status(404).json({ error: "workflow or item not found" });
    res.json(wf);
  });

  app.put(`${v1}/discharge/:workflowId/complete`, (req: Request, res: Response) => {
    const wf = store.completeDischarge(req.params.workflowId);
    if (!wf) return res.status(404).json({ error: "workflow not found" });
    res.json(wf);
  });

  // ── Patient Transfer ──────────────────────────────────────────────

  app.post(`${v1}/transfers/initiate`, (req: Request, res: Response) => {
    const body = req.body as { patientId?: string; targetWardId?: string; targetRoomId?: string; targetBed?: string; reason?: string };
    if (!body.patientId || !body.targetWardId || !body.targetRoomId || !body.targetBed) {
      return res.status(400).json({ error: "patientId, targetWardId, targetRoomId, targetBed required" });
    }
    const result = store.initiateTransfer({
      patientId: body.patientId,
      targetWardId: body.targetWardId,
      targetRoomId: body.targetRoomId,
      targetBed: body.targetBed,
      reason: body.reason ?? "",
    });
    if ("error" in result) return res.status(400).json(result);
    res.status(201).json(result);
  });

  app.put(`${v1}/transfers/:transferId/complete`, (req: Request, res: Response) => {
    const result = store.completeTransfer(req.params.transferId);
    if (!result) return res.status(404).json({ error: "transfer not found" });
    res.json(result);
  });

  app.get(`${v1}/transfers/active`, (_req: Request, res: Response) => {
    const transfers = [...store.transfers.values()].filter(t => t.status === "pending");
    res.json({ transfers });
  });

  // ── ER Queue ──────────────────────────────────────────────────────

  app.get(`${v1}/er/queue`, (_req: Request, res: Response) => {
    const active = store.erQueue.filter(e => e.status !== "discharged" && e.status !== "admitted");
    const avgWait = active.length > 0
      ? Math.round(active.reduce((s, e) => s + e.estimatedWaitMinutes, 0) / active.length)
      : 0;
    res.json({ queue: store.erQueue, activeCount: active.length, avgWaitMinutes: avgWait });
  });

  app.post(`${v1}/er/queue`, (req: Request, res: Response) => {
    const body = req.body as { patientName?: string; triageLevel?: number; chiefComplaint?: string };
    if (!body.patientName || !body.triageLevel || !body.chiefComplaint) {
      return res.status(400).json({ error: "patientName, triageLevel, chiefComplaint required" });
    }
    const entry = store.addToERQueue({
      patientName: body.patientName,
      triageLevel: body.triageLevel as 1 | 2 | 3 | 4 | 5,
      chiefComplaint: body.chiefComplaint,
    });
    res.status(201).json(entry);
  });

  app.put(`${v1}/er/queue/:entryId/status`, (req: Request, res: Response) => {
    const { status } = req.body as { status?: string };
    if (!status) return res.status(400).json({ error: "status required" });
    const entry = store.updateERQueueStatus(req.params.entryId, status as "waiting" | "in_triage" | "being_seen" | "admitted" | "discharged");
    if (!entry) return res.status(404).json({ error: "entry not found" });
    res.json(entry);
  });

  // ── Handoff Notes ─────────────────────────────────────────────────

  app.post(`${v1}/handoffs`, (req: Request, res: Response) => {
    const body = req.body as { patientId?: string; fromStaffId?: string; toStaffId?: string; situation?: string; background?: string; assessment?: string; recommendation?: string };
    if (!body.patientId || !body.fromStaffId || !body.toStaffId) {
      return res.status(400).json({ error: "patientId, fromStaffId, toStaffId required" });
    }
    const note = store.addHandoffNote({
      patientId: body.patientId,
      fromStaffId: body.fromStaffId,
      toStaffId: body.toStaffId,
      situation: body.situation ?? "",
      background: body.background ?? "",
      assessment: body.assessment ?? "",
      recommendation: body.recommendation ?? "",
    });
    res.status(201).json(note);
  });

  app.get(`${v1}/handoffs/:patientId`, (req: Request, res: Response) => {
    const notes = store.handoffNotes.get(req.params.patientId) ?? [];
    res.json({ notes });
  });

  // ── Bed Turnaround ────────────────────────────────────────────────

  app.get(`${v1}/beds/turnaround`, (_req: Request, res: Response) => {
    const active = store.bedTurnarounds.filter(t => !t.readyAt);
    const completed = store.bedTurnarounds.filter(t => t.readyAt && t.turnaroundMinutes);
    const avgMinutes = completed.length > 0
      ? Math.round(completed.reduce((s, t) => s + (t.turnaroundMinutes ?? 0), 0) / completed.length)
      : 0;
    res.json({ turnarounds: store.bedTurnarounds, activeCleaning: active.length, avgTurnaroundMinutes: avgMinutes });
  });

  app.put(`${v1}/beds/turnaround/:id/cleaning-started`, (req: Request, res: Response) => {
    const result = store.startCleaning(req.params.id);
    if (!result) return res.status(404).json({ error: "turnaround not found" });
    res.json(result);
  });

  app.put(`${v1}/beds/turnaround/:id/ready`, (req: Request, res: Response) => {
    const result = store.markBedReady(req.params.id);
    if (!result) return res.status(404).json({ error: "turnaround not found" });
    res.json(result);
  });

  // ── DTDL & Demo ────────────────────────────────────────────────────

  app.get(`${v1}/dtdl/models`, (_req: Request, res: Response) => {
    res.json({
      interfaces: [
        "dtmi:carethread:hospital:Room;1",
        "dtmi:carethread:hospital:Ward;1",
        "dtmi:carethread:clinical:PatientTwin;1",
        "dtmi:carethread:clinical:Alert;1",
        "dtmi:carethread:asset:MedicalDevice;1",
        "dtmi:carethread:asset:MaintenanceWorkOrder;1",
        "dtmi:carethread:staff:StaffMember;1",
        "dtmi:carethread:staff:ShiftSchedule;1",
        "dtmi:carethread:simulation:Scenario;1",
        "dtmi:carethread:simulation:SimulationResult;1",
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
