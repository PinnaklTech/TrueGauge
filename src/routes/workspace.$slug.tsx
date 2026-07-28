import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";
import { getToken } from "@/lib/auth";
import { getMe } from "@/lib/api";

export const Route = createFileRoute("/workspace/$slug")({
  beforeLoad: async ({ params }) => {
    if (!getToken()) {
      throw redirect({ to: "/auth/login" });
    }
    let me;
    try {
      me = await getMe();
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
