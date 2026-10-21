import { Link, useNavigate, useParams, useRouterState } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  LayoutDashboard,
  Wrench,
  CalendarClock,
  FileCheck2,
  BarChart3,
  Bell,
  Settings,
  Sun,
  Moon,
  LogOut,
  Gauge,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  User as UserIcon,
  ScanLine,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { workspacePath } from "@/lib/workspace";
import {
  endWorkspaceBoot,
  isWorkspaceBootActive,
  takeWelcomeToast,
} from "@/lib/workspace-boot";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import {
  getMe,
  getOrgProfile,
  listEquipment,
  listNotifications,
  logout,
  type AuthUser,
} from "@/lib/api";
import { clearToken, isAuthenticated } from "@/lib/auth";
import {
  complianceScore,
  roleDisplayLabel,
  userInitials,
  type UserProfile,
} from "@/lib/compliance";
import {
  bindProductTourCallbacks,
  getSavedTourStep,
  isProductTourActive,
  pathForTourStep,
  startProductTour,
  type TourRoute,
} from "@/lib/product-tour";
import { needsOnboarding, canManageEquipmentTaxonomy } from "@/lib/rbac";
import { GlobalSearch } from "@/components/tg/global-search";
import { OnboardingProfileDialog } from "@/components/tg/onboarding-profile-dialog";

type NavKey =
  | "dashboard"
  | "equipment"
  | "calibrations"
  | "certificates"
  | "reports"
  | "notifications"
  | "settings";

const nav: {
  key: NavKey;
  label: string;
  icon: typeof LayoutDashboard;
  exact?: boolean;
  tour: string;
  group: "main" | "insights" | "admin";
}[] = [
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard, exact: true, tour: "nav-dashboard", group: "main" },
  { key: "equipment", label: "Equipment", icon: Wrench, tour: "nav-equipment", group: "main" },
  { key: "calibrations", label: "Calibrations", icon: CalendarClock, tour: "nav-calibrations", group: "main" },
  { key: "certificates", label: "Certificates", icon: FileCheck2, tour: "nav-certificates", group: "main" },
  { key: "reports", label: "Reports", icon: BarChart3, tour: "nav-reports", group: "insights" },
  { key: "notifications", label: "Notifications", icon: Bell, tour: "nav-notifications", group: "insights" },
  { key: "settings", label: "Settings", icon: Settings, tour: "nav-settings", group: "admin" },
];

const NAV_GROUP_LABEL: Record<"main" | "insights" | "admin", string> = {
  main: "Workspace",
  insights: "Insights",
  admin: "Admin",
};

const iconBtn =
  "tg-focus-ring inline-flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted md:h-8 md:w-8 md:rounded-md";

function toUserProfile(u: AuthUser): UserProfile {
  return {
    fullName: u.full_name,
    email: u.email,
    jobTitle: u.job_title,
    department: u.department,
    phone: u.phone,
    role: u.role,
    timezone: u.timezone,
    locale: u.locale,
    notifyEmail: u.notify_email,
    notifyInApp: u.notify_in_app,
  };
}

function navHref(slug: string, key: NavKey): string {
  switch (key) {
    case "dashboard":
      return workspacePath(slug);
    case "equipment":
      return workspacePath(slug, "equipment");
    case "calibrations":
      return workspacePath(slug, "calibrations");
    case "certificates":
      return workspacePath(slug, "certificates");
    case "reports":
      return workspacePath(slug, "reports");
    case "notifications":
      return workspacePath(slug, "notifications");
    case "settings":
      return workspacePath(slug, "settings");
  }
}


