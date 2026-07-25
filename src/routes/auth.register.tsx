import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/auth/register")({
  head: () => ({ meta: [{ title: "Invite only · True Gauge" }] }),
  component: () => <Navigate to="/auth/login" replace />,
});
