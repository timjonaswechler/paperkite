import { createFileRoute, notFound } from "@tanstack/react-router";
export const Route = createFileRoute("/_chat/settings/labs")({
  beforeLoad: () => {
    throw notFound();
  },
});