export function AppShell({
  children,
  title,
  breadcrumbs,
  hidePageHeader,
  autoCollapseSidebar,
}: {
  children: ReactNode;
  title?: string;
  breadcrumbs?: { label: string; to?: string }[];
  hidePageHeader?: boolean;
  /** When true, collapse the desktop sidebar on mount (e.g. Settings). */
  autoCollapseSidebar?: boolean;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const params = useParams({ strict: false }) as { slug?: string };
  const queryClient = useQueryClient();
  const { theme, toggle } = useTheme();
  // Always start false so SSR HTML matches the first client paint (avoids hydration mismatch).
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const sidebarBeforeTour = useRef<boolean | null>(null);
  const tourStarted = useRef(false);
  const [tourPaused, setTourPaused] = useState(false);
  const [tourRunning, setTourRunning] = useState(false);
  const bootEnded = useRef(false);

  useLayoutEffect(() => {
    if (!isAuthenticated()) {
      endWorkspaceBoot();
      window.location.href = "/auth/login";
      return;
    }
    setAuthReady(true);
    if (autoCollapseSidebar) {
      setCollapsed(true);
    } else if (localStorage.getItem("tg-sidebar-collapsed") === "1") {
      setCollapsed(true);
    }
    if (sessionStorage.getItem("tg-tour-paused") === "1") {
      setTourPaused(true);
    }
  }, [autoCollapseSidebar]);

  useEffect(() => {
    if (!authReady) return;
    localStorage.setItem("tg-sidebar-collapsed", collapsed ? "1" : "0");
  }, [collapsed, authReady]);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const equipmentQuery = useQuery({
    queryKey: ["equipment"],
    queryFn: () => listEquipment(),
    enabled: authReady,
    staleTime: 30_000,
  });
  const { data } = equipmentQuery;
  const { data: notifData } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => listNotifications(),
    enabled: authReady,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const { data: me, refetch: refetchMe } = useQuery({
    queryKey: ["me"],
    queryFn: getMe,
    enabled: authReady,
    staleTime: 5 * 60_000,
  });
  const { data: org, refetch: refetchOrg } = useQuery({
    queryKey: ["org"],
    queryFn: getOrgProfile,
    enabled: authReady,
    staleTime: 5 * 60_000,
  });

  // Keep the full-screen boot overlay until shell + core dashboard data are ready.
  useEffect(() => {
    if (!authReady || bootEnded.current) return;
    if (!equipmentQuery.isFetched && !equipmentQuery.isError) return;
    bootEnded.current = true;
    const welcome = takeWelcomeToast();
    endWorkspaceBoot();
    if (welcome) toast.success(welcome);
  }, [authReady, equipmentQuery.isFetched, equipmentQuery.isError]);

  // Safety: never leave the boot overlay stuck if a request hangs.
  useEffect(() => {
    if (!isWorkspaceBootActive()) return;
    const timer = window.setTimeout(() => {
      if (bootEnded.current) return;
      bootEnded.current = true;
      const welcome = takeWelcomeToast();
      endWorkspaceBoot();
      if (welcome) toast.success(welcome);
    }, 12_000);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const onProfile = (ev: Event) => {
      const detail = (ev as CustomEvent).detail;
      if (detail && typeof detail === "object" && "id" in detail) {
        queryClient.setQueryData(["me"], detail);
      }
      void refetchMe();
    };
    const onOrg = () => void refetchOrg();
    window.addEventListener("tg-user-profile-updated", onProfile);
    window.addEventListener("tg-org-profile-updated", onOrg);
    return () => {
      window.removeEventListener("tg-user-profile-updated", onProfile);
      window.removeEventListener("tg-org-profile-updated", onOrg);
    };
  }, [queryClient, refetchMe, refetchOrg]);

  const equipment = data?.items ?? [];
  const readiness = complianceScore(equipment);
  const unread = notifData?.unread ?? 0;
  const orgName = me?.tenant_name?.trim() || org?.company_name?.trim() || "Workspace";
  const user: UserProfile | null = me ? toUserProfile(me) : null;
  const displayName = user?.fullName.trim() || "User";
  const displayRole = user
    ? `${roleDisplayLabel(user.role)}${user.department ? ` · ${user.department}` : ""}`
    : "…";
  const initials = user ? userInitials(user) : "…";
  // Only show Settings after role is known — avoids flicker on page remounts
  const isAdmin = me?.role === "admin" || me?.role === "platform_admin";
  const workspaceSlug = (params.slug || me?.tenant_slug || "").trim();
  const visibleNav = nav.filter((item) => item.key !== "settings" || isAdmin);

  const goTourRoute = async (to: TourRoute) => {
    if (!workspaceSlug) return;
    if (to === "dashboard") {
      await navigate({ to: "/workspace/$slug", params: { slug: workspaceSlug } });
      return;
    }
    if (to === "equipment") {
      await navigate({ to: "/workspace/$slug/equipment", params: { slug: workspaceSlug } });
      return;
    }
    if (to === "calibrations") {
      await navigate({ to: "/workspace/$slug/calibrations", params: { slug: workspaceSlug }, search: {} });
      return;
    }
    if (to === "certificates") {
      await navigate({ to: "/workspace/$slug/certificates", params: { slug: workspaceSlug } });
      return;
    }
    if (to === "reports") {
      await navigate({ to: "/workspace/$slug/reports", params: { slug: workspaceSlug } });
      return;
    }
    if (to === "notifications") {
      await navigate({ to: "/workspace/$slug/notifications", params: { slug: workspaceSlug } });
      return;
    }
  };

  const needsProfileSetup =
    !!me && needsOnboarding(me.role) && !me.profile_setup_at;
  const needsTour =
    !!me && needsOnboarding(me.role) && !!me.profile_setup_at && !me.product_tour_at;
  const includeLists = canManageEquipmentTaxonomy(me?.role);

  const tourShellCallbacks = () => ({
    includeLists,
    navigateTo: goTourRoute,
    onExpandSidebar: () => setCollapsed(false),
    onRestoreSidebar: () => {
      if (sidebarBeforeTour.current !== null) {
        setCollapsed(sidebarBeforeTour.current);
        sidebarBeforeTour.current = null;
      }
    },
    onPaused: () => {
      tourStarted.current = false;
      setTourRunning(false);
      setTourPaused(true);
      sessionStorage.removeItem("tg-tour-running");
      sessionStorage.setItem("tg-tour-paused", "1");
    },
    onFinished: () => {
      tourStarted.current = false;
      setTourRunning(false);
      setTourPaused(false);
      sessionStorage.removeItem("tg-tour-running");
      sessionStorage.removeItem("tg-tour-paused");
      sessionStorage.removeItem("tg-tour-resume");
      sessionStorage.removeItem("tg-tour-step");
      void queryClient.setQueryData(["me"], (prev: AuthUser | undefined) =>
        prev ? { ...prev, product_tour_at: new Date().toISOString() } : prev,
      );
      void queryClient.invalidateQueries({ queryKey: ["me"] });
    },
  });

  // Keep tour callbacks alive across AppShell remounts (each page wraps its own shell)
  useEffect(() => {
    bindProductTourCallbacks(tourShellCallbacks());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, collapsed, includeLists, me?.role, workspaceSlug]);

  const launchTour = async (opts?: { startAt?: number; fresh?: boolean }) => {
    const startAt = opts?.fresh ? 0 : (opts?.startAt ?? getSavedTourStep());
    const target = pathForTourStep(startAt, includeLists);

    // Ensure we're on the right page before starting; remount will rebind & continue
    if (opts?.fresh) {
      sessionStorage.removeItem("tg-tour-step");
    }

    const onTarget =
      (target === "dashboard" && /\/workspace\/[^/]+\/?$/.test(pathname)) ||
      (target === "equipment" && pathname.includes("/equipment")) ||
      (target === "calibrations" && pathname.includes("/calibrations")) ||
      (target === "certificates" && pathname.includes("/certificates")) ||
      (target === "reports" && pathname.includes("/reports")) ||
      (target === "notifications" && pathname.includes("/notifications"));

    if (!onTarget && workspaceSlug) {
      sessionStorage.setItem("tg-tour-resume", "1");
      sessionStorage.removeItem("tg-tour-paused");
      if (!opts?.fresh) sessionStorage.setItem("tg-tour-step", String(startAt));
      setTourPaused(false);
      await goTourRoute(target);
      return;
    }

    tourStarted.current = true;
    setTourPaused(false);
    setTourRunning(true);
    sessionStorage.removeItem("tg-tour-paused");
    sessionStorage.setItem("tg-tour-running", "1");
    sidebarBeforeTour.current = collapsed;
    await startProductTour({
      ...tourShellCallbacks(),
      startAt,
    });
  };

  useEffect(() => {
    if (!needsTour) return;

    // Route change remounted AppShell but driver.js tour is still alive
    if (isProductTourActive()) {
      tourStarted.current = true;
      setTourRunning(true);
      setTourPaused(false);
      bindProductTourCallbacks(tourShellCallbacks());
      return;
    }

    if (tourStarted.current || tourRunning) return;

    const resumeFlag = sessionStorage.getItem("tg-tour-resume") === "1";
    const runningFlag = sessionStorage.getItem("tg-tour-running") === "1";
    const pausedFlag =
      tourPaused || sessionStorage.getItem("tg-tour-paused") === "1";

    // Mid-tour navigation: shell remounted, driver may have been lost — resume step
    if (runningFlag || resumeFlag) {
      sessionStorage.removeItem("tg-tour-resume");
      const fresh = sessionStorage.getItem("tg-tour-fresh") === "1";
      if (fresh) sessionStorage.removeItem("tg-tour-fresh");
      void launchTour(fresh ? { fresh: true } : { startAt: getSavedTourStep() });
      return;
    }

    if (pausedFlag) {
      if (!tourPaused) setTourPaused(true);
      return;
    }

    void launchTour({ fresh: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsTour, pathname, tourPaused, tourRunning]);

  // Do NOT destroy the tour on AppShell unmount — each page mounts its own shell.
  // Pause/finish/skip handle teardown explicitly via product-tour module state.

  if (!authReady) {
    // Global WorkspaceBootOverlay covers this; avoid a second mid-page spinner.
    return <div className="min-h-screen bg-background" aria-hidden />;
  }

  const crumbTrail =
    breadcrumbs && breadcrumbs.length > 0
      ? breadcrumbs
      : title
        ? [{ label: title }]
        : [];

  const navList = (opts: {
    collapsed?: boolean;
    onNavigate?: () => void;
    /** Larger touch targets for the mobile drawer */
    comfortable?: boolean;
  }) => {
    const groups = (["main", "insights", "admin"] as const)
      .map((group) => ({
        group,
        items: visibleNav.filter((item) => item.group === group),
      }))
      .filter((g) => g.items.length > 0);

    const renderItem = (item: (typeof visibleNav)[number]) => {
      const href = workspaceSlug ? navHref(workspaceSlug, item.key) : "#";
      const active = item.exact
        ? pathname === href || pathname === `${href}/`
        : pathname === href || pathname.startsWith(href + "/");
      const Icon = item.icon;
      return (
        <li key={item.key}>
          <Link
            to={href}
            onClick={opts.onNavigate}
            data-tour={item.tour}
            title={opts.collapsed ? item.label : undefined}
            className={cn(
              "tg-focus-ring group relative flex items-center font-medium transition-colors",
              opts.comfortable
                ? "min-h-12 gap-3 rounded-xl px-3.5 py-3 text-base"
                : cn(
                    "gap-3 rounded-lg px-2.5 py-2 text-[13px] leading-none",
                    opts.collapsed && "justify-center px-0",
                  ),
              active
                ? "bg-primary/12 text-primary shadow-[inset_0_0_0_1px] shadow-primary/15"
                : "text-sidebar-foreground/75 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground",
            )}
          >
            {active && !opts.collapsed && (
              <span
                className={cn(
                  "absolute left-0 top-1/2 -translate-y-1/2 rounded-r-full bg-primary",
                  opts.comfortable ? "h-6 w-1" : "h-5 w-1",
                )}
              />
            )}
            <span
              className={cn(
                "grid shrink-0 place-items-center rounded-md transition-colors",
                opts.comfortable ? "h-9 w-9" : "h-7 w-7",
                active
                  ? "bg-primary/15 text-primary"
                  : "bg-transparent text-sidebar-foreground/55 group-hover:text-sidebar-foreground/80",
              )}
            >
              <Icon
                className={cn(opts.comfortable ? "h-5 w-5" : "h-4 w-4")}
                strokeWidth={active ? 2.25 : 2}
              />
            </span>
            {!opts.collapsed && <span className="min-w-0 flex-1 truncate tracking-tight">{item.label}</span>}
            {!opts.collapsed && item.key === "notifications" && unread > 0 && (
              <span
                className={cn(
                  "ml-auto rounded-full bg-destructive font-semibold text-white tabular-nums",
                  opts.comfortable
                    ? "min-w-6 px-2 py-0.5 text-xs"
                    : "min-w-5 px-1.5 py-0.5 text-[10px]",
                )}
              >
                {unread}
              </span>
            )}
            {opts.collapsed && item.key === "notifications" && unread > 0 && (
              <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-destructive" />
            )}
          </Link>
        </li>
      );
    };

    return (
      <div className={cn("flex flex-col", opts.comfortable ? "gap-5" : "gap-4")}>
        {groups.map(({ group, items }) => (
          <div key={group} className="flex flex-col gap-1">
            {!opts.collapsed && (
              <div
                className={cn(
                  "px-2.5 font-semibold uppercase tracking-[0.12em] text-muted-foreground/80",
                  opts.comfortable ? "mb-1 text-[11px]" : "mb-0.5 text-[10px]",
                )}
              >
                {NAV_GROUP_LABEL[group]}
              </div>
            )}
            {opts.collapsed && group !== "main" && (
              <div className="mx-auto my-1 h-px w-6 bg-sidebar-border" aria-hidden />
            )}
            <ul className={cn("flex flex-col", opts.comfortable ? "gap-1.5" : "gap-1")}>
              {items.map(renderItem)}
            </ul>
          </div>
        ))}
      </div>
    );
  };

  const sidebarFooter = (opts: { collapsed?: boolean; comfortable?: boolean }) => (
    <div
      className={cn(
        "space-y-2 border-t border-sidebar-border",
        opts.comfortable ? "p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]" : "p-2",
      )}
    >
      {!opts.collapsed && (
        <div
          className={cn(
            "rounded-lg border border-sidebar-border bg-surface-2/40",
            opts.comfortable ? "p-3.5" : "p-3",
          )}
        >
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            ISO 9001 / 17025
          </div>
          <p
            className={cn(
              "mt-1 leading-snug text-muted-foreground",
              opts.comfortable ? "text-xs" : "text-[11px]",
            )}
          >
            Audit readiness is currently {readiness}%.
          </p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${readiness}%` }}
            />
          </div>
          <div className="mt-1 text-right text-[11px] font-semibold text-primary">{readiness}%</div>
        </div>
      )}

      <button
        type="button"
        onClick={toggle}
        aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        className={cn(
          "tg-focus-ring flex w-full items-center gap-2 text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
          opts.comfortable
            ? "min-h-12 rounded-xl px-3.5 py-3 text-base"
            : "rounded-md px-2 py-1.5 text-sm",
          opts.collapsed && "justify-center",
        )}
      >
        {theme === "dark" ? (
          <Sun className={opts.comfortable ? "h-5 w-5" : "h-4 w-4"} />
        ) : (
          <Moon className={opts.comfortable ? "h-5 w-5" : "h-4 w-4"} />
        )}
        {!opts.collapsed && <span>{theme === "dark" ? "Light Mode" : "Dark Mode"}</span>}
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Account menu"
            data-tour="account-menu"
            className={cn(
              "tg-focus-ring flex w-full items-center gap-2 text-left hover:bg-sidebar-accent/60",
              opts.comfortable ? "min-h-14 rounded-xl p-2.5" : "rounded-md p-1.5",
            )}
          >
            <div
              className={cn(
                "grid shrink-0 place-items-center rounded-full bg-primary/20 font-semibold text-primary",
                opts.comfortable ? "h-11 w-11 text-sm" : "h-8 w-8 text-xs",
              )}
            >
              {initials}
            </div>
            {!opts.collapsed && (
              <div className="min-w-0 flex-1">
                <div
                  className={cn(
                    "truncate font-medium text-sidebar-foreground",
                    opts.comfortable ? "text-base" : "text-sm",
                  )}
                >
                  {displayName}
                </div>
                <div
                  className={cn(
                    "truncate text-muted-foreground",
                    opts.comfortable ? "text-xs" : "text-[11px]",
                  )}
                >
                  {displayRole}
                </div>
              </div>
            )}
            {!opts.collapsed && (
              <LogOut
                className={cn(
                  "shrink-0 text-muted-foreground",
                  opts.comfortable ? "h-4 w-4" : "h-3.5 w-3.5",
                )}
              />
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="top" className="w-56">
          <DropdownMenuLabel>{displayName}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link
              to={workspaceSlug ? workspacePath(workspaceSlug, "profile") : "/auth/login"}
            >
              <UserIcon className="mr-2 h-4 w-4" /> Profile
            </Link>
          </DropdownMenuItem>
          {isAdmin && (
            <DropdownMenuItem asChild>
              <Link
                to={workspaceSlug ? workspacePath(workspaceSlug, "settings") : "/auth/login"}
              >
                <Settings className="mr-2 h-4 w-4" /> Settings
              </Link>
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => {
              void logout().finally(() => {
                clearToken();
                window.location.href = "/auth/login";
              });
            }}
          >
            <LogOut className="mr-2 h-4 w-4" /> Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

    </div>
  );

  return (
    <div className="flex min-h-screen w-full bg-background text-foreground">
      <aside
        data-tour="nav-sidebar"
        className={cn(
          "sticky top-0 z-30 hidden h-screen shrink-0 flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-200 md:flex",
          collapsed ? "w-[72px] cursor-pointer" : "w-[252px]",
        )}
        title={collapsed ? "Click empty space to expand sidebar" : undefined}
        onClick={(e) => {
          if (!collapsed) return;
          const el = e.target as HTMLElement | null;
          // Keep icon actions working; only empty chrome expands the rail
          if (el?.closest("a, button, [role='menuitem'], input, select, textarea")) return;
          setCollapsed(false);
        }}
      >
        <div
          className={cn(
            "flex h-14 items-center gap-2.5 border-b border-sidebar-border",
            collapsed ? "justify-center px-2" : "px-3.5",
          )}
        >
          <Link
            to={workspaceSlug ? workspacePath(workspaceSlug) : "/auth/login"}
            aria-label="Go to dashboard"
            className="tg-focus-ring grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground shadow-sm"
          >
            <Gauge className="h-4 w-4" strokeWidth={2.25} />
          </Link>
          {!collapsed && (
            <Link
              to={workspaceSlug ? workspacePath(workspaceSlug) : "/auth/login"}
              aria-label={`Workspace ${orgName} — Dashboard`}
              className="tg-focus-ring group min-w-0 flex-1 rounded-lg px-1.5 py-1 text-left transition-colors hover:bg-sidebar-accent/50"
            >
              <div className="min-w-0">
                <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  TheTruegage
                </div>
                <div className="truncate text-sm font-semibold tracking-tight text-sidebar-foreground">
                  {orgName}
                </div>
              </div>
            </Link>
          )}
          {!collapsed && (
            <button
              type="button"
              onClick={() => setCollapsed(true)}
              aria-label="Collapse sidebar"
              title="Collapse sidebar"
              className="tg-focus-ring grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent/70 hover:text-sidebar-foreground"
            >
              <PanelLeftClose className="h-4 w-4" />
            </button>
          )}
        </div>

        <nav
          className={cn(
            "tg-scrollbar flex-1 overflow-y-auto py-4",
            collapsed ? "px-2" : "px-2.5",
          )}
          aria-label="Main"
        >
          {navList({ collapsed })}
        </nav>

        <div className={cn("space-y-2 border-t border-sidebar-border", collapsed ? "p-2" : "p-2.5")}>
          {!collapsed && (
            <div className="rounded-xl border border-sidebar-border/80 bg-linear-to-br from-primary/10 to-transparent p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  Audit readiness
                </div>
                <div className="text-xs font-semibold tabular-nums text-primary">{readiness}%</div>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted/80">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${readiness}%` }}
                />
              </div>
              <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
                ISO 9001 / 17025 · live compliance
              </p>
            </div>
          )}

          <button
            type="button"
            onClick={toggle}
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            className={cn(
              "tg-focus-ring flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] text-sidebar-foreground/75 transition-colors hover:bg-sidebar-accent/70 hover:text-sidebar-foreground",
              collapsed && "justify-center px-0",
            )}
          >
            {theme === "dark" ? <Sun className="h-4 w-4 shrink-0" /> : <Moon className="h-4 w-4 shrink-0" />}
            {!collapsed && <span>{theme === "dark" ? "Light mode" : "Dark mode"}</span>}
          </button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Account menu"
                data-tour="account-menu"
                className={cn(
                  "tg-focus-ring flex w-full items-center gap-2.5 rounded-lg border border-transparent p-1.5 text-left transition-colors hover:border-sidebar-border hover:bg-sidebar-accent/50",
                  collapsed && "justify-center",
                )}
              >
                <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/15 text-xs font-semibold text-primary ring-1 ring-primary/20">
                  {initials}
                </div>
                {!collapsed && (
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium tracking-tight text-sidebar-foreground">
                      {displayName}
                    </div>
                    <div className="truncate text-[11px] text-muted-foreground">{displayRole}</div>
                  </div>
                )}
                {!collapsed && <LogOut className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="top" className="w-56">
              <DropdownMenuLabel>{displayName}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link
                  to={workspaceSlug ? workspacePath(workspaceSlug, "profile") : "/auth/login"}
                >
                  <UserIcon className="mr-2 h-4 w-4" /> Profile
                </Link>
              </DropdownMenuItem>
              {isAdmin && (
                <DropdownMenuItem asChild>
                  <Link
                    to={workspaceSlug ? workspacePath(workspaceSlug, "settings") : "/auth/login"}
                  >
                    <Settings className="mr-2 h-4 w-4" /> Settings
                  </Link>
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => {
                  void logout().finally(() => {
                    clearToken();
                    window.location.href = "/auth/login";
                  });
                }}
              >
                <LogOut className="mr-2 h-4 w-4" /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {collapsed && (
            <button
              type="button"
              onClick={() => setCollapsed(false)}
              aria-label="Expand sidebar"
              aria-expanded={false}
              title="Expand sidebar"
              className="tg-focus-ring group mx-auto grid h-8 w-8 place-items-center rounded-md text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent/70 hover:text-sidebar-foreground"
            >
              <PanelLeftOpen className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </button>
          )}
        </div>
      </aside>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent
          side="left"
          className="flex w-[min(100vw-1.25rem,22rem)] max-w-none flex-col gap-0 bg-sidebar p-0 text-sidebar-foreground sm:max-w-none"
        >
          <SheetHeader className="space-y-0 border-b border-sidebar-border px-4 py-4 pr-12 text-left">
            <SheetTitle className="flex items-center gap-3 text-sidebar-foreground">
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm">
                <Gauge className="h-5 w-5" strokeWidth={2.25} />
              </span>
              <span className="min-w-0">
                <span className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Workspace
                </span>
                <span className="block truncate text-lg font-semibold leading-tight">{orgName}</span>
              </span>
            </SheetTitle>
          </SheetHeader>
          <nav
            className="tg-scrollbar flex-1 overflow-y-auto px-3 py-4"
            aria-label="Mobile"
          >
            {navList({
              onNavigate: () => setMobileOpen(false),
              comfortable: true,
            })}
          </nav>
          <div className="mt-auto shrink-0">
            {sidebarFooter({ collapsed: false, comfortable: true })}
          </div>
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex min-h-16 items-center gap-2 border-b border-border bg-background/90 px-3 pt-[env(safe-area-inset-top)] backdrop-blur-md md:h-14 md:min-h-14 md:gap-3 md:px-6 md:pt-0">
          <button
            type="button"
            className={cn(
              "tg-focus-ring inline-flex h-11 w-11 items-center justify-center rounded-lg border border-primary/40 bg-primary/10 text-primary shadow-xs",
              "hover:bg-primary/15 hover:border-primary/60 active:bg-primary/20 md:hidden",
            )}
            aria-label="Open navigation menu"
            onClick={() => setMobileOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </button>

          {/* Mobile page context */}
          <div className="min-w-0 flex-1 md:hidden">
            <p className="truncate text-sm font-semibold leading-tight text-foreground">
              {crumbTrail[crumbTrail.length - 1]?.label || orgName || "TheTruegage"}
            </p>
            <p className="truncate text-[11px] text-muted-foreground">
              {orgName && crumbTrail.length > 0 ? orgName : "TheTruegage"}
            </p>
          </div>

          <nav className="hidden min-w-0 items-center gap-1.5 text-xs text-muted-foreground md:flex">
            <Link
              to={workspaceSlug ? workspacePath(workspaceSlug) : "/auth/login"}
              className="tg-focus-ring rounded-sm font-medium text-foreground hover:text-primary"
            >
              TheTruegage
            </Link>
            {crumbTrail.map((b, i) => (
              <span key={`${b.label}-${i}`} className="flex items-center gap-1.5">
                <span className="text-border-strong">›</span>
                {b.to ? (
                  <Link to={b.to} className="tg-focus-ring rounded-sm hover:text-foreground">
                    {b.label}
                  </Link>
                ) : (
                  <span className="text-foreground">{b.label}</span>
                )}
              </span>
            ))}
          </nav>

          <div className="flex shrink-0 items-center justify-end gap-1.5 md:min-w-0 md:flex-1 md:justify-center">
            <GlobalSearch
              workspaceSlug={workspaceSlug}
              storageEnabled={Boolean(me?.storage_enabled)}
              role={me?.role}
            />
          </div>

          {workspaceSlug && !pathname.includes("/scan") ? (
            <Link
              to="/workspace/$slug/scan"
              params={{ slug: workspaceSlug }}
              className={cn(
                "tg-focus-ring hidden shrink-0 items-center justify-center gap-1.5 rounded-md border border-border bg-card",
                "px-3 text-xs font-medium text-foreground shadow-xs",
                "hover:border-primary/40 hover:bg-primary/5 hover:text-primary",
                "sm:inline-flex sm:h-8",
              )}
              aria-label="Scan equipment"
              data-tour="nav-scan"
            >
              <ScanLine className="h-3.5 w-3.5 shrink-0" />
              <span>Scan</span>
            </Link>
          ) : null}

          <Link
            to={workspaceSlug ? workspacePath(workspaceSlug, "notifications") : "/auth/login"}
            className={cn(iconBtn, "relative")}
            aria-label="Notifications"
          >
            <Bell className="h-5 w-5 md:h-4 md:w-4" />
            {unread > 0 && (
              <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-destructive ring-2 ring-background md:right-1 md:top-1 md:h-1.5 md:w-1.5" />
            )}
          </Link>
        </header>

        {needsTour && !tourRunning && tourPaused ? (
          <div className="border-b border-[color:var(--color-primary)]/30 bg-[color:var(--color-primary)]/10 px-4 py-3 md:px-8">
            <div className="mx-auto flex max-w-xl flex-col items-center gap-2 text-center sm:flex-row sm:justify-center sm:gap-4 sm:text-left">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">Product tour paused</p>
                <p className="text-xs text-muted-foreground">
                  Pick up where you left off — takes about a minute.
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                className="tg-tour-resume-btn shrink-0 shadow-md"
                onClick={() => void launchTour({ startAt: getSavedTourStep() })}
              >
                Continue product tour
              </Button>
            </div>
          </div>
        ) : null}

        {!hidePageHeader && title && (
          <div className="border-b border-border bg-surface/40 px-4 py-4 md:px-8 md:py-5">
            <h1 className="font-display text-xl font-semibold tracking-tight text-foreground md:text-2xl">
              {title}
            </h1>
          </div>
        )}

        <main className="tg-page-enter flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>

        {/* Hide FAB on scan + equipment detail (detail has its own shop-floor action bar) */}
        {workspaceSlug &&
        !pathname.includes("/scan") &&
        !/\/equipment\/[^/]+$/.test(pathname) ? (
          <Link
            to="/workspace/$slug/scan"
            params={{ slug: workspaceSlug }}
            className="fixed bottom-[max(1.25rem,env(safe-area-inset-bottom))] right-4 z-40 grid h-14 w-14 place-items-center rounded-full bg-primary text-primary-foreground shadow-lg ring-4 ring-background transition hover:bg-primary/90 md:hidden"
            aria-label="Scan equipment"
            data-tour="nav-scan-fab"
          >
            <ScanLine className="h-6 w-6" />
          </Link>
        ) : null}
      </div>

      {me && needsProfileSetup ? (
        <OnboardingProfileDialog
          open
          user={me}
          onCompleted={(updated) => {
            queryClient.setQueryData(["me"], updated);
            window.dispatchEvent(new CustomEvent("tg-user-profile-updated"));
            tourStarted.current = false;
          }}
        />
      ) : null}
    </div>
  );
}
