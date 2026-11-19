import { createFileRoute } from "@tanstack/react-router";
import { ApplicationsPage } from "../bewerbung/ApplicationsPage";

export const Route = createFileRoute("/_chat/bewerbungen/$applicationId")({
  validateSearch: (raw: Record<string, unknown>): { panel?: "documents" | "source" } =>
    raw.panel === "documents" || raw.panel === "source" ? { panel: raw.panel } : {},
  component: ApplicationRoute,
});

function ApplicationRoute() {
  const { applicationId } = Route.useParams();
  const { panel } = Route.useSearch();
  return (
    <ApplicationsPage
      key={`${applicationId}:${panel ?? ""}`}
      applicationId={applicationId}
      initialPanel={panel ?? null}
    />
  );
}
