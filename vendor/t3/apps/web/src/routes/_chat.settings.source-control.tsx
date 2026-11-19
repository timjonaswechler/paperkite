import { createFileRoute, notFound } from "@tanstack/react-router";
export const Route = createFileRoute("/_chat/settings/source-control")({
  beforeLoad: () => {
    throw notFound();
  },
});
