import { createFileRoute, notFound } from "@tanstack/react-router";
import type { PullRequestsSearch } from "../components/pullRequest/usePullRequestListView";
export const Route = createFileRoute("/_chat/pull-requests")({
  validateSearch: (_search: Record<string, unknown>): PullRequestsSearch => {
    throw notFound();
  },
});
