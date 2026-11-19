import { useEffect, useEffectEvent, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ArrowRight, FolderDown, LayoutDashboard, Mail, MessageSquare, UserRound } from "lucide-react";
import type { Application, ApplicationDetail, ChatEvent, Settings } from "./shared/api";
import { api, base, errorMessage } from "./api";
import { loadHistory } from "./history";
import { confirmNavigation } from "./navigation";
import { useApplications } from "./ApplicationsProvider";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import { ErrorNotice } from "./components/Controls";
import { SourceDialog } from "./components/SourceDialog";
import { CoverLetterEditor, CvEditor } from "./components/DocumentEditors";
import { DeliveryPanel } from "./components/DeliveryPanel";
import { NativeChatButton } from "./NativeChatButton";

const areas = [
  { id: "overview", label: "Übersicht", icon: LayoutDashboard },
  { id: "cv", label: "Lebenslauf", icon: UserRound },
  { id: "cover", label: "Anschreiben", icon: Mail },
  { id: "package", label: "Versandpaket", icon: FolderDown },
  { id: "chats", label: "Chats (optional)", icon: MessageSquare },
] as const;
type Area = typeof areas[number]["id"];
export function Workspace({ id, applications, settings, refreshKey, panel, onPanel, onEdit, onSidebar, onListChanged }: {
  id: string; applications: Application[]; settings: Pick<Settings, "autoBuild">; refreshKey: number; panel: "documents" | "source" | null; onPanel: (panel: "documents" | "source" | null) => void; onEdit: () => void; onSidebar: () => void; onListChanged: () => void | Promise<void>;
}) {
  const controller = useApplications();
  const navigate = useNavigate();
  const [app, setApp] = useState<ApplicationDetail | null>(null);
  const [error, setError] = useState("");
  const [area, setArea] = useState<Area>(panel === "documents" ? "package" : panel === "source" ? "cv" : "overview");
  const [updateToken, setUpdateToken] = useState(0);
  const [editorEpoch, setEditorEpoch] = useState(0);
  async function refresh() {
    setApp(await api<ApplicationDetail>(`/applications/${id}`));
    setUpdateToken(value => value + 1);
    await onListChanged();
  }
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reads the selected application's external document snapshot
  useEffect(() => {
    void refreshKey;
    const abort = new AbortController();
    void api<ApplicationDetail>(`/applications/${id}`, "GET", undefined, abort.signal).then(setApp).catch(error => { if (!abort.signal.aborted) setError(errorMessage(error)); });
    return () => abort.abort();
  }, [id, refreshKey]);
  const refreshBusiness = useEffectEvent(() => { void refresh().catch(error => setError(errorMessage(error))); });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- receives durable build, PDF and package completion plus reconnect notifications
  useEffect(() => {
    const stream = new EventSource(`${base}/applications/${id}/stream`);
    stream.onmessage = event => {
      try { const value: { type: string } = JSON.parse(event.data); if (["build", "pdf", "delivery", "connected"].includes(value.type)) refreshBusiness(); } catch (error) { setError(errorMessage(error)); }
    };
    return () => stream.close();
  }, [id]);
  function select(next: Area) { if (next !== area && confirmNavigation()) setArea(next); }
  function advanced() { if (confirmNavigation()) { setEditorEpoch(value => value + 1); onPanel("source"); } }
  const mapping = controller.navigation.applications.find(application => application.id === id);
  const sourceUrl = app?.posting.match(/^(?:Quelle:\s*)?(https?:\/\/\S+)/)?.[1];
  const state = (kind: "cv" | "cover") => app?.documentStatus?.[kind] ?? "missing";
  const status = (kind: "cv" | "cover") => state(kind) === "current" ? "PDF aktuell" : state(kind) === "outdated" ? "PDF neu bauen" : "Noch kein PDF";
  const nextStep: Area = state("cv") !== "current" ? "cv" : state("cover") !== "current" ? "cover" : "package";
  return <div className="flex h-full min-h-0 min-w-0 flex-col">
    <header className="flex shrink-0 flex-wrap items-center gap-3 border-b px-4 py-3">
      <div className="md:hidden"><Button variant="ghost" onClick={onSidebar}>Bewerbungen</Button></div>
      <div className="min-w-0 flex-1"><h1 className="break-words text-lg font-medium">{app?.company ?? "Bewerbung laden…"}</h1><p className="break-words text-sm text-muted-foreground">{app?.role}</p></div>
      {app && <><Badge variant="outline">{app.status}</Badge><Button size="sm" variant="outline" onClick={onEdit}>Details bearbeiten</Button></>}
    </header>
    <nav aria-label="Bereiche der Bewerbung" className="shrink-0 overflow-x-auto border-b p-3"><ToggleGroup value={[area]} onValueChange={values => { const next = areas.find(item => item.id === values[0]); if (next) select(next.id); }} aria-label="Bereiche der Bewerbung">{areas.map(item => <ToggleGroupItem key={item.id} value={item.id}><item.icon />{item.label}</ToggleGroupItem>)}</ToggleGroup></nav>
    <main className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4 sm:p-6">
      <ErrorNotice error={error} onClose={() => setError("")} />
      {app && area === "overview" && <div className="mx-auto max-w-6xl space-y-6">
        <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-card p-5"><div><h2 className="text-lg font-medium">Deine Bewerbung vorbereiten</h2><p className="text-sm text-muted-foreground">Lebenslauf anpassen, Anschreiben verfassen und die passenden Unterlagen als Versandpaket erstellen.</p></div><Button onClick={() => select(nextStep)}>{nextStep === "cv" ? "Lebenslauf vorbereiten" : nextStep === "cover" ? "Anschreiben vorbereiten" : "Versandpaket erstellen"}<ArrowRight /></Button></section>
        <div className="grid gap-4 lg:grid-cols-3">
          {[{ id: "cv" as const, title: "Lebenslauf", description: "Angaben für diese Stelle prüfen und bei Bedarf anpassen.", icon: UserRound }, { id: "cover" as const, title: "Anschreiben", description: "Dein individuelles Anschreiben verfassen und als PDF bauen.", icon: Mail }, { id: "package" as const, title: "Versandpaket", description: "Originale auswählen, Reihenfolge, Seiten und Kompression festlegen.", icon: FolderDown }].map(item => <section key={item.id} className="flex min-w-0 flex-col gap-4 rounded-xl border p-5"><item.icon className="size-5 text-muted-foreground" /><h2 className="font-medium">{item.title}</h2><p className="flex-1 text-sm text-muted-foreground">{item.description}</p><p className="text-xs text-muted-foreground">{item.id === "package" ? `${app.documents.length} Anlagen ausgewählt` : status(item.id)}</p><div><Button variant="outline" onClick={() => select(item.id)}>{item.title} öffnen</Button></div></section>)}
        </div>
        {sourceUrl && <p className="text-sm"><a href={sourceUrl} target="_blank" rel="noreferrer" className="break-all underline">Original-Stellenanzeige öffnen</a></p>}
        {app.posting && <details className="rounded-xl border p-4"><summary className="cursor-pointer font-medium">Gespeicherte Ausschreibung und Anforderungen</summary><p className="mt-4 whitespace-pre-wrap break-words text-sm text-muted-foreground">{app.posting}</p></details>}
        {app.notes && <section className="space-y-2 rounded-xl border p-4"><h2 className="font-medium">Notizen</h2><p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{app.notes}</p></section>}
        <p className="text-sm text-muted-foreground">Chats sind optional – etwa um eine Formulierung zu verbessern oder den Lebenslauf auf die Stelle abzustimmen. Die Dokumentenverwaltung funktioniert unabhängig davon.</p>
      </div>}
      {app && area === "cv" && <CvEditor key={`cv-${editorEpoch}`} app={app} autoBuild={settings.autoBuild} onRefresh={refresh} onAdvanced={advanced} />}
      {app && area === "cover" && <CoverLetterEditor key={`cover-${editorEpoch}`} app={app} autoBuild={settings.autoBuild} onRefresh={refresh} onAdvanced={advanced} />}
      {app && area === "package" && <DeliveryPanel app={app} settings={controller.settings} updateToken={updateToken} onRefresh={refresh} />}
      {app && area === "chats" && <section className="mx-auto max-w-4xl space-y-5"><div><h2 className="text-lg font-medium">Optionale KI-Unterstützung</h2><p className="text-sm text-muted-foreground">Mehrere unabhängige Chats können dieselben Bewerbungsquellen und ausgewählten Unterlagen verwenden. Ein Chat ist für die Erstellung oder den Download nicht erforderlich.</p></div><NativeChatButton applicationId={id} /><ul className="space-y-2">{mapping?.chats.map(chat => <li key={chat.id}><Button variant="ghost" onClick={() => { void navigate({ to: "/$environmentId/$threadId", params: { environmentId: controller.navigation.environmentId, threadId: chat.id } }); }}><MessageSquare />{chat.title || "Chat öffnen"}</Button></li>)}</ul><p className="text-xs text-muted-foreground">Ungesendete Chatentwürfe bleiben im aufklappbaren Bewerbungseintrag erhalten. Chatmodell und Berechtigungsmodus wählst du weiterhin direkt in T3.</p><LegacyHistory id={id} /></section>}
    </main>
    {app && panel === "source" && <SourceDialog app={app} applications={applications} autoBuild={settings.autoBuild} onClose={() => { setEditorEpoch(value => value + 1); onPanel(null); }} onRefresh={refresh} />}
  </div>;
}

