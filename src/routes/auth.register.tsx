import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/auth/register")({
  head: () => ({ meta: [{ title: "Invite only · TheTruegage" }] }),
  component: () => <Navigate to="/auth/login" replace />,
});
