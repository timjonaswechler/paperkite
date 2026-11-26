import { createFileRoute, redirect } from "@tanstack/react-router";

// Keep old bookmarks and native route types without loading account settings.
export const Route = createFileRoute("/_chat/settings/source-control")({
  beforeLoad: () => {
    throw redirect({ to: "/settings", replace: true });
  },
});
