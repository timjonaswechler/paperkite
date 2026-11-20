import { createFileRoute, notFound } from "@tanstack/react-router";

export const Route = createFileRoute("/_chat/settings/browser")({
  beforeLoad: () => {
    throw notFound();
  },
});
