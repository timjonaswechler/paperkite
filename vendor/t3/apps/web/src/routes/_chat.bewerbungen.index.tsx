import { createFileRoute } from "@tanstack/react-router";
import { ApplicationsPage } from "../bewerbung/ApplicationsPage";

export const Route = createFileRoute("/_chat/bewerbungen/")({ component: ApplicationsPage });
