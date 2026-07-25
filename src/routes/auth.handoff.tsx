import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { setToken } from "@/lib/auth";

export const Route = createFileRoute("/auth/handoff")({
  head: () => ({ meta: [{ title: "Opening workspace · TrueGage" }] }),
  component: HandoffPage,
});

function HandoffPage() {
  const navigate = useNavigate();
  const [error, setError] = useState("");

  useEffect(() => {
    const hash = window.location.hash.startsWith("#")
      ? window.location.hash.slice(1)
      : window.location.hash;
    const params = new URLSearchParams(hash);
    const token = params.get("token");
    if (!token) {
      setError("Missing handoff token. Open the company again from Master Admin.");
      return;
    }
    setToken(token);
    // Clear token from URL so it is not left in history
    window.history.replaceState(null, "", "/auth/handoff");
    void navigate({ to: "/" });
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
