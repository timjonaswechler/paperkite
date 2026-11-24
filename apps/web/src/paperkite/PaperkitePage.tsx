import { Link } from "@tanstack/react-router";

import { Button } from "~/components/ui/button";
import { SidebarInset } from "~/components/ui/sidebar";
import { WorkspacePageHeader } from "~/components/WorkspacePageHeader";

export function PaperkitePage() {
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden">
      <WorkspacePageHeader>
        {/* oxlint-disable-next-line t3code/no-untranslated-copy -- Paperkite is a product name. */}
        <h1 className="text-sm font-medium">Paperkite</h1>
      </WorkspacePageHeader>
      <main className="flex flex-1 items-center justify-center p-6">
        <Button variant="outline" render={<Link to="/" />}>
          T3 Code
        </Button>
      </main>
    </SidebarInset>
  );
}
