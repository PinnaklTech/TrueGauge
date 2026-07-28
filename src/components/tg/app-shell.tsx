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
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { workspacePath } from "@/lib/workspace";
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
}[] = [
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard, exact: true, tour: "nav-dashboard" },
  { key: "equipment", label: "Equipment", icon: Wrench, tour: "nav-equipment" },
  { key: "calibrations", label: "Calibrations", icon: CalendarClock, tour: "nav-calibrations" },
  { key: "certificates", label: "Certificates", icon: FileCheck2, tour: "nav-certificates" },
  { key: "reports", label: "Reports & Compliance", icon: BarChart3, tour: "nav-reports" },
  { key: "notifications", label: "Notifications", icon: Bell, tour: "nav-notifications" },
  { key: "settings", label: "Settings", icon: Settings, tour: "nav-settings" },
];

const iconBtn =
  "tg-focus-ring inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted";

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

  useEffect(() => {
    if (!isAuthenticated()) {
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

  const { data } = useQuery({
    queryKey: ["equipment"],
    queryFn: () => listEquipment(),
    enabled: authReady,
  });
  const { data: notifData } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => listNotifications(),
    enabled: authReady,
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
    if (to === "calibrations") {
      await navigate({ to: "/workspace/$slug/calibrations", params: { slug: workspaceSlug }, search: {} });
      return;
    }
    if (to === "dashboard") {
      await navigate({ to: "/workspace/$slug", params: { slug: workspaceSlug } });
      return;
    }
    if (to === "equipment") {
      await navigate({ to: "/workspace/$slug/equipment", params: { slug: workspaceSlug } });
      return;
    }
    await navigate({ to: "/workspace/$slug/certificates", params: { slug: workspaceSlug } });
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
      (target === "certificates" && pathname.includes("/certificates"));

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
    return (
      <div className="grid min-h-screen place-items-center bg-background" role="status" aria-live="polite">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary/25 border-t-primary" />
          <p className="text-sm text-muted-foreground">Loading…</p>
        </div>
      </div>
    );
  }

  const crumbTrail =
    breadcrumbs && breadcrumbs.length > 0
      ? breadcrumbs
      : title
        ? [{ label: title }]
        : [];

  const navList = (opts: { collapsed?: boolean; onNavigate?: () => void }) => (
    <ul className="flex flex-col gap-0.5">
      {visibleNav.map((item) => {
        const href = workspaceSlug ? navHref(workspaceSlug, item.key) : "#";
        const active =
          item.exact
            ? pathname === href || pathname === `${href}/`
            : pathname === href || pathname.startsWith(href + "/");
        const Icon = item.icon;
        return (
          <li key={item.key}>
            <Link
              to={href}
              onClick={opts.onNavigate}
              data-tour={item.tour}
              className={cn(
                "tg-focus-ring group relative flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm font-medium transition-colors",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/80 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
              )}
            >
              {active && (
                <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-r-full bg-primary" />
              )}
              <Icon className="h-4 w-4 shrink-0" strokeWidth={2} />
              {!opts.collapsed && <span className="truncate">{item.label}</span>}
              {!opts.collapsed && item.key === "notifications" && unread > 0 && (
                <span className="ml-auto rounded-full bg-destructive px-1.5 py-0.5 text-[10px] font-semibold text-white">
                  {unread}
                </span>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );

  const sidebarFooter = (opts: { collapsed?: boolean }) => (
    <div className="space-y-2 border-t border-sidebar-border p-2">
      {!opts.collapsed && (
        <div className="rounded-lg border border-sidebar-border bg-surface-2/40 p-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            ISO 9001 / 17025
          </div>
          <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
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
          "tg-focus-ring flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
          opts.collapsed && "justify-center",
        )}
      >
        {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        {!opts.collapsed && <span>{theme === "dark" ? "Light Mode" : "Dark Mode"}</span>}
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Account menu"
            data-tour="account-menu"
            className="tg-focus-ring flex w-full items-center gap-2 rounded-md p-1.5 text-left hover:bg-sidebar-accent/60"
          >
            <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/20 text-xs font-semibold text-primary">
              {initials}
            </div>
            {!opts.collapsed && (
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-sidebar-foreground">{displayName}</div>
                <div className="truncate text-[11px] text-muted-foreground">{displayRole}</div>
              </div>
            )}
            {!opts.collapsed && <LogOut className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
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
          collapsed ? "w-[68px] cursor-pointer" : "w-[240px]",
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
        <div className="flex h-14 items-center gap-2 border-b border-sidebar-border px-3">
          <Link
            to={workspaceSlug ? workspacePath(workspaceSlug) : "/auth/login"}
            aria-label="Go to dashboard"
            className="tg-focus-ring grid h-8 w-8 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground shadow-sm"
          >
            <Gauge className="h-4 w-4" strokeWidth={2.25} />
          </Link>
          {!collapsed && (
            <Link
              to={workspaceSlug ? workspacePath(workspaceSlug) : "/auth/login"}
              aria-label={`Workspace ${orgName} — Dashboard`}
              className="tg-focus-ring group flex min-w-0 flex-1 items-center rounded-md px-1.5 py-1 text-left hover:bg-sidebar-accent/60"
            >
              <div className="min-w-0">
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Workspace
                </div>
                <div className="truncate text-sm font-semibold text-sidebar-foreground">{orgName}</div>
              </div>
            </Link>
          )}
        </div>

        <nav className="tg-scrollbar flex-1 overflow-y-auto px-2 py-3" aria-label="Main">
          {navList({ collapsed })}
        </nav>

        <div className="space-y-2 border-t border-sidebar-border p-2">
          {!collapsed && (
            <div className="rounded-lg border border-sidebar-border bg-surface-2/40 p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                ISO 9001 / 17025
              </div>
              <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
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
              "tg-focus-ring flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
              collapsed && "justify-center",
            )}
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            {!collapsed && <span>{theme === "dark" ? "Light Mode" : "Dark Mode"}</span>}
          </button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Account menu"
                data-tour="account-menu"
                className="tg-focus-ring flex w-full items-center gap-2 rounded-md p-1.5 text-left hover:bg-sidebar-accent/60"
              >
                <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/20 text-xs font-semibold text-primary">
                  {initials}
                </div>
                {!collapsed && (
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-sidebar-foreground">{displayName}</div>
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

          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={cn(
              "tg-focus-ring group hidden w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-foreground md:flex",
              collapsed ? "justify-center" : "justify-start",
            )}
          >
            {collapsed ? (
              <PanelLeftOpen className="h-4 w-4 shrink-0 transition-transform group-hover:translate-x-0.5" />
            ) : (
              <>
                <PanelLeftClose className="h-4 w-4 shrink-0 transition-transform group-hover:-translate-x-0.5" />
                <span>Collapse</span>
              </>
            )}
          </button>
        </div>
      </aside>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-[280px] bg-sidebar p-0 text-sidebar-foreground">
          <SheetHeader className="border-b border-sidebar-border px-4 py-3 text-left">
            <SheetTitle className="flex items-center gap-2 text-sidebar-foreground">
              <span className="grid h-8 w-8 place-items-center rounded-md bg-primary text-primary-foreground">
                <Gauge className="h-4 w-4" />
              </span>
              <span>
                <span className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Workspace
                </span>
                {orgName}
              </span>
            </SheetTitle>
          </SheetHeader>
          <nav className="tg-scrollbar flex-1 overflow-y-auto px-2 py-3" aria-label="Mobile">
            {navList({ onNavigate: () => setMobileOpen(false) })}
          </nav>
          <div className="mt-auto">{sidebarFooter({ collapsed: false })}</div>
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-border bg-background/80 px-3 backdrop-blur-md md:gap-3 md:px-6">
          <button
            type="button"
            className={cn(iconBtn, "md:hidden")}
            aria-label="Open navigation menu"
            onClick={() => setMobileOpen(true)}
          >
            <Menu className="h-4 w-4" />
          </button>

          <nav className="hidden min-w-0 items-center gap-1.5 text-xs text-muted-foreground md:flex">
            <Link
              to={workspaceSlug ? workspacePath(workspaceSlug) : "/auth/login"}
              className="tg-focus-ring rounded-sm font-medium text-foreground hover:text-primary"
            >
              TrueGage
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

          <div className="flex min-w-0 flex-1 items-center justify-end gap-1 md:justify-center">
            <GlobalSearch
              workspaceSlug={workspaceSlug}
              storageEnabled={Boolean(me?.storage_enabled)}
              role={me?.role}
            />
          </div>

          <Link
            to={workspaceSlug ? workspacePath(workspaceSlug, "notifications") : "/auth/login"}
            className={cn(iconBtn, "relative")}
            aria-label="Notifications"
          >
            <Bell className="h-4 w-4" />
            {unread > 0 && (
              <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-destructive ring-2 ring-background" />
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
