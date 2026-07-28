import { getToken } from "@/lib/auth";
import { getMe } from "@/lib/api";

/** Build a workspace-scoped path, e.g. `/workspace/acme/equipment`. */
export function workspacePath(slug: string, path = ""): string {
  const clean = path.replace(/^\//, "");
  return clean ? `/workspace/${slug}/${clean}` : `/workspace/${slug}`;
}

export async function resolveTenantSlug(): Promise<string | null> {
  if (!getToken()) return null;
  try {
    const me = await getMe();
    return me.tenant_slug || null;
  } catch {
    return null;
  }
}
