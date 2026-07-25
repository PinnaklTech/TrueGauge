import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { AppEquipment, EquipmentPayload } from "@/lib/api";
import type { CalStatus } from "@/lib/mock-data";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Calendar } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const emptyForm: EquipmentPayload = {
  tag: "",
  name: "",
  category: "",
  manufacturer: "",
  model: "",
  serial: "",
  department: "",
  location: "",
  status: "inactive",
  last_calibration: "",
  next_calibration: "",
  frequency_days: 365,
  owner: "",
  responsible_email: "",
};

function fromEquipment(item: AppEquipment): EquipmentPayload {
  const toDateInput = (v: string) => (v ? v.slice(0, 10) : "");
  return {
    tag: item.tag,
    name: item.name,
    category: item.category,
    manufacturer: item.manufacturer,
    model: item.model,
    serial: item.serial,
    department: item.department,
    location: item.location,
    status: item.status,
    last_calibration: toDateInput(item.lastCalibration),
    next_calibration: toDateInput(item.nextCalibration),
    frequency_days: item.frequencyDays,
    owner: item.owner,
    responsible_email: item.responsibleEmail || "",
  };
}

export function EquipmentFormDialog({
  open,
  onOpenChange,
  mode,
  initial,
  onSubmit,
  saving,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  initial?: AppEquipment | null;
  onSubmit: (payload: EquipmentPayload) => Promise<void>;
  saving?: boolean;
}) {
  const [form, setForm] = useState<EquipmentPayload>(emptyForm);
  const [nameError, setNameError] = useState(false);
  const baseId = useId();

  useEffect(() => {
    if (!open) return;
    setForm(initial ? fromEquipment(initial) : { ...emptyForm });
    setNameError(false);
  }, [open, initial]);

  const set = <K extends keyof EquipmentPayload>(key: K, value: EquipmentPayload[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (key === "name") setNameError(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!form.name?.trim()) {
      setNameError(true);
      toast.error("Equipment name is required");
      return;
    }
    await onSubmit({
      tag: form.tag ?? "",
      name: form.name.trim(),
      category: form.category ?? "",
      manufacturer: form.manufacturer ?? "",
      model: form.model ?? "",
      serial: form.serial ?? "",
      department: form.department ?? "",
      location: form.location ?? "",
      status: form.status ?? "inactive",
      last_calibration: form.last_calibration || null,
      next_calibration: form.next_calibration || null,
      frequency_days: form.frequency_days ?? 365,
      owner: form.owner ?? "",
      responsible_email: form.responsible_email || null,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "New equipment" : "Edit equipment"}</DialogTitle>
          <DialogDescription>
            {mode === "create"
              ? "Add equipment directly in TrueGage. Odoo import is optional."
              : "Changes are saved in TrueGage only — they are not written back to Odoo."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field id={`${baseId}-name`} label="Name" required error={nameError ? "Name is required" : undefined}>
              <Input
                id={`${baseId}-name`}
                value={form.name ?? ""}
                onChange={(e) => set("name", e.target.value)}
                required
                aria-required
                aria-invalid={nameError}
                placeholder="Digital Micrometer"
              />
            </Field>
            <Field id={`${baseId}-tag`} label="Tag">
              <Input id={`${baseId}-tag`} value={form.tag ?? ""} onChange={(e) => set("tag", e.target.value)} placeholder="MIC-001" />
            </Field>
            <Field id={`${baseId}-serial`} label="Serial">
              <Input id={`${baseId}-serial`} value={form.serial ?? ""} onChange={(e) => set("serial", e.target.value)} />
            </Field>
            <Field id={`${baseId}-category`} label="Category">
              <Input id={`${baseId}-category`} value={form.category ?? ""} onChange={(e) => set("category", e.target.value)} />
            </Field>
            <Field id={`${baseId}-mfr`} label="Manufacturer">
              <Input id={`${baseId}-mfr`} value={form.manufacturer ?? ""} onChange={(e) => set("manufacturer", e.target.value)} />
            </Field>
            <Field id={`${baseId}-model`} label="Model">
              <Input id={`${baseId}-model`} value={form.model ?? ""} onChange={(e) => set("model", e.target.value)} />
            </Field>
            <Field id={`${baseId}-dept`} label="Department">
              <Input id={`${baseId}-dept`} value={form.department ?? ""} onChange={(e) => set("department", e.target.value)} />
            </Field>
            <Field id={`${baseId}-loc`} label="Location">
              <Input id={`${baseId}-loc`} value={form.location ?? ""} onChange={(e) => set("location", e.target.value)} />
            </Field>
            <Field id={`${baseId}-owner`} label="Owner">
              <Input id={`${baseId}-owner`} value={form.owner ?? ""} onChange={(e) => set("owner", e.target.value)} />
            </Field>
            <Field id={`${baseId}-email`} label="Responsible email">
              <Input
                id={`${baseId}-email`}
                type="email"
                value={form.responsible_email ?? ""}
                onChange={(e) => set("responsible_email", e.target.value)}
              />
            </Field>
            <Field id={`${baseId}-last`} label="Last calibration">
              <DateInput
                id={`${baseId}-last`}
                value={form.last_calibration ?? ""}
                onChange={(v) => set("last_calibration", v)}
              />
            </Field>
            <Field id={`${baseId}-next`} label="Next calibration">
              <DateInput
                id={`${baseId}-next`}
                value={form.next_calibration ?? ""}
                onChange={(v) => set("next_calibration", v)}
              />
            </Field>
            <Field id={`${baseId}-freq`} label="Frequency (days)">
              <Input
                id={`${baseId}-freq`}
                type="number"
                min={1}
                value={form.frequency_days ?? 365}
                onChange={(e) => set("frequency_days", Number(e.target.value) || 365)}
              />
            </Field>
            <Field id={`${baseId}-status`} label="Status">
              <select
                id={`${baseId}-status`}
                className="tg-select"
                value={form.status ?? "inactive"}
                onChange={(e) => set("status", e.target.value as CalStatus)}
              >
                <option value="calibrated">Calibrated</option>
                <option value="due-soon">Due Soon</option>
                <option value="overdue">Overdue</option>
                <option value="failed">Failed</option>
                <option value="inactive">Inactive</option>
              </select>
            </Field>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : mode === "create" ? "Create" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DateInput({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);

  const openPicker = () => {
    const el = ref.current;
    if (!el) return;
    try {
      el.showPicker();
    } catch {
      el.focus();
      el.click();
    }
  };

  return (
    <div className="relative">
      <Input
        ref={ref}
        id={id}
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          "tg-date-input pr-10",
          "[&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-y-0 [&::-webkit-calendar-picker-indicator]:right-0 [&::-webkit-calendar-picker-indicator]:w-10 [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-0",
        )}
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label="Open calendar"
        onClick={openPicker}
        className="tg-focus-ring absolute right-1 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <Calendar className="h-4 w-4" strokeWidth={2} />
      </button>
    </div>
  );
}

function Field({
  id,
  label,
  required,
  error,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <Label htmlFor={id} className="mb-1.5 block text-xs font-medium text-muted-foreground">
        {label}
        {required ? " *" : ""}
      </Label>
      {children}
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}
