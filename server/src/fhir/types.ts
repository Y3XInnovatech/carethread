export type FhirResource = Record<string, unknown>;

export interface BundleEntry {
  fullUrl?: string;
  resource: FhirResource;
}

export interface FhirBundle {
  resourceType: "Bundle";
  type: string;
  entry?: BundleEntry[];
}
