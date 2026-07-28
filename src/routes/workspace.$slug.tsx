import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";
import { getToken } from "@/lib/auth";
import { getMe } from "@/lib/api";

export const Route = createFileRoute("/workspace/$slug")({
  // Boot overlay (root portal) covers pending — avoid a second mid-page spinner.
  pendingComponent: () => null,
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

function WorkspaceLayout() {
  return <Outlet />;
}
