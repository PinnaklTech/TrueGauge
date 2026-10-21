import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  addOrgTaxonomyTerm,
  getOrgTaxonomy,
  type AppEquipment,
  type EquipmentPayload,
  type OrgTaxonomyApi,
  type OrgTaxonomyKind,
} from "@/lib/api";
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
import { differenceInCalendarDays, parseISO, isValid } from "date-fns";
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
  status: "calibrated",
  last_calibration: "",
  next_calibration: "",
  frequency_days: 365,
  owner: "",
  responsible_email: "",
};

function frequencyFromDates(last: string | null | undefined, next: string | null | undefined): number | null {
  if (!last || !next) return null;
  const a = parseISO(last.slice(0, 10));
  const b = parseISO(next.slice(0, 10));
  if (!isValid(a) || !isValid(b)) return null;
  const days = differenceInCalendarDays(b, a);
  return days > 0 ? days : null;
}

const emptyTaxonomy: OrgTaxonomyApi = {
  departments: [],
  categories: [],
  locations: [],
};

const ADD_NEW = "__tg_add_new__";

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

function TaxonomySelect({
  id,
  value,
  options,
  onChange,
  emptyLabel,
  kind,
  onTaxonomyChange,
  allowManage,
}: {
  id: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
  emptyLabel: string;
  kind: OrgTaxonomyKind;
  onTaxonomyChange: (next: OrgTaxonomyApi) => void;
  allowManage: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const merged =
    value && !options.some((o) => o === value) ? [...options, value] : options;

  const handleChange = async (raw: string) => {
    if (raw !== ADD_NEW) {
      onChange(raw);
      return;
    }
    const label =
      kind === "departments" ? "department" : kind === "categories" ? "category" : "location";
    const entered = window.prompt(`New ${label} name`)?.trim();
    if (!entered) return;
    setAdding(true);
    try {
      const next = await addOrgTaxonomyTerm(kind, entered);
      onTaxonomyChange(next);
      onChange(entered);
      toast.success(`Added ${label}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add");
    } finally {
      setAdding(false);
    }
  };

  return (
    <select
      id={id}
      className="tg-select h-11 sm:h-9"
      value={value}
      disabled={adding}
      onChange={(e) => void handleChange(e.target.value)}
    >
      <option value="">{emptyLabel}</option>
      {merged.map((opt) => (
        <option key={opt} value={opt}>
          {opt}
        </option>
      ))}
      {allowManage ? <option value={ADD_NEW}>+ Add new…</option> : null}
    </select>
  );
}

export function EquipmentFormDialog({
  open,
  onOpenChange,
  mode,
  initial,
  onSubmit,
  saving,
  allowManageTaxonomy = true,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  initial?: AppEquipment | null;
  onSubmit: (payload: EquipmentPayload) => Promise<void>;
  saving?: boolean;
  /** QA / technician / admin can create terms from the form. */
  allowManageTaxonomy?: boolean;
}) {
  const [form, setForm] = useState<EquipmentPayload>(emptyForm);
  const [nameError, setNameError] = useState(false);
  const [taxonomy, setTaxonomy] = useState<OrgTaxonomyApi>(emptyTaxonomy);
  const baseId = useId();

  useEffect(() => {
    if (!open) return;
    setForm(initial ? fromEquipment(initial) : { ...emptyForm });
    setNameError(false);
    void getOrgTaxonomy()
      .then(setTaxonomy)
      .catch(() => setTaxonomy(emptyTaxonomy));
  }, [open, initial]);

  const set = <K extends keyof EquipmentPayload>(key: K, value: EquipmentPayload[K]) => {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      if (key === "last_calibration" || key === "next_calibration") {
        const computed = frequencyFromDates(
          key === "last_calibration" ? String(value ?? "") : next.last_calibration,
          key === "next_calibration" ? String(value ?? "") : next.next_calibration,
        );
        if (computed != null) next.frequency_days = computed;
      }
      return next;
    });
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
    const computedFreq =
      frequencyFromDates(form.last_calibration, form.next_calibration) ??
      form.frequency_days ??
      365;
    if (form.last_calibration && form.next_calibration && computedFreq < 1) {
      toast.error("Next calibration must be after last calibration");
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
      status: form.status ?? "calibrated",
      last_calibration: form.last_calibration || null,
      next_calibration: form.next_calibration || null,
      frequency_days: computedFreq,
      owner: form.owner ?? "",
      responsible_email: form.responsible_email || null,
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (
          !next &&
          typeof window !== "undefined" &&
          sessionStorage.getItem("tg-tour-running") === "1" &&
          document.body.classList.contains("tg-tour-form-expanded")
        ) {
          return;
        }
        onOpenChange(next);
      }}
    >
      <DialogContent
        className={cn(
          "flex max-h-[100dvh] w-full flex-col gap-0 overflow-hidden p-0 sm:max-h-[90vh] sm:max-w-lg sm:rounded-lg",
          "top-0 left-0 h-[100dvh] max-w-none translate-x-0 translate-y-0 rounded-none",
          "sm:top-[50%] sm:left-[50%] sm:h-auto sm:translate-x-[-50%] sm:translate-y-[-50%]",
        )}
        data-tour={mode === "create" ? "equipment-create-dialog" : undefined}
      >
        <DialogHeader className="shrink-0 space-y-1 border-b border-border px-4 py-4 pr-12 text-left sm:px-6">
          <DialogTitle>{mode === "create" ? "New equipment" : "Edit equipment"}</DialogTitle>
          <DialogDescription className="text-sm">
            {mode === "create"
              ? "Add equipment directly in TheTruegage. Odoo import is optional."
              : "Changes are saved in TheTruegage only — they are not written back to Odoo."}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => void handleSubmit(e)}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="tg-scrollbar min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4 sm:px-6">
            <FormSection title="Identity">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field
                  id={`${baseId}-name`}
                  label="Name"
                  required
                  error={nameError ? "Name is required" : undefined}
                  className="sm:col-span-2"
                >
                  <Input
                    id={`${baseId}-name`}
                    className="h-11 sm:h-9"
                    value={form.name ?? ""}
                    onChange={(e) => set("name", e.target.value)}
                    required
                    aria-required
                    aria-invalid={nameError}
                    placeholder="e.g. Digital caliper"
                    autoFocus
                  />
                </Field>
                <Field id={`${baseId}-tag`} label="Tag">
                  <Input
                    id={`${baseId}-tag`}
                    className="h-11 sm:h-9"
                    value={form.tag ?? ""}
                    onChange={(e) => set("tag", e.target.value)}
                  />
                </Field>
                <Field id={`${baseId}-serial`} label="Serial">
                  <Input
                    id={`${baseId}-serial`}
                    className="h-11 sm:h-9"
                    value={form.serial ?? ""}
                    onChange={(e) => set("serial", e.target.value)}
                  />
                </Field>
                <Field id={`${baseId}-category`} label="Category">
                  <TaxonomySelect
                    id={`${baseId}-category`}
                    value={form.category ?? ""}
                    options={taxonomy.categories}
                    onChange={(v) => set("category", v)}
                    emptyLabel="Select category"
                    kind="categories"
                    onTaxonomyChange={setTaxonomy}
                    allowManage={allowManageTaxonomy}
                  />
                </Field>
                <Field id={`${baseId}-status`} label="Status">
                  <select
                    id={`${baseId}-status`}
                    className="tg-select h-11 sm:h-9"
                    value={form.status ?? "calibrated"}
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
            </FormSection>

            <FormSection title="Manufacturer">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field id={`${baseId}-mfr`} label="Manufacturer">
                  <Input
                    id={`${baseId}-mfr`}
                    className="h-11 sm:h-9"
                    value={form.manufacturer ?? ""}
                    onChange={(e) => set("manufacturer", e.target.value)}
                  />
                </Field>
                <Field id={`${baseId}-model`} label="Model">
                  <Input
                    id={`${baseId}-model`}
                    className="h-11 sm:h-9"
                    value={form.model ?? ""}
                    onChange={(e) => set("model", e.target.value)}
                  />
                </Field>
              </div>
            </FormSection>

            <FormSection title="Location & ownership">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field id={`${baseId}-dept`} label="Department">
                  <TaxonomySelect
                    id={`${baseId}-dept`}
                    value={form.department ?? ""}
                    options={taxonomy.departments}
                    onChange={(v) => set("department", v)}
                    emptyLabel="Select department"
                    kind="departments"
                    onTaxonomyChange={setTaxonomy}
                    allowManage={allowManageTaxonomy}
                  />
                </Field>
                <Field id={`${baseId}-loc`} label="Location">
                  <TaxonomySelect
                    id={`${baseId}-loc`}
                    value={form.location ?? ""}
                    options={taxonomy.locations}
                    onChange={(v) => set("location", v)}
                    emptyLabel="Select location"
                    kind="locations"
                    onTaxonomyChange={setTaxonomy}
                    allowManage={allowManageTaxonomy}
                  />
                </Field>
                <Field id={`${baseId}-owner`} label="Owner">
                  <Input
                    id={`${baseId}-owner`}
                    className="h-11 sm:h-9"
                    value={form.owner ?? ""}
                    onChange={(e) => set("owner", e.target.value)}
                  />
                </Field>
                <Field id={`${baseId}-email`} label="Responsible email">
                  <Input
                    id={`${baseId}-email`}
                    className="h-11 sm:h-9"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    value={form.responsible_email ?? ""}
                    onChange={(e) => set("responsible_email", e.target.value)}
                  />
                </Field>
              </div>
            </FormSection>

            <FormSection title="Calibration schedule">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                <Field
                  id={`${baseId}-freq`}
                  label="Frequency (days)"
                  className="sm:col-span-2"
                  error={
                    form.last_calibration &&
                    form.next_calibration &&
                    frequencyFromDates(form.last_calibration, form.next_calibration) == null
                      ? "Next date must be after last date"
                      : undefined
                  }
                >
                  <Input
                    id={`${baseId}-freq`}
                    type="number"
                    min={1}
                    value={
                      frequencyFromDates(form.last_calibration, form.next_calibration) ??
                      form.frequency_days ??
                      ""
                    }
                    readOnly
                    className="h-11 bg-muted/40 sm:h-9"
                    title="Calculated from last and next calibration dates"
                  />
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Auto-calculated from last → next calibration
                  </p>
                </Field>
              </div>
            </FormSection>
          </div>

          <DialogFooter className="shrink-0 flex-col gap-2 border-t border-border bg-background px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:flex-row sm:justify-end sm:space-x-0 sm:px-6 sm:py-4">
            <Button
              type="button"
              variant="outline"
              className="h-11 w-full sm:h-9 sm:w-auto"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="submit" className="h-11 w-full sm:h-9 sm:w-auto" disabled={saving}>
              {saving ? "Saving…" : mode === "create" ? "Create" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function FormSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
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
          "tg-date-input h-11 pr-11 sm:h-9 sm:pr-10",
          "[&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-y-0 [&::-webkit-calendar-picker-indicator]:right-0 [&::-webkit-calendar-picker-indicator]:w-11 [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-0 sm:[&::-webkit-calendar-picker-indicator]:w-10",
        )}
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label="Open calendar"
        onClick={openPicker}
        className="tg-focus-ring absolute right-1 top-1/2 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground sm:h-7 sm:w-7"
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
  className,
}: {
  id: string;
  label: string;
  required?: boolean;
  error?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label htmlFor={id} className="mb-1.5 block text-xs font-medium text-muted-foreground">
        {label}
        {required ? " *" : ""}
      </Label>
      {children}
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}
