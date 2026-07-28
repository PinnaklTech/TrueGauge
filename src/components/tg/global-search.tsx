import { useNavigate } from "@tanstack/react-router";
import {
  BarChart3,
  Bell,
  CalendarClock,
  FileCheck2,
  LayoutDashboard,
  Loader2,
  Search,
  Settings,
  User as UserIcon,
  Wrench,
} from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  listCertificates,
  listEquipment,
  type AppCertificate,
} from "@/lib/api";
import type { Equipment } from "@/lib/mock-data";
import { canAccessSettings } from "@/lib/rbac";
import { cn } from "@/lib/utils";

const RESULT_LIMIT = 8;
const MIN_QUERY = 2;
const DEBOUNCE_MS = 250;

type GoToKey =
  | "dashboard"
  | "equipment"
  | "calibrations"
  | "certificates"
  | "reports"
  | "notifications"
  | "settings"
  | "profile";

const GO_TO: {
  key: GoToKey;
  label: string;
  icon: typeof LayoutDashboard;
}[] = [
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { key: "equipment", label: "Equipment", icon: Wrench },
  { key: "calibrations", label: "Calibrations", icon: CalendarClock },
  { key: "certificates", label: "Certificates", icon: FileCheck2 },
  { key: "reports", label: "Reports & Compliance", icon: BarChart3 },
  { key: "notifications", label: "Notifications", icon: Bell },
  { key: "settings", label: "Settings", icon: Settings },
  { key: "profile", label: "Profile", icon: UserIcon },
];

function useModKeyLabel() {
  const [label, setLabel] = useState("Ctrl");
  useEffect(() => {
    const mac = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
    setLabel(mac ? "⌘" : "Ctrl");
  }, []);
  return label;
}

