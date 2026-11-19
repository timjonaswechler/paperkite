import { createFileRoute } from "@tanstack/react-router";
import { ApplicationSettingsPage } from "~/bewerbung/ApplicationSettingsPage";
export const Route = createFileRoute("/_chat/settings/projects")({
  component: ApplicationSettingsPage,
});
