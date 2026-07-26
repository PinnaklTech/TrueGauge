import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { exchangeHandoffCode } from "@/lib/api";
import { setSessionTokens } from "@/lib/auth";

export const Route = createFileRoute("/auth/handoff")({
  head: () => ({ meta: [{ title: "Opening workspace · TrueGage" }] }),
  component: HandoffPage,
});

function HandoffPage() {
  const navigate = useNavigate();
  const [error, setError] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    // Legacy hash token support (clear immediately; prefer codes)
    const hash = window.location.hash.startsWith("#")
      ? window.location.hash.slice(1)
      : window.location.hash;
    const hashParams = new URLSearchParams(hash);
    const legacyToken = hashParams.get("token");

    window.history.replaceState(null, "", "/auth/handoff");

    if (code) {
      void exchangeHandoffCode(code)
        .then((session) => {
          setSessionTokens(session.access_token, session.refresh_token);
          void navigate({ to: "/" });
        })
        .catch((err) => {
          setError(err instanceof Error ? err.message : "Handoff failed");
        });
      return;
    }

    if (legacyToken) {
      setError("This open-company link is outdated. Open the company again from Master Admin.");
      return;
    }

    setError("Missing handoff code. Open the company again from Master Admin.");
  }, [navigate]);

  return (
    <div className="w-full text-center">
      <h2 className="font-display text-xl font-semibold tracking-tight text-white">
        {error ? "Handoff failed" : "Opening workspace…"}
      </h2>
      <p className="mt-2 text-sm text-white/55">
        {error || "Signing you into the selected company."}
      </p>
    </div>
  );
}
