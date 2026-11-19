import { createFileRoute, notFound } from "@tanstack/react-router";
export const Route = createFileRoute("/_chat/settings/diffs")({
  beforeLoad: () => {
    throw notFound();
  },
});
