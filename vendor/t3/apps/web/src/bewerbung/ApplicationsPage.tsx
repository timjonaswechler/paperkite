import { useState } from "react";
import { FileText, SquarePen } from "lucide-react";
import { SidebarInset, useSidebar } from "~/components/ui/sidebar";
import { Button } from "~/components/ui/button";
import { Workspace } from "./Workspace";
import { useApplications } from "./ApplicationsProvider";

export function ApplicationsPage(props: {
  applicationId?: string;
  initialPanel?: "documents" | "source" | null;
}) {
  return (
    <ApplicationsPageView
      key={`${props.applicationId ?? ""}:${props.initialPanel ?? ""}`}
      {...props}
    />
  );
}

function ApplicationsPageView({
  applicationId = "",
  initialPanel = null,
}: {
  applicationId?: string;
  initialPanel?: "documents" | "source" | null;
}) {
  const app = useApplications();
  const { toggleSidebar } = useSidebar();
  const [panel, setPanel] = useState<"documents" | "source" | null>(initialPanel);
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden">
      <main className="flex min-h-0 min-w-0 flex-1 flex-col pt-12">
        {applicationId ? (
          <Workspace
            key={applicationId}
            id={applicationId}
            applications={app.applications}
            settings={app.settings ?? { autoBuild: false }}
            refreshKey={app.refreshKey}
            panel={panel}
            onPanel={setPanel}
            onEdit={() => void app.applicationAction("edit", applicationId)}
            onSidebar={toggleSidebar}
            onListChanged={app.refreshList}
          />
        ) : (
          <>
            <header className="flex h-13 shrink-0 items-center gap-3 px-3">
              <span className="text-sm font-medium">Bewerbungen</span>
            </header>
            <section className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-6 pb-16 text-center">
              <FileText className="size-8 text-muted-foreground/60" />
              <h1 className="text-xl font-medium">Deine Bewerbungen vorbereiten</h1>
              <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
                {app.loading
                  ? "Arbeitsbereich wird geladen…"
                  : "Stellen-Link erfassen, Lebenslauf und Anschreiben vorbereiten, Unterlagen als Versandpaket herunterladen. Öffne eine Bewerbung oder lege eine neue an."}
              </p>
              <Button disabled={app.loading} onClick={() => app.setForm({ mode: "new" })}>
                <SquarePen />
                Neue Bewerbung
              </Button>
              {app.applications.length > 0 && <div className="grid w-full max-w-4xl gap-3 text-left sm:grid-cols-2 lg:grid-cols-3">{app.applications.map(application => <section key={application.id} className="min-w-0 space-y-3 rounded-xl border p-4"><h2 className="break-words font-medium">{application.company}</h2><p className="break-words text-sm text-muted-foreground">{application.role}</p><p className="text-xs text-muted-foreground">{application.status}</p><Button variant="outline" onClick={() => app.open(application.id)}>Bewerbung öffnen</Button></section>)}</div>}
            </section>
          </>
        )}
      </main>
    </SidebarInset>
  );
}
