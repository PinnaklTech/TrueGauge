import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { login } from "@/lib/api";
import { setToken } from "@/lib/auth";
import { useState } from "react";
import { toast } from "sonner";
import { Lock, ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/auth/login")({
  head: () => ({ meta: [{ title: "Sign in · True Gauge" }] }),
  component: LoginPage,
});

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
    <div className="w-full">
      <div className="mb-6 flex items-start gap-3">
        <div className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/15 text-primary">
          <Lock className="h-4 w-4" strokeWidth={2.25} />
        </div>
        <div>
          <h2 className="font-display text-xl font-semibold tracking-tight text-white">
            Sign in
          </h2>
          <p className="mt-1 text-sm text-white/55">
            Use the work email and password provided by your admin.
          </p>
        </div>
      </div>

      <form className="space-y-4" onSubmit={(e) => void onSubmit(e)}>
        <div>
          <Label htmlFor="email" className="mb-1.5 block text-xs font-medium text-white/70">
            Work email
          </Label>
          <Input
            id="email"
            type="email"
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            className="border-white/10 bg-white/5 text-white placeholder:text-white/30"
          />
        </div>
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <Label htmlFor="pw" className="text-xs font-medium text-white/70">
              Password
            </Label>
            <Link to="/auth/forgot" className="text-xs text-primary hover:underline">
              Forgot password?
            </Link>
          </div>
          <Input
            id="pw"
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            className="border-white/10 bg-white/5 text-white placeholder:text-white/30"
          />
        </div>
        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? "Signing in…" : "Sign in to workspace"}
        </Button>
      </form>

      <div className="mt-6 flex gap-2.5 rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-3">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div className="text-xs leading-relaxed text-white/55">
          <span className="font-semibold text-white/80">True Gauge is invite only.</span>{" "}
          Access is granted by your organization — not open for public signup.
        </div>
      </div>
    </div>
  );
}
