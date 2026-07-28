import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { getToken } from "@/lib/auth";
import { getMe } from "@/lib/api";

export const Route = createFileRoute("/workspace/$slug")({
  pendingComponent: WorkspacePending,
  beforeLoad: async ({ params, context }) => {
    if (!getToken()) {
      throw redirect({ to: "/auth/login" });
    }
    let me;
    try {
      me = await context.queryClient.ensureQueryData({
        queryKey: ["me"],
        queryFn: getMe,
        staleTime: 5 * 60_000,
      });
    } catch {
      throw redirect({ to: "/auth/login" });
    }
    const expected = (me.tenant_slug || "").trim();
    if (!expected) {
      throw redirect({ to: "/auth/login" });
    }
    if (params.slug !== expected) {
      throw redirect({
        to: "/workspace/$slug",
        params: { slug: expected },
      });
    }
    return { me, workspaceSlug: expected };
  },
  component: WorkspaceLayout,
});

function WorkspacePending() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
      <p className="mt-3 text-sm text-muted-foreground">Loading workspace…</p>
    </div>
  );
}

function WorkspaceLayout() {
  return <Outlet />;
}
