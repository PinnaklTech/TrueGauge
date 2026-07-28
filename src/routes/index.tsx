import { createFileRoute, redirect } from "@tanstack/react-router";
import { getToken } from "@/lib/auth";
import { resolveTenantSlug } from "@/lib/workspace";

export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    if (!getToken()) {
      throw redirect({ to: "/auth/login" });
    }
    const slug = await resolveTenantSlug();
    if (!slug) {
      throw redirect({ to: "/auth/login" });
    }
    throw redirect({
      to: "/workspace/$slug",
      params: { slug },
    });
  },
});
