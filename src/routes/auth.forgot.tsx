import { createFileRoute, Link } from "@tanstack/react-router";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { KeyRound } from "lucide-react";

export const Route = createFileRoute("/auth/forgot")({
  head: () => ({ meta: [{ title: "Reset password · TrueGage" }] }),
  component: ForgotPage,
});

function ForgotPage() {
  return (
    <div className="w-full">
      <div className="mb-6 flex items-start gap-3">
        <div className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/15 text-primary">
          <KeyRound className="h-4 w-4" strokeWidth={2.25} />
        </div>
        <div>
          <h2 className="font-display text-xl font-semibold tracking-tight text-white">
            Reset password
          </h2>
          <p className="mt-1 text-sm text-white/55">
            Password reset email is not connected yet. Contact your workspace admin to set a new
            password under Settings → Login accounts.
          </p>
        </div>
      </div>

      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          toast.message("Ask your admin to reset your password in Login accounts.");
        }}
      >
        <div>
          <Label htmlFor="forgot-email" className="mb-1.5 block text-xs font-medium text-white/70">
            Work email
          </Label>
          <Input
            id="forgot-email"
            type="email"
            placeholder="you@company.com"
            className="border-white/10 bg-white/5 text-white placeholder:text-white/30"
            required
          />
        </div>
        <Button type="submit" className="w-full" variant="secondary">
          Contact admin for reset
        </Button>
      </form>

      <p className="mt-6 text-center text-xs text-white/45">
        <Link to="/auth/login" className="font-medium text-primary hover:underline">
          ← Back to sign in
        </Link>
      </p>
    </div>
  );
}
