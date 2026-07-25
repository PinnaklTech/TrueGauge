export type CalStatus = "calibrated" | "due-soon" | "overdue" | "failed" | "inactive";

export interface Equipment {
  id: string;
  tag: string;
  name: string;
  category: string;
  manufacturer: string;
  model: string;
  serial: string;
  department: string;
  location: string;
  status: CalStatus;
  lastCalibration: string; // iso date
  nextCalibration: string;
  frequencyDays: number;
  owner: string;
}

export interface CalibrationRecord {
  id: string;
  equipmentId: string;
  equipmentTag: string;
  equipmentName: string;
  date: string;
  dueDate: string;
  result: "pass" | "fail" | "conditional";
  provider: string;
  type: "internal" | "external";
  technician: string;
  certificateNo: string;
  notes?: string;
}

export interface ActivityItem {
  id: string;
  who: string;
  action: string;
  target: string;
  when: string;
}

export interface Certificate {
  id: string;
  number: string;
  equipmentTag: string;
  equipmentName: string;
  issuedBy: string;
  issuedOn: string;
  expiresOn: string;
  fileType: "pdf" | "image";
  sizeKb: number;
  version: number;
}

export interface NotificationItem {
  id: string;
  type: "reminder" | "system" | "activity";
  title: string;
  body: string;
  when: string;
  read: boolean;
}

export const equipment: Equipment[] = [];

export const calibrations: CalibrationRecord[] = [];

export const activity: ActivityItem[] = [];

export const certificates: Certificate[] = calibrations.map((c, i) => ({
  id: `cert-${i + 1}`,
  number: c.certificateNo,
  equipmentTag: c.equipmentTag,
  equipmentName: c.equipmentName,
  issuedBy: c.provider,
  issuedOn: c.date,
  expiresOn: c.dueDate,
  fileType: i % 3 === 0 ? "image" : "pdf",
  sizeKb: 120 + i * 43,
  version: 1 + (i % 2),
}));

export const notifications: NotificationItem[] = [];

export const kpis = () => {
  const total = equipment.length;
  const overdue = equipment.filter((e) => e.status === "overdue" || e.status === "failed").length;
  const dueSoon = equipment.filter((e) => e.status === "due-soon").length;
  const completedThisMonth = calibrations.filter((c) => new Date(c.date).getMonth() === new Date().getMonth()).length;
  return { total, overdue, dueSoon, completedThisMonth };
};

export const statusLabel: Record<CalStatus, string> = {
  calibrated: "Calibrated",
  "due-soon": "Due Soon",
  overdue: "Overdue",
  failed: "Failed",
  inactive: "Inactive",
};
