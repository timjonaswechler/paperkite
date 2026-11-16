import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, PanelLeft, Pencil } from "lucide-react";
import type {
  Application,
  ApplicationDetail,
  ChatEvent,
  Settings,
} from "../shared/api";
import { api, base, errorMessage } from "./api";
import { loadHistory, mergeEvents } from "./history";
import { Button } from "./components/ui/button";
import { Badge } from "./components/ui/badge";
import { ErrorNotice, IconButton } from "./components/Controls";
import { MessagesTimeline } from "./components/chat/MessagesTimeline";
import { ChatComposer } from "./components/chat/ChatComposer";
import { DocumentsPanel } from "./components/DocumentsPanel";
import { SourceDialog } from "./components/SourceDialog";

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
  settings: Pick<Settings, "sendOnEnter" | "autoBuild">;
  refreshKey: number;
  panel: "documents" | "source" | null;
  onPanel: (panel: "documents" | "source" | null) => void;
  onEdit: () => void;
  onSidebar: () => void;
  onListChanged: () => void;
}) {
  const [app, setApp] = useState<ApplicationDetail | null>(null);
  const [events, setEvents] = useState<ChatEvent[]>([]);
  const [streaming, setStreaming] = useState("");
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [error, setError] = useState("");
  const [connection, setConnection] = useState("");
  const alive = useRef(true);
  const readSequence = useRef(0);
  const listChanged = useRef(onListChanged);
  listChanged.current = onListChanged;
  const refresh = useCallback(async () => {
    const sequence = ++readSequence.current;
    const result = await api<ApplicationDetail>(`/applications/${id}`);
    if (alive.current && sequence === readSequence.current) setApp(result);
  }, [id]);
  useEffect(() => {
    alive.current = true;
    void refresh().catch((e) => {
      if (alive.current) setError(errorMessage(e));
    });
    return () => {
      alive.current = false;
    };
  }, [refresh, refreshKey]);
  useEffect(() => {
    let live = true;
    const loadEvents = () =>
      loadHistory<ChatEvent>(
        (after) => api(`/applications/${id}/events?after=${after}`),
        () => live,
      )
        .then((history) => {
          if (live) {
            setEvents((current) => mergeEvents(history, current));
            setLoadingHistory(false);
          }
        })
        .catch((e) => {
          if (live) {
            setError(errorMessage(e));
            setLoadingHistory(false);
          }
        });
    void loadEvents();
    const stream = new EventSource(`${base}/applications/${id}/stream`);
    stream.onmessage = (message) => {
      if (!live) return;
      try {
        const event = JSON.parse(message.data);
        if (event.type === "connected") {
          setConnection("");
          void loadEvents();
          setApp((current) =>
            current ? { ...current, harness: event.harness } : current,
          );
          return;
        }
        if (event.type === "delta") {
          setStreaming((text) => text + event.payload.text);
          return;
        }
        if (event.id) setEvents((current) => mergeEvents(current, [event]));
        if (
          event.type === "assistant" ||
          event.type === "settled" ||
          event.type === "error"
        )
          setStreaming("");
        if (
          [
            "user",
            "settled",
            "approval",
            "approval-resolved",
            "build",
            "error",
          ].includes(event.type)
        ) {
          void refresh().catch((e) => {
            if (live) setError(errorMessage(e));
          });
          if (["settled", "build"].includes(event.type)) listChanged.current();
        }
      } catch (e) {
        setError(`Ereignis konnte nicht gelesen werden: ${errorMessage(e)}`);
      }
    };
    stream.onerror = () => {
      if (live)
        setConnection(
          "Verbindung wird wiederhergestellt; der Verlauf bleibt gespeichert.",
        );
    };
    return () => {
      live = false;
      stream.close();
    };
  }, [id, refresh]);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-13 shrink-0 items-center gap-2 border-b border-border/50 px-3 sm:px-5">
        <IconButton
          label="Bewerbungen einblenden"
          className="md:hidden"
          onClick={onSidebar}
        >
          <PanelLeft />
        </IconButton>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-medium">
            {app?.company || "Bewerbung laden…"}
          </h1>
          <p className="truncate text-xs text-muted-foreground">{app?.role}</p>
        </div>
        {app && (
          <>
            <span className="hidden sm:inline">
              <Badge variant="outline" size="sm">
                {app.status}
              </Badge>
            </span>
            <IconButton label="Bewerbungsdetails bearbeiten" onClick={onEdit}>
              <Pencil />
            </IconButton>
            <IconButton
              label="Lebenslauf / Quellen bearbeiten"
              onClick={() => onPanel("source")}
            >
              <FileText />
            </IconButton>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onPanel("documents")}
            >
              <FileText />
              <span>Unterlagen</span>
            </Button>
          </>
        )}
      </header>
      {error && (
        <div className="px-4 pt-3">
          <ErrorNotice error={error} onClose={() => setError("")} />
          <Button
            variant="ghost"
            size="xs"
            onClick={() => {
              setError("");
              void refresh().catch((e) => setError(errorMessage(e)));
            }}
          >
            Erneut laden
          </Button>
        </div>
      )}
      {connection && (
        <p role="status" className="px-5 pt-2 text-xs text-muted-foreground">
          {connection}
        </p>
      )}
      <MessagesTimeline
        events={events}
        streaming={streaming}
        loading={loadingHistory}
      />
      {app && (
        <>
          <ChatComposer
            app={app}
            sendOnEnter={settings.sendOnEnter}
            onRefresh={refresh}
          />
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
  );
}