export function GlobalSearch({
  workspaceSlug,
  storageEnabled,
  role,
}: {
  workspaceSlug: string;
  storageEnabled: boolean;
  role?: string | null;
}) {
  const navigate = useNavigate();
  const modKey = useModKeyLabel();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [certificates, setCertificates] = useState<AppCertificate[]>([]);
  const requestId = useRef(0);
  const titleId = useId();

  const close = useCallback(() => {
    setOpen(false);
  }, []);

  const openSearch = useCallback(() => {
    if (!workspaceSlug) return;
    setOpen(true);
  }, [workspaceSlug]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (!workspaceSlug) return;
        setOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [workspaceSlug]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setEquipment([]);
      setCertificates([]);
      setLoading(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < MIN_QUERY) {
      setEquipment([]);
      setCertificates([]);
      setLoading(false);
      return;
    }

    const id = ++requestId.current;
    setLoading(true);
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const [eqRes, certRes] = await Promise.all([
            listEquipment({ q }),
            storageEnabled
              ? listCertificates({ q })
              : Promise.resolve({ items: [] as AppCertificate[], total: 0 }),
          ]);
          if (id !== requestId.current) return;
          setEquipment(eqRes.items.slice(0, RESULT_LIMIT));
          setCertificates(certRes.items.slice(0, RESULT_LIMIT));
        } catch {
          if (id !== requestId.current) return;
          setEquipment([]);
          setCertificates([]);
        } finally {
          if (id === requestId.current) setLoading(false);
        }
      })();
    }, DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [query, open, storageEnabled]);

  const goTo = useCallback(
    (key: GoToKey) => {
      close();
      const slug = workspaceSlug;
      switch (key) {
        case "dashboard":
          void navigate({ to: "/workspace/$slug", params: { slug } });
          break;
        case "equipment":
          void navigate({ to: "/workspace/$slug/equipment", params: { slug } });
          break;
        case "calibrations":
          void navigate({ to: "/workspace/$slug/calibrations", params: { slug } });
          break;
        case "certificates":
          void navigate({ to: "/workspace/$slug/certificates", params: { slug } });
          break;
        case "reports":
          void navigate({ to: "/workspace/$slug/reports", params: { slug } });
          break;
        case "notifications":
          void navigate({ to: "/workspace/$slug/notifications", params: { slug } });
          break;
        case "settings":
          void navigate({ to: "/workspace/$slug/settings", params: { slug } });
          break;
        case "profile":
          void navigate({ to: "/workspace/$slug/profile", params: { slug } });
          break;
      }
    },
    [close, navigate, workspaceSlug],
  );

  const goEquipment = useCallback(
    (id: string) => {
      close();
      void navigate({
        to: "/workspace/$slug/equipment/$id",
        params: { slug: workspaceSlug, id },
      });
    },
    [close, navigate, workspaceSlug],
  );

  const goCertificate = useCallback(
    (cert: AppCertificate) => {
      close();
      if (cert.equipmentId) {
        void navigate({
          to: "/workspace/$slug/equipment/$id",
          params: { slug: workspaceSlug, id: cert.equipmentId },
        });
        return;
      }
      void navigate({
        to: "/workspace/$slug/certificates",
        params: { slug: workspaceSlug },
      });
    },
    [close, navigate, workspaceSlug],
  );

  const searching = query.trim().length >= MIN_QUERY;
  const hasResults = equipment.length > 0 || certificates.length > 0;
  const showEmpty = searching && !loading && !hasResults;
  const goToItems = GO_TO.filter((item) => item.key !== "settings" || canAccessSettings(role));

  if (!workspaceSlug) return null;

  return (
    <>
      <button
        type="button"
        onClick={openSearch}
        className={cn(
          "tg-focus-ring hidden w-full max-w-md items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:border-border-strong hover:bg-muted/40 md:flex",
        )}
        aria-label="Search workspace"
      >
        <Search className="h-3.5 w-3.5 shrink-0" />
        <span className="flex-1 truncate text-left">Search equipment, certificates…</span>
        <kbd className="pointer-events-none hidden shrink-0 items-center gap-0.5 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground sm:inline-flex">
          {modKey}
          <span className="text-[9px]">K</span>
        </kbd>
      </button>

      <button
        type="button"
        onClick={openSearch}
        className="tg-focus-ring inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted md:hidden"
        aria-label="Search workspace"
      >
        <Search className="h-4 w-4" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="overflow-hidden p-0 shadow-lg sm:max-w-lg [&>button]:hidden"
          aria-labelledby={titleId}
        >
          <DialogTitle id={titleId} className="sr-only">
            Search workspace
          </DialogTitle>
          <Command shouldFilter={false} className="rounded-lg border-0">
            <CommandInput
              placeholder="Search equipment, certificates…"
              value={query}
              onValueChange={setQuery}
            />
            <CommandList>
              {loading ? (
                <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Searching…
                </div>
              ) : null}

              {showEmpty ? <CommandEmpty>No results found.</CommandEmpty> : null}

              {!searching ? (
                <CommandGroup heading="Go to">
                  {goToItems.map((item) => {
                    const Icon = item.icon;
                    return (
                      <CommandItem
                        key={item.key}
                        value={`goto-${item.key}`}
                        onSelect={() => goTo(item.key)}
                      >
                        <Icon className="text-muted-foreground" />
                        <span>{item.label}</span>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              ) : null}

              {searching && !loading && equipment.length > 0 ? (
                <CommandGroup heading="Equipment">
                  {equipment.map((item) => (
                    <CommandItem
                      key={item.id}
                      value={`eq-${item.id}`}
                      onSelect={() => goEquipment(item.id)}
                    >
                      <Wrench className="text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{item.name || item.tag}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {[item.tag, item.serial].filter(Boolean).join(" · ")}
                        </p>
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ) : null}

              {searching && !loading && certificates.length > 0 ? (
                <>
                  {equipment.length > 0 ? <CommandSeparator /> : null}
                  <CommandGroup heading="Certificates">
                    {certificates.map((cert) => (
                      <CommandItem
                        key={cert.id}
                        value={`cert-${cert.id}`}
                        onSelect={() => goCertificate(cert)}
                      >
                        <FileCheck2 className="text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">{cert.fileName}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {[cert.equipmentTag, cert.equipmentName].filter(Boolean).join(" · ")}
                          </p>
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </>
              ) : null}
            </CommandList>
          </Command>
        </DialogContent>
      </Dialog>
    </>
  );
}