function LegacyHistory({ id }: { id: string }) {
  const [events, setEvents] = useState<ChatEvent[] | null>(null);
  const [oldDraft, setOldDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function load() {
    setBusy(true); setError("");
    try {
      const [history, draft] = await Promise.all([loadHistory<ChatEvent>(after => api(`/applications/${id}/events?after=${after}`)), api<{ text: string }>(`/applications/${id}/draft`)]);
      setEvents(history); setOldDraft(draft.text);
    } catch (error) { setError(errorMessage(error)); }
    setBusy(false);
  }
  return <section className="space-y-3 border-t pt-4"><h2 className="font-medium">Alter Chatverlauf · nur lesbar</h2><p className="text-sm text-muted-foreground">Archiv aus der bisherigen Bewerbungs-App.</p><Button variant="outline" disabled={busy} onClick={() => void load()}>{busy ? "Laden…" : "Archiv laden / aktualisieren"}</Button><ErrorNotice error={error} />{oldDraft && <div className="space-y-2 rounded border p-3"><h3 className="text-sm font-medium">Alter ungesendeter Entwurf · zum Kopieren</h3><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words font-sans text-sm">{oldDraft}</pre></div>}{events?.length === 0 && <p className="text-sm">Kein alter Verlauf vorhanden.</p>}{events?.map(event => <details key={event.id} className="rounded border p-3" open={event.type === "user" || event.type === "assistant"}><summary className="text-xs text-muted-foreground">{event.type} · {event.id}</summary><pre className="mt-2 whitespace-pre-wrap break-words font-sans text-sm">{event.payload.text ?? JSON.stringify(event.payload, null, 2)}</pre></details>)}</section>;
}
