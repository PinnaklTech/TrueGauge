export type EquipmentColumnKey =
  | "tag"
  | "name"
  | "serial"
  | "category"
  | "department"
  | "location"
  | "lastCalibration"
  | "nextCalibration"
  | "status"
  | "owner"
  | "manufacturer"
  | "model"
  | "responsibleEmail";

export type EquipmentColumnDef = {
  key: EquipmentColumnKey;
  label: string;
  /** Identity column — always shown, not toggleable in the Columns menu. */
  required?: boolean;
  defaultVisible: boolean;
};

export const EQUIPMENT_COLUMN_DEFS: EquipmentColumnDef[] = [
  { key: "tag", label: "Tag ID", defaultVisible: true },
  { key: "name", label: "Gauge / Equipment Name", required: true, defaultVisible: true },
  { key: "serial", label: "Serial No", defaultVisible: true },
  { key: "manufacturer", label: "Manufacturer", defaultVisible: false },
  { key: "model", label: "Model", defaultVisible: false },
  { key: "category", label: "Category", defaultVisible: true },
  { key: "department", label: "Department", defaultVisible: true },
  { key: "location", label: "Location", defaultVisible: true },
  { key: "owner", label: "Owner", defaultVisible: false },
  { key: "responsibleEmail", label: "Responsible email", defaultVisible: false },
  { key: "lastCalibration", label: "Last Calibration", defaultVisible: true },
  { key: "nextCalibration", label: "Next Due", defaultVisible: true },
  { key: "status", label: "Status", defaultVisible: true },
];

export type EquipmentColumnVisibility = Record<EquipmentColumnKey, boolean>;

function defaultVisibility(): EquipmentColumnVisibility {
  const out = {} as EquipmentColumnVisibility;
  for (const col of EQUIPMENT_COLUMN_DEFS) {
    out[col.key] = col.defaultVisible;
  }
  return out;
}

function storageKey(slug: string) {
  return `tg-equipment-columns:${slug}`;
}

export function loadEquipmentColumns(slug: string): EquipmentColumnVisibility {
  const base = defaultVisibility();
  if (typeof window === "undefined") return base;
  try {
    const raw = localStorage.getItem(storageKey(slug));
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<Record<EquipmentColumnKey, boolean>>;
    for (const col of EQUIPMENT_COLUMN_DEFS) {
      if (col.required) {
        base[col.key] = true;
        continue;
      }
      if (typeof parsed[col.key] === "boolean") {
        base[col.key] = parsed[col.key]!;
      }
    }
    return base;
  } catch {
    return base;
  }
}

export function saveEquipmentColumns(slug: string, visibility: EquipmentColumnVisibility) {
  if (typeof window === "undefined") return;
  const toSave: Partial<Record<EquipmentColumnKey, boolean>> = {};
  for (const col of EQUIPMENT_COLUMN_DEFS) {
    if (col.required) continue;
    toSave[col.key] = visibility[col.key];
  }
  localStorage.setItem(storageKey(slug), JSON.stringify(toSave));
}

export function visibleColumnCount(visibility: EquipmentColumnVisibility): number {
  return EQUIPMENT_COLUMN_DEFS.filter((c) => visibility[c.key]).length;
}
