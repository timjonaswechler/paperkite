import { createFileRoute, redirect } from "@tanstack/react-router";
import { issuesSearchFromUrl } from "../components/issue/issuesSearch.logic";

// Retain the query type for upstream consumers; the former page never loads.
export const Route = createFileRoute("/_chat/issues")({
  validateSearch: issuesSearchFromUrl,
  beforeLoad: () => {
    throw redirect({ to: "/", replace: true });
  },
});
