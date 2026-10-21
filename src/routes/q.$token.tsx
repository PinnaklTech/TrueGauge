import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ApiError, getMe, resolveScanCode } from "@/lib/api";
import { getToken } from "@/lib/auth";
import { Loader2, QrCode, ScanLine, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/q/$token")({
  head: () => ({ meta: [{ title: "Opening equipment · TrueGage" }] }),
  component: QrDeepLinkPage,
});

type Phase = "loading" | "not_found" | "error";

function QrDeepLinkPage() {
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>("loading");
  const [message, setMessage] = useState("");
  const [workspaceSlug, setWorkspaceSlug] = useState<string | null>(null);

  useEffect(() => {
    const returnTo = `/q/${encodeURIComponent(token)}`;
    const access = getToken();
    if (!access) {
      void navigate({
        to: "/auth/login",
        search: { returnTo },
        replace: true,
      });
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const me = await getMe();
        if (cancelled) return;
        if (me.tenant_slug) setWorkspaceSlug(me.tenant_slug);

        const result = await resolveScanCode(token);
        if (cancelled) return;

        if (result.equipment) {
          const slug = me.tenant_slug;
          if (!slug) {
            setPhase("error");
            setMessage("No workspace is associated with your account.");
            return;
          }
          await navigate({
            to: "/workspace/$slug/equipment/$id",
            params: { slug, id: result.equipment.id },
            search: { from: "scan" },
            replace: true,
          });
          return;
        }

        if (result.matches && result.matches.length === 1) {
          const slug = me.tenant_slug;
          if (slug) {
            await navigate({
              to: "/workspace/$slug/equipment/$id",
              params: { slug, id: result.matches[0].id },
              search: { from: "scan" },
              replace: true,
            });
            return;
          }
        }

        setPhase("not_found");
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) {
          setPhase("not_found");
          return;
        }
        if (err instanceof ApiError && err.status === 401) {
          void navigate({
            to: "/auth/login",
            search: { returnTo },
            replace: true,
          });
          return;
        }
        setPhase("error");
        setMessage(err instanceof Error ? err.message : "Something went wrong");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token, navigate]);

  if (phase === "loading") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 text-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="mt-4 text-sm text-muted-foreground">Opening equipment from label…</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 text-center">
      <div className="grid h-14 w-14 place-items-center rounded-2xl bg-muted text-muted-foreground">
        <QrCode className="h-7 w-7" />
      </div>
      <h1 className="mt-5 font-display text-xl font-semibold tracking-tight text-foreground">
        {phase === "not_found"
          ? "This label isn't linked to equipment in your workspace."
          : "Couldn't open this label"}
      </h1>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">
        {phase === "not_found"
          ? "It may belong to another company, or the token was regenerated."
          : message || "Please try again or search for the equipment manually."}
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        {workspaceSlug ? (
          <>
            <Button asChild>
              <Link to="/workspace/$slug/equipment" params={{ slug: workspaceSlug }}>
                <Wrench className="mr-2 h-4 w-4" />
                Go to Equipment
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/workspace/$slug/scan" params={{ slug: workspaceSlug }}>
                <ScanLine className="mr-2 h-4 w-4" />
                Scan another
              </Link>
            </Button>
          </>
        ) : (
          <Button asChild>
            <Link to="/auth/login">Sign in</Link>
          </Button>
        )}
      </div>
    </div>
  );
}
