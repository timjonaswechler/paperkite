import { createFileRoute, notFound } from "@tanstack/react-router";
export const Route = createFileRoute("/_chat/settings/worktrees")({
  beforeLoad: () => {
    throw notFound();
  },
});
