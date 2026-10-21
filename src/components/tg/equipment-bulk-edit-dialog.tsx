import { useEffect, useId, useState, type ReactNode } from "react";
import {
  addOrgTaxonomyTerm,
  getOrgTaxonomy,
  type EquipmentBulkPatch,
  type OrgTaxonomyApi,
  type OrgTaxonomyKind,
} from "@/lib/api";
import type { CalStatus } from "@/lib/mock-data";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { toast } from "sonner";

const emptyTaxonomy: OrgTaxonomyApi = {
  departments: [],
  categories: [],
  locations: [],
};

const ADD_NEW = "__tg_add_new__";

type BulkFieldKey =
  | "department"
  | "category"
  | "location"
  | "owner"
  | "responsible_email"
  | "status";

type EnabledFields = Record<BulkFieldKey, boolean>;

const defaultEnabled: EnabledFields = {
  department: false,
  category: false,
  location: false,
  owner: false,
  responsible_email: false,
  status: false,
};

function TaxonomySelect({
  id,
  value,
  options,
  onChange,
  emptyLabel,
  kind,
  onTaxonomyChange,
  allowManage,
  disabled,
}: {
  id: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
  emptyLabel: string;
  kind: OrgTaxonomyKind;
  onTaxonomyChange: (next: OrgTaxonomyApi) => void;
  allowManage: boolean;
  disabled?: boolean;
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
      disabled={disabled || adding}
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

function FieldToggle({
  id,
  label,
  checked,
  onCheckedChange,
  children,
}: {
  id: string;
  label: string;
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5 rounded-lg border border-border/80 bg-muted/20 p-3">
      <div className="flex items-center gap-2">
        <Checkbox
          id={id}
          checked={checked}
          onCheckedChange={(v) => onCheckedChange(v === true)}
        />
        <Label htmlFor={id} className="cursor-pointer text-sm font-medium">
          {label}
        </Label>
      </div>
      <div className={checked ? "" : "pointer-events-none opacity-45"}>{children}</div>
    </div>
  );
}

export function EquipmentBulkEditDialog({
  open,
  onOpenChange,
  count,
  onSubmit,
  saving,
  allowManageTaxonomy = true,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  count: number;
  onSubmit: (patch: EquipmentBulkPatch) => Promise<void>;
  saving?: boolean;
  allowManageTaxonomy?: boolean;
}) {
  const baseId = useId();
  const [taxonomy, setTaxonomy] = useState<OrgTaxonomyApi>(emptyTaxonomy);
  const [enabled, setEnabled] = useState<EnabledFields>(defaultEnabled);
  const [department, setDepartment] = useState("");
  const [category, setCategory] = useState("");
  const [location, setLocation] = useState("");
  const [owner, setOwner] = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<CalStatus>("inactive");

  useEffect(() => {
    if (!open) return;
    setEnabled({ ...defaultEnabled });
    setDepartment("");
    setCategory("");
    setLocation("");
    setOwner("");
    setEmail("");
    setStatus("inactive");
    void getOrgTaxonomy()
      .then(setTaxonomy)
      .catch(() => setTaxonomy(emptyTaxonomy));
  }, [open]);

  const setFieldEnabled = (key: BulkFieldKey, next: boolean) => {
    setEnabled((prev) => ({ ...prev, [key]: next }));
  };

  const anyEnabled = Object.values(enabled).some(Boolean);

  const handleSubmit = async () => {
    const patch: EquipmentBulkPatch = {};
    if (enabled.department) patch.department = department;
    if (enabled.category) patch.category = category;
    if (enabled.location) patch.location = location;
    if (enabled.owner) patch.owner = owner;
    if (enabled.responsible_email) patch.responsible_email = email.trim() || null;
    if (enabled.status) patch.status = status;

    if (Object.keys(patch).length === 0) {
      toast.error("Enable at least one field to update");
      return;
    }
    await onSubmit(patch);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Bulk update</DialogTitle>
          <DialogDescription>
            Apply the same values to {count} selected{" "}
            {count === 1 ? "item" : "items"}. Only checked fields are changed.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 py-1">
          <FieldToggle
            id={`${baseId}-en-dept`}
            label="Department"
            checked={enabled.department}
            onCheckedChange={(v) => setFieldEnabled("department", v)}
          >
            <TaxonomySelect
              id={`${baseId}-dept`}
              value={department}
              options={taxonomy.departments}
              onChange={setDepartment}
              emptyLabel="Select department"
              kind="departments"
              onTaxonomyChange={setTaxonomy}
              allowManage={allowManageTaxonomy}
              disabled={!enabled.department}
            />
          </FieldToggle>

          <FieldToggle
            id={`${baseId}-en-cat`}
            label="Category"
            checked={enabled.category}
            onCheckedChange={(v) => setFieldEnabled("category", v)}
          >
            <TaxonomySelect
              id={`${baseId}-cat`}
              value={category}
              options={taxonomy.categories}
              onChange={setCategory}
              emptyLabel="Select category"
              kind="categories"
              onTaxonomyChange={setTaxonomy}
              allowManage={allowManageTaxonomy}
              disabled={!enabled.category}
            />
          </FieldToggle>

          <FieldToggle
            id={`${baseId}-en-loc`}
            label="Location"
            checked={enabled.location}
            onCheckedChange={(v) => setFieldEnabled("location", v)}
          >
            <TaxonomySelect
              id={`${baseId}-loc`}
              value={location}
              options={taxonomy.locations}
              onChange={setLocation}
              emptyLabel="Select location"
              kind="locations"
              onTaxonomyChange={setTaxonomy}
              allowManage={allowManageTaxonomy}
              disabled={!enabled.location}
            />
          </FieldToggle>

          <FieldToggle
            id={`${baseId}-en-owner`}
            label="Owner"
            checked={enabled.owner}
            onCheckedChange={(v) => setFieldEnabled("owner", v)}
          >
            <Input
              id={`${baseId}-owner`}
              className="h-11 sm:h-9"
              value={owner}
              disabled={!enabled.owner}
              onChange={(e) => setOwner(e.target.value)}
              placeholder="Owner name"
            />
          </FieldToggle>

          <FieldToggle
            id={`${baseId}-en-email`}
            label="Responsible email"
            checked={enabled.responsible_email}
            onCheckedChange={(v) => setFieldEnabled("responsible_email", v)}
          >
            <Input
              id={`${baseId}-email`}
              type="email"
              className="h-11 sm:h-9"
              value={email}
              disabled={!enabled.responsible_email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@company.com"
            />
          </FieldToggle>

          <FieldToggle
            id={`${baseId}-en-status`}
            label="Status"
            checked={enabled.status}
            onCheckedChange={(v) => setFieldEnabled("status", v)}
          >
            <select
              id={`${baseId}-status`}
              className="tg-select h-11 sm:h-9"
              value={status}
              disabled={!enabled.status}
              onChange={(e) => setStatus(e.target.value as CalStatus)}
            >
              <option value="calibrated">Calibrated</option>
              <option value="due-soon">Due Soon</option>
              <option value="overdue">Overdue</option>
              <option value="failed">Failed</option>
              <option value="inactive">Inactive</option>
            </select>
          </FieldToggle>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={saving || !anyEnabled || count < 1}
          >
            {saving ? "Updating…" : `Update ${count}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
