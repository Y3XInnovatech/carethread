export type Role =
  | "Administrator"
  | "Clinician"
  | "Nurse"
  | "EquipmentTechnician"
  | "Pharmacist"
  | "SystemAdmin"
  | "HospitalPlanner";

const ROLE_PERMISSIONS: Record<Role, string[]> = {
  Administrator: ["*"],
  SystemAdmin: ["*"],
  Clinician: [
    "rooms:read",
    "patients:read",
    "patients:vitals",
    "patients:cews",
    "alerts:read",
    "alerts:acknowledge",
    "er:read",
    "er:queue",
    "beds:suggest",
    "scheduling:read",
    "simulations:read",
    "discharge:*",
    "transfer:*",
    "handoff:*",
  ],
  Nurse: [
    "rooms:read",
    "patients:read",
    "patients:vitals",
    "patients:cews",
    "alerts:read",
    "alerts:acknowledge",
    "alerts:discharge",
    "er:read",
    "er:queue",
    "scheduling:read",
    "scheduling:recommendations",
    "discharge:*",
    "transfer:*",
    "handoff:*",
  ],
  EquipmentTechnician: [
    "assets:read",
    "assets:health",
    "assets:maintenance",
    "rooms:read",
  ],
  Pharmacist: [
    "rooms:read",
    "patients:read",
    "er:read",
  ],
  HospitalPlanner: [
    "rooms:read",
    "patients:read",
    "er:read",
    "scheduling:read",
    "simulations:read",
    "simulations:create",
    "simulations:compare",
    "simulations:templates",
    "simulations:history",
    "assets:read",
  ],
};

export function hasPermission(role: string, permission: string): boolean {
  const perms = ROLE_PERMISSIONS[role as Role];
  if (!perms) return false;
  if (perms.includes("*")) return true;
  return perms.includes(permission);
}
