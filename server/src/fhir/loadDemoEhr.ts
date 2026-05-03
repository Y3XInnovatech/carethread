import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { DEMO_DATA_DIR } from "../paths.js";
import type { FhirBundle, FhirResource } from "./types.js";

function refId(ref: string): string {
  const parts = ref.split("/");
  return parts[parts.length - 1] ?? ref;
}

export interface DemoEhrIndex {
  patients: Map<string, FhirResource>;
  encounters: Map<string, FhirResource>;
  encountersByPatient: Map<string, FhirResource[]>;
  conditionsByPatient: Map<string, FhirResource[]>;
  observationsByPatient: Map<string, FhirResource[]>;
  practitioners: Map<string, FhirResource>;
  devices: Map<string, FhirResource>;
  medicationRequestsByPatient: Map<string, FhirResource[]>;
}

export async function loadDemoEhr(): Promise<DemoEhrIndex> {
  const raw = await readFile(
    join(DEMO_DATA_DIR, "fhir", "demo-ehr-bundle.json"),
    "utf-8"
  );
  const bundle = JSON.parse(raw) as FhirBundle;

  const idx: DemoEhrIndex = {
    patients: new Map(),
    encounters: new Map(),
    encountersByPatient: new Map(),
    conditionsByPatient: new Map(),
    observationsByPatient: new Map(),
    practitioners: new Map(),
    devices: new Map(),
    medicationRequestsByPatient: new Map(),
  };

  for (const e of bundle.entry ?? []) {
    const r = e.resource;
    const type = r.resourceType as string | undefined;
    if (!type) continue;

    const id = r.id as string | undefined;
    if (type === "Patient" && id) {
      idx.patients.set(id, r);
    } else if (type === "Encounter" && id) {
      idx.encounters.set(id, r);
      const sub = (r.subject as { reference?: string } | undefined)?.reference;
      if (sub) {
        const pid = refId(sub);
        const list = idx.encountersByPatient.get(pid) ?? [];
        list.push(r);
        idx.encountersByPatient.set(pid, list);
      }
    } else if (type === "Condition" && id) {
      const sub = (r.subject as { reference?: string } | undefined)?.reference;
      if (sub) {
        const pid = refId(sub);
        const list = idx.conditionsByPatient.get(pid) ?? [];
        list.push(r);
        idx.conditionsByPatient.set(pid, list);
      }
    } else if (type === "Observation" && id) {
      const sub = (r.subject as { reference?: string } | undefined)?.reference;
      if (sub) {
        const pid = refId(sub);
        const list = idx.observationsByPatient.get(pid) ?? [];
        list.push(r);
        idx.observationsByPatient.set(pid, list);
      }
    } else if (type === "Practitioner" && id) {
      idx.practitioners.set(id, r);
    } else if (type === "Device" && id) {
      idx.devices.set(id, r);
    } else if (type === "MedicationRequest" && id) {
      const sub = (r.subject as { reference?: string } | undefined)?.reference;
      if (sub) {
        const pid = refId(sub);
        const list = idx.medicationRequestsByPatient.get(pid) ?? [];
        list.push(r);
        idx.medicationRequestsByPatient.set(pid, list);
      }
    }
  }

  return idx;
}
