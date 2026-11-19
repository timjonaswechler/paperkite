import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_chat/")({
  beforeLoad: () => {
    throw redirect({ to: "/bewerbungen", replace: true });
  },
});
