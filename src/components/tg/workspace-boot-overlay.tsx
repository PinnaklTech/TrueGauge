import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Gauge, Loader2 } from "lucide-react";
import {
  getWorkspaceBootState,
  subscribeWorkspaceBoot,
} from "@/lib/workspace-boot";

/** Full-viewport boot screen — stays mounted at document root across login → app navigation. */
export function WorkspaceBootOverlay() {
  const boot = useSyncExternalStore(subscribeWorkspaceBoot, getWorkspaceBootState, () => ({
    active: false,
    message: "",
  }));

  if (!boot.active || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-white"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="mb-6 grid h-11 w-11 place-items-center rounded-lg bg-primary text-primary-foreground">
        <Gauge className="h-5 w-5" strokeWidth={2.25} />
      </div>
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
      <p className="mt-4 font-display text-base font-semibold tracking-tight text-teal-900">
        {boot.message || "Loading your workspace…"}
      </p>
      <p className="mt-1 text-sm text-slate-500">Preparing your dashboard</p>
    </div>,
    document.body,
  );
}
