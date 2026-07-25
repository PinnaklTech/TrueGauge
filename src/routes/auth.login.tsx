import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { login } from "@/lib/api";
import { setToken } from "@/lib/auth";
import { useState } from "react";
import { toast } from "sonner";
import { Check, Gauge, LogIn } from "lucide-react";
import { LoginAtmosphere } from "@/components/tg/login-enter-transition";

export const Route = createFileRoute("/auth/login")({
  head: () => ({ meta: [{ title: "Sign in · TrueGage" }] }),
  component: LoginPage,
});

const features = ["Equipment registry", "Due-date alerts", "Compliance reports"] as const;

function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const session = await login(email.trim(), password);
      setToken(session.access_token);
      toast.success(`Welcome back${session.user.full_name ? `, ${session.user.full_name}` : ""}`);
      void navigate({ to: "/" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sign in failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="relative flex min-h-screen w-full overflow-hidden bg-white text-foreground">
      <aside className="relative hidden w-[52%] shrink-0 flex-col justify-between overflow-hidden lg:flex">
        <LoginAtmosphere />

        <div className="relative z-10 flex items-center gap-2.5 px-10 pt-10">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-white/15 text-white ring-1 ring-white/25 backdrop-blur-sm">
            <Gauge className="h-5 w-5" strokeWidth={2.25} />
          </div>
          <span className="font-display text-lg font-semibold tracking-tight text-white">TrueGage</span>
        </div>

        <div className="relative z-10 max-w-lg px-10 pb-16">
          <h1 className="font-display text-4xl font-semibold leading-[1.1] tracking-tight text-white xl:text-5xl">
            Calibration made visible.
          </h1>
          <p className="mt-4 max-w-md text-base leading-relaxed text-white/75">
            Keep every gauge audit-ready — due dates, certificates, and compliance in one workspace.
          </p>
          <ul className="mt-8 flex flex-wrap gap-x-5 gap-y-3">
            {features.map((label) => (
              <li key={label} className="flex items-center gap-2 text-sm font-medium text-white/90">
                <span className="grid h-5 w-5 place-items-center rounded-full bg-white/15 ring-1 ring-white/20">
                  <Check className="h-3 w-3 text-white" strokeWidth={2.5} />
                </span>
                {label}
              </li>
            ))}
          </ul>
        </div>

        <svg
          aria-hidden
          className="pointer-events-none absolute inset-y-0 -right-px z-20 h-full w-24 text-white"
          viewBox="0 0 96 900"
          preserveAspectRatio="none"
        >
          <path
            fill="currentColor"
            d="M96 0 C64 80 12 150 20 270 C28 390 88 455 68 555 C48 655 0 735 24 820 C40 875 72 892 96 900 L96 0 Z"
          />
        </svg>
      </aside>

      <main className="tg-login-form relative flex min-h-screen flex-1 flex-col bg-white text-slate-800">
        <div className="flex items-center gap-2 border-b border-teal-900/10 px-6 py-4 lg:hidden">
          <div className="grid h-8 w-8 place-items-center rounded-md bg-primary text-primary-foreground">
            <Gauge className="h-4 w-4" strokeWidth={2.25} />
          </div>
          <span className="font-display text-base font-semibold tracking-tight text-teal-900">TrueGage</span>
        </div>

        <div className="flex flex-1 flex-col justify-center px-6 py-10 sm:px-10 lg:px-14 xl:px-20">
          <div className="mx-auto w-full max-w-100">
            <h2 className="font-display text-3xl font-semibold tracking-tight text-primary">
              Sign in to your workspace
            </h2>
            <p className="mt-2 text-sm text-slate-500">Use the work email your admin provided.</p>

            <form className="mt-8 space-y-5" onSubmit={(e) => void onSubmit(e)}>
              <div>
                <Label htmlFor="email" className="mb-1.5 block text-sm font-medium text-slate-700">
                  Email address
                </Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  disabled={submitting}
                  className="h-11 rounded-lg border-slate-200 bg-white text-slate-900 shadow-none placeholder:text-slate-400"
                />
              </div>
              <div>
                <Label htmlFor="pw" className="mb-1.5 block text-sm font-medium text-slate-700">
                  Password
                </Label>
                <Input
                  id="pw"
                  type="password"
                  placeholder="At least 8 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  disabled={submitting}
                  className="h-11 rounded-lg border-slate-200 bg-white text-slate-900 shadow-none placeholder:text-slate-400"
                />
              </div>
              <Button
                type="submit"
                className="h-11 w-full gap-2 rounded-lg text-sm font-semibold"
                disabled={submitting}
              >
                <LogIn className="h-4 w-4" />
                {submitting ? "Signing in…" : "Sign in"}
              </Button>
            </form>

            <p className="mt-8 text-sm text-slate-500">
              TrueGage is invite only.{" "}
              <span className="font-medium text-primary">Ask your organization admin</span> for
              access.
            </p>
          </div>
        </div>

        <footer className="px-6 pb-6 text-center text-[11px] text-slate-400 sm:text-left lg:px-14 xl:px-20">
          © {new Date().getFullYear()} TrueGage. A product by{" "}
          <a
            href="https://pinnakltech.com"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-primary underline-offset-2 hover:underline"
          >
            Pinnakl Tech
          </a>
        </footer>
      </main>
    </div>
  );
}
