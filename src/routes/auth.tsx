import { createFileRoute, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { Gauge } from "lucide-react";
import { useEffect } from "react";
import { isAuthenticated } from "@/lib/auth";
import { getMe } from "@/lib/api";

export const Route = createFileRoute("/auth")({
  component: AuthLayout,
});

function AuthLayout() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isLogin = pathname === "/auth/login";
  const isHandoff = pathname === "/auth/handoff";

  useEffect(() => {
    if (isHandoff) return;
    if (isAuthenticated()) {
      void getMe()
        .then((session) => {
          if (session.tenant_slug) {
            return navigate({ to: "/workspace/$slug", params: { slug: session.tenant_slug } });
          }
          return navigate({ to: "/" });
        })
        .catch(() => navigate({ to: "/" }));
    }
  }, [navigate, isHandoff]);

  // Login owns the full viewport; handoff is minimal
  if (isLogin || isHandoff) {
    return <Outlet />;
  }

  return (
    <div className="relative flex min-h-screen flex-col bg-[#07131a] text-foreground">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: `
            radial-gradient(ellipse 80% 60% at 15% 10%, color-mix(in oklab, var(--color-primary) 28%, transparent), transparent 55%),
            radial-gradient(ellipse 70% 50% at 90% 85%, color-mix(in oklab, var(--color-primary) 12%, transparent), transparent 50%),
            linear-gradient(165deg, #07131a 0%, #0b1c24 45%, #0a1620 100%)
          `,
        }}
      />
      <header className="relative z-10 flex items-center justify-between px-6 py-5 md:px-10">
        <div className="flex items-center gap-2.5">
          <div className="grid h-9 w-9 place-items-center rounded-md bg-primary text-primary-foreground">
            <Gauge className="h-5 w-5" strokeWidth={2.25} />
          </div>
          <div className="font-display text-lg font-semibold tracking-tight text-white">TrueGage</div>
        </div>
      </header>
      <main className="relative z-10 flex flex-1 flex-col items-center justify-center px-6 pb-16 pt-4">
        <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0d1a22]/90 p-6 shadow-[0_24px_60px_-28px_rgba(0,0,0,0.75)] backdrop-blur-md md:p-8">
          <Outlet />
        </div>
      </main>
      <footer className="relative z-10 px-6 pb-6 text-center text-[11px] text-white/35">
        A product by{" "}
        <a
          href="https://pinnakltech.com"
          target="_blank"
          rel="noopener noreferrer"
          className="text-white/55 underline-offset-2 transition-colors hover:text-primary hover:underline"
        >
          Pinnakl Tech
        </a>
      </footer>
    </div>
  );
}
