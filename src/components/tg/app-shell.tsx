import { Link, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard,
  Wrench,
  CalendarClock,
  FileCheck2,
  BarChart3,
  Bell,
  Settings,
  Search,
  Sun,
  Moon,
  LogOut,
  Gauge,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  User as UserIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  getMe,
  getOrgProfile,
  listEquipment,
  listNotifications,
  type AuthUser,
} from "@/lib/api";
import { clearToken, isAuthenticated } from "@/lib/auth";
import {
  complianceScore,
  roleDisplayLabel,
  userInitials,
  type UserProfile,
} from "@/lib/compliance";

const nav = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { to: "/equipment", label: "Equipment", icon: Wrench },
  { to: "/calibrations", label: "Calibrations", icon: CalendarClock },
  { to: "/certificates", label: "Certificates", icon: FileCheck2 },
  { to: "/reports", label: "Reports & Compliance", icon: BarChart3 },
  { to: "/notifications", label: "Notifications", icon: Bell },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

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

export function AppShell({
  children,
  title,
  breadcrumbs,
  hidePageHeader,
}: {
  children: ReactNode;
  title?: string;
  breadcrumbs?: { label: string; to?: string }[];
  hidePageHeader?: boolean;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { theme, toggle } = useTheme();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    if (!isAuthenticated()) {
      window.location.href = "/auth/login";
      return;
    }
    setAuthReady(true);
  }, []);

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
    const onProfile = () => void refetchMe();
    const onOrg = () => void refetchOrg();
    window.addEventListener("tg-user-profile-updated", onProfile);
    window.addEventListener("tg-org-profile-updated", onOrg);
    return () => {
      window.removeEventListener("tg-user-profile-updated", onProfile);
      window.removeEventListener("tg-org-profile-updated", onOrg);
    };
  }, [refetchMe, refetchOrg]);

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
  const visibleNav = nav.filter((item) => item.to !== "/settings" || isAdmin);

  if (!authReady) {
    return (
      <div className="grid min-h-screen place-items-center bg-background text-sm text-muted-foreground">
        Checking session…
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
        const active =
          "exact" in item && item.exact
            ? pathname === item.to
            : pathname === item.to || pathname.startsWith(item.to + "/");
        const Icon = item.icon;
        return (
          <li key={item.to}>
            <Link
              to={item.to}
              onClick={opts.onNavigate}
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
              {!opts.collapsed && item.to === "/notifications" && unread > 0 && (
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
            <Link to="/profile">
              <UserIcon className="mr-2 h-4 w-4" /> Profile
            </Link>
          </DropdownMenuItem>
          {isAdmin && (
            <DropdownMenuItem asChild>
              <Link to="/settings">
                <Settings className="mr-2 h-4 w-4" /> Settings
              </Link>
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => {
              clearToken();
              window.location.href = "/auth/login";
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
        className={cn(
          "sticky top-0 z-30 hidden h-screen shrink-0 flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-200 md:flex",
          collapsed ? "w-[68px]" : "w-[240px]",
        )}
      >
        <div className="flex h-14 items-center gap-2 border-b border-sidebar-border px-3">
          <Link
            to="/"
            aria-label="Go to dashboard"
            className="tg-focus-ring grid h-8 w-8 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground shadow-sm"
          >
            <Gauge className="h-4 w-4" strokeWidth={2.25} />
          </Link>
          {!collapsed && (
            <Link
              to="/"
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
                <Link to="/profile">
                  <UserIcon className="mr-2 h-4 w-4" /> Profile
                </Link>
              </DropdownMenuItem>
              {isAdmin && (
                <DropdownMenuItem asChild>
                  <Link to="/settings">
                    <Settings className="mr-2 h-4 w-4" /> Settings
                  </Link>
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => {
                  clearToken();
                  window.location.href = "/auth/login";
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
            <Link to="/" className="tg-focus-ring rounded-sm font-medium text-foreground hover:text-primary">
              True Gauge
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

          <div className="flex min-w-0 flex-1 items-center justify-center">
            <div
              className="hidden w-full max-w-md items-center gap-2 rounded-md border border-dashed border-border bg-surface/60 px-2.5 py-1.5 text-sm text-muted-foreground md:flex"
              title="Global search coming soon"
            >
              <Search className="h-3.5 w-3.5" />
              <span className="flex-1 text-left">Search coming soon</span>
            </div>
          </div>

          <Link to="/notifications" className={cn(iconBtn, "relative")} aria-label="Notifications">
            <Bell className="h-4 w-4" />
            {unread > 0 && (
              <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-destructive ring-2 ring-background" />
            )}
          </Link>
        </header>

        {!hidePageHeader && title && (
          <div className="border-b border-border bg-surface/40 px-4 py-4 md:px-8 md:py-5">
            <h1 className="font-display text-xl font-semibold tracking-tight text-foreground md:text-2xl">
              {title}
            </h1>
          </div>
        )}

        <main className="tg-page-enter flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>
      </div>
    </div>
  );
}
