import { useEffect, useEffectEvent, useState } from "react";
import type { Application, ApplicationDetail, ChatEvent, Settings } from "./shared/api";
import { api, base, errorMessage } from "./api";
import { loadHistory } from "./history";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import { ErrorNotice } from "./components/Controls";
import { DocumentsPanel } from "./components/DocumentsPanel";
import { SourceDialog } from "./components/SourceDialog";
import { NativeChatButton } from "./NativeChatButton";

export function Workspace({
  id,
  applications,
  settings,
  refreshKey,
  panel,
  onPanel,
  onEdit,
  onSidebar,
  onListChanged,
}: {
  id: string;
  applications: Application[];
  settings: Pick<Settings, "autoBuild">;
  refreshKey: number;
  panel: "documents" | "source" | null;
  onPanel: (panel: "documents" | "source" | null) => void;
  onEdit: () => void;
  onSidebar: () => void;
  onListChanged: () => void;
}) {
  const [app, setApp] = useState<ApplicationDetail | null>(null);
  const [error, setError] = useState("");
  async function refresh() {
    setApp(await api<ApplicationDetail>(`/applications/${id}`));
  }
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reads the business API when the selected application or its revision changes
  useEffect(() => {
    void refreshKey;
    const controller = new AbortController();
    void api<ApplicationDetail>(`/applications/${id}`, "GET", undefined, controller.signal)
      .then(setApp)
      .catch((e) => {
        if (!controller.signal.aborted) setError(errorMessage(e));
      });
    return () => controller.abort();
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- explicit reload tokens invalidate the external API snapshot
  }, [id, refreshKey]);
  const refreshBusiness = useEffectEvent(() => {
    void refresh()
      .then(onListChanged)
      .catch((e) => setError(errorMessage(e)));
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to business build completion and refreshes metadata after reconnect
  useEffect(() => {
    const stream = new EventSource(`${base}/applications/${id}/stream`);
    stream.onmessage = (message) => {
      try {
        const event: { type: string } = JSON.parse(message.data);
        if (event.type === "build" || event.type === "connected") refreshBusiness();
      } catch (e) {
        setError(errorMessage(e));
      }
    };
    return () => stream.close();
  }, [id]);
  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      <header className="flex flex-wrap items-center gap-2 border-b p-4">
        <div className="md:hidden">
          <Button variant="ghost" onClick={onSidebar}>
            Bewerbungen
          </Button>
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-medium">{app?.company ?? "Bewerbung laden…"}</h1>
          <p className="text-sm text-muted-foreground">{app?.role}</p>
        </div>
        {app && <Badge variant="outline">{app.status}</Badge>}
      </header>
      <div className="space-y-5 p-5">
        <ErrorNotice error={error} onClose={() => setError("")} />
        {app && (
          <>
            <div className="flex flex-wrap gap-2">
              <NativeChatButton applicationId={id} />
              <Button variant="outline" onClick={onEdit}>
                Details bearbeiten
              </Button>
              <Button variant="outline" onClick={() => onPanel("documents")}>
                Unterlagen / PDF
              </Button>
              <Button variant="outline" onClick={() => onPanel("source")}>
                Lebenslauf / Quellen bearbeiten
              </Button>
              <Button
                variant="ghost"
                onClick={() => void refresh().catch((e) => setError(errorMessage(e)))}
              >
                Aktualisieren
              </Button>
            </div>
            {app.posting && (
              <section>
                <h2 className="font-medium">Ausschreibung</h2>
                <p className="whitespace-pre-wrap text-sm">{app.posting}</p>
              </section>
            )}
            {app.notes && (
              <section>
                <h2 className="font-medium">Notizen</h2>
                <p className="whitespace-pre-wrap text-sm">{app.notes}</p>
              </section>
            )}
            <LegacyHistory id={id} />
            <DocumentsPanel
              app={app}
              open={panel === "documents"}
              onClose={() => onPanel(null)}
              onRefresh={refresh}
              onEdit={onEdit}
            />
            {panel === "source" && (
              <SourceDialog
                app={app}
                applications={applications}
                autoBuild={settings.autoBuild}
                onClose={() => onPanel(null)}
                onRefresh={refresh}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function LegacyHistory({ id }: { id: string }) {
  const [events, setEvents] = useState<ChatEvent[] | null>(null);
  const [oldDraft, setOldDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function load() {
    setBusy(true);
    setError("");
    try {
      const [history, draft] = await Promise.all([
        loadHistory<ChatEvent>((after) => api(`/applications/${id}/events?after=${after}`)),
        api<{ text: string }>(`/applications/${id}/draft`),
      ]);
      setEvents(history);
      setOldDraft(draft.text);
    } catch (e) {
      setError(errorMessage(e));
    }
    setBusy(false);
  }
  return (
    <section className="space-y-3 border-t pt-4">
      <h2 className="font-medium">Alter Chatverlauf · nur lesbar</h2>
      <p className="text-sm text-muted-foreground">
        Archiv aus der bisherigen Bewerbungs-App. Neue Gespräche über „Chat öffnen“ führen.
      </p>
      <Button variant="outline" disabled={busy} onClick={() => void load()}>
        {busy ? "Laden…" : "Archiv laden / aktualisieren"}
      </Button>
      <ErrorNotice error={error} />
      {oldDraft && (
        <div className="space-y-2 rounded border p-3">
          <h3 className="text-sm font-medium">Alter ungesendeter Entwurf · zum Kopieren</h3>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words font-sans text-sm">
            {oldDraft}
          </pre>
        </div>
      )}
      {events?.length === 0 && <p className="text-sm">Kein alter Verlauf vorhanden.</p>}
      {events?.map((event) => (
        <details
          key={event.id}
          className="rounded border p-3"
          open={event.type === "user" || event.type === "assistant"}
        >
          <summary className="text-xs text-muted-foreground">
            {event.type} · {event.id}
          </summary>
          <pre className="mt-2 whitespace-pre-wrap break-words font-sans text-sm">
            {event.payload.text ?? JSON.stringify(event.payload, null, 2)}
          </pre>
        </details>
      ))}
    </section>
  );
}
