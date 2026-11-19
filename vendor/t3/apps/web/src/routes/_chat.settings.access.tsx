import { createFileRoute, notFound } from "@tanstack/react-router";
export const Route = createFileRoute("/_chat/settings/access")({
  beforeLoad: () => {
    throw notFound();
  },
});
