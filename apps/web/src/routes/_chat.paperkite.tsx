import { createFileRoute } from "@tanstack/react-router";

import { PaperkitePage } from "../paperkite/PaperkitePage";

export const Route = createFileRoute("/_chat/paperkite")({
  component: PaperkitePage,
});
