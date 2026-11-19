import { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { FileText, PanelLeft, SquarePen, X } from "lucide-react";
import {
  APPLICATION_STATUSES,
  type Application,
  type ApplicationDetail,
  type ApplicationStatus,
  type Settings,
  type TemplateSummary,
  type UiState,
} from "../shared/api";
import { api, ApiError, errorMessage } from "./api";
import { Workspace } from "./Workspace";
import { confirmNavigation } from "./navigation";
import { prepareDraftDeletion } from "./useDraft";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogPanel,
  DialogFooter,
} from "./components/ui/dialog";
import {
  ApplicationSidebar,
  type ApplicationAction,
} from "./components/sidebar/ApplicationSidebar";
import {
  ApplicationDialog,
  type ApplicationFormRequest,
} from "./components/ApplicationDialog";
import { SettingsDialog } from "./components/SettingsDialog";
import { LibraryDialog } from "./components/DocumentLibrary";
import { SearchDialog } from "./components/SearchDialog";
import { Button } from "./components/ui/button";
import { TooltipProvider } from "./components/ui/tooltip";
import {
  Sheet,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetPopup,
} from "./components/ui/sheet";
import { ErrorNotice, IconButton } from "./components/Controls";
import "@fontsource-variable/inter";
import "./style.css";

const pathId = () =>
  location.pathname.match(
    /^\/bewerbung\/applications\/([a-f0-9-]+)\/?$/,
  )?.[1] || "";
function App() {
  const [applications, setApplications] = useState<Application[]>([]);
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const settingsRef = useRef<Settings | null>(null);
  const settingsWrites = useRef(Promise.resolve());
  const [ui, setUi] = useState<UiState>({ openIds: [] });
  const [id, setId] = useState(pathId);
  const routeRef = useRef(id);
  routeRef.current = id;
  const [form, setForm] = useState<ApplicationFormRequest | null>(null);
  const [removing, setRemoving] = useState<ApplicationDetail | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [mobileSidebar, setMobileSidebar] = useState(false);
  const [panel, setPanel] = useState<"documents" | "source" | null>(null);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const fail = (e: unknown) => setError(errorMessage(e));
  const refreshList = useCallback(async () => {
    const [list, masters] = await Promise.all([
      api<Application[]>("/applications"),
      api<TemplateSummary[]>("/templates"),
    ]);
    setApplications(list);
    setTemplates(masters);
  }, []);
  async function refreshAll() {
    setError("");
    try {
      const [preferences, state] = await Promise.all([
        api<Settings>("/settings"),
        api<UiState>("/ui-state"),
        refreshList(),
      ]);
      settingsRef.current = preferences;
      setSettings(preferences);
      setUi(state);
      if (routeRef.current)
        setUi(
          await api<UiState>(
            `/applications/${routeRef.current}/open`,
            "POST",
            {},
          ),
        );
      setRefreshKey((n) => n + 1);
    } catch (e) {
      fail(e);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void refreshAll();
    const pop = () => {
      if (!confirmNavigation()) {
        history.pushState(
          {},
          "",
          routeRef.current
            ? `/bewerbung/applications/${routeRef.current}`
            : "/bewerbung/",
        );
        return;
      }
      const next = pathId();
      setId(next);
      setPanel(null);
      if (next)
        void api<UiState>(`/applications/${next}/open`, "POST", {})
          .then(setUi)
          .catch(fail);
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () =>
      document.documentElement.classList.toggle("dark", media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        !(event.metaKey || event.ctrlKey) ||
        event.altKey ||
        event.shiftKey
      )
        return;
      if (!["k", "n", ","].includes(event.key.toLowerCase())) return;
      if (document.querySelector('[role="dialog"], [role="alertdialog"]'))
        return;
      event.preventDefault();
      if (event.key.toLowerCase() === "k") setShowSearch(true);
      else if (event.key.toLowerCase() === "n") setForm({ mode: "new" });
      else setShowSettings(true);
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, []);
  function navigate(next: string) {
    if (next !== id) {
      if (!confirmNavigation()) return false;
      history.pushState(
        {},
        "",
        next ? `/bewerbung/applications/${next}` : "/bewerbung/",
      );
      setId(next);
      setPanel(null);
    }
    setMobileSidebar(false);
    return true;
  }
  async function open(next: string) {
    if (!navigate(next)) return;
    try {
      setUi(await api<UiState>(`/applications/${next}/open`, "POST", {}));
    } catch (e) {
      fail(e);
    }
  }
  async function close(target: string) {
    try {
      const state = await api<UiState>(
        `/applications/${target}/close`,
        "POST",
        {},
      );
      setUi(state);
      if (id === target) navigate(state.openIds[0] ?? "");
    } catch (e) {
      fail(e);
    }
  }
  async function applicationAction(action: ApplicationAction, target: string) {
    if (action === "documents" || action === "source") {
      void open(target);
      setPanel(action);
      return;
    }
    try {
      const application = await api<ApplicationDetail>(
        `/applications/${target}`,
      );
      if (action === "delete") {
        setDeleteError("");
        setRemoving(application);
      } else setForm({ mode: action, application });
    } catch (e) {
      fail(e);
    }
  }
  async function deleteApplication() {
    if (!removing || deleteBusy) return;
    setDeleteBusy(true);
    setDeleteError("");
    const finishDraft = await prepareDraftDeletion(removing.id);
    let deleted = false;
    try {
      const result = await api<{ ok: true; ui: UiState }>(
        `/applications/${removing.id}`,
        "DELETE",
        { revision: removing.revision },
      );
      deleted = true;
      finishDraft(true);
      setUi(result.ui);
      setApplications((current) =>
        current.filter((app) => app.id !== removing.id),
      );
      if (routeRef.current === removing.id) {
        history.pushState({}, "", "/bewerbung/");
        setId("");
        setPanel(null);
      }
      setRemoving(null);
      await refreshList();
    } catch (e) {
      if (deleted) fail(e);
      else {
        finishDraft(false);
        setDeleteError(
          e instanceof ApiError && e.status === 409
            ? `${errorMessage(e)} Bitte laufende Arbeiten beenden und den Löschdialog erneut öffnen, um den aktuellen Stand zu bestätigen.`
            : errorMessage(e),
        );
        await refreshList().catch(fail);
      }
    } finally {
      setDeleteBusy(false);
    }
  }
  async function changeStatus(
    application: Application,
    status: ApplicationStatus,
  ) {
    try {
      await api(`/applications/${application.id}`, "PATCH", {
        revision: application.revision,
        status,
      });
      await refreshList();
      setRefreshKey((n) => n + 1);
    } catch (e) {
      fail(e);
      await refreshList().catch(fail);
    }
  }
  function saveSettings(
    patch: Partial<Settings> | ((current: Settings) => Partial<Settings>),
  ) {
    const write = settingsWrites.current
      .catch(() => {})
      .then(async () => {
        if (!settingsRef.current)
          throw new Error(
            "Einstellungen noch nicht geladen. Bitte aktualisieren.",
          );
        try {
          const saved = await api<Settings>("/settings", "PUT", {
            ...(typeof patch === "function"
              ? patch(settingsRef.current)
              : patch),
            revision: settingsRef.current.revision,
          });
          settingsRef.current = saved;
          setSettings(saved);
        } catch (e) {
          if (e instanceof ApiError && e.status === 409) {
            const latest = await api<Settings>("/settings");
            settingsRef.current = latest;
            setSettings(latest);
          }
          throw e;
        }
      });
    settingsWrites.current = write;
    return write;
  }
  function collapse(status: ApplicationStatus) {
    void saveSettings((current) => ({
      collapsedStatuses: current.collapsedStatuses.includes(status)
        ? current.collapsedStatuses.filter((s) => s !== status)
        : [...current.collapsedStatuses, status],
    })).catch(fail);
  }
  const sidebar = (
    <ApplicationSidebar
      applications={applications}
      currentId={id}
      openIds={ui.openIds}
      collapsed={settings?.collapsedStatuses ?? [...APPLICATION_STATUSES]}
      onOpen={(next) => void open(next)}
      onClose={(target) => void close(target)}
      onAction={(action, target) => void applicationAction(action, target)}
      onStatus={(application, status) => void changeStatus(application, status)}
      onCollapse={collapse}
      onNew={() => {
        setMobileSidebar(false);
        setForm({ mode: "new" });
      }}
      onSearch={() => {
        setMobileSidebar(false);
        setShowSearch(true);
      }}
      onSettings={() => {
        setMobileSidebar(false);
        setShowSettings(true);
      }}
      onLibrary={() => {
        setMobileSidebar(false);
        setShowLibrary(true);
      }}
      onRefresh={() => void refreshAll()}
    />
  );
  return (
    <TooltipProvider delay={350}>
      <div className="flex h-dvh min-h-0 w-full overflow-hidden bg-background text-foreground">
        <aside className="hidden h-full w-[302px] shrink-0 border-r border-sidebar-border md:block">
          {sidebar}
        </aside>
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          {error && (
            <div className="p-3">
              <ErrorNotice error={error} onClose={() => setError("")} />
            </div>
          )}
          {id ? (
            <div className="min-h-0 flex-1">
              <Workspace
                key={id}
                id={id}
                applications={applications}
                settings={settings ?? { autoBuild: false }}
                refreshKey={refreshKey}
                panel={panel}
                onPanel={setPanel}
                onEdit={() => void applicationAction("edit", id)}
                onSidebar={() => setMobileSidebar(true)}
                onListChanged={() => void refreshList().catch(fail)}
              />
            </div>
          ) : (
            <>
              <header className="flex h-13 shrink-0 items-center gap-3 px-3">
                <IconButton
                  label="Bewerbungen einblenden"
                  className="md:hidden"
                  onClick={() => setMobileSidebar(true)}
                >
                  <PanelLeft />
                </IconButton>
                <span className="text-sm font-medium">Bewerbungen</span>
              </header>
              <section className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-6 pb-16 text-center">
                <FileText className="size-8 text-muted-foreground/60" />
                <h1 className="text-xl font-medium">Deine nächste Bewerbung</h1>
                <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
                  {loading
                    ? "Arbeitsbereich wird geladen…"
                    : "Lebenslauf, Anschreiben und Anlagen an einem Ort. Öffne eine Bewerbung oder lege eine neue an."}
                </p>
                <Button
                  disabled={loading}
                  onClick={() => setForm({ mode: "new" })}
                >
                  <SquarePen />
                  Neue Bewerbung
                </Button>
              </section>
            </>
          )}
        </main>
        <Sheet open={mobileSidebar} onOpenChange={setMobileSidebar}>
          <SheetPopup
            side="left"
            className="w-[min(302px,calc(100vw-2rem))] p-0"
            showCloseButton={false}
          >
            <SheetHeader className="sr-only">
              <SheetTitle>Bewerbungen</SheetTitle>
              <SheetDescription>
                Geöffnete Bewerbungen und Statusgruppen
              </SheetDescription>
            </SheetHeader>
            <div className="flex justify-end bg-sidebar px-2 pt-2">
              <IconButton
                label="Seitenleiste schließen"
                onClick={() => setMobileSidebar(false)}
              >
                <X />
              </IconButton>
            </div>
            <div className="min-h-0 flex-1">{sidebar}</div>
          </SheetPopup>
        </Sheet>
        {form && (
          <ApplicationDialog
            request={form}
            applications={applications}
            templates={templates}
            onClose={() => setForm(null)}
            onSaved={async (application) => {
              await refreshList().catch(fail);
              setRefreshKey((n) => n + 1);
              await open(application.id);
            }}
          />
        )}
        {showSettings && settings && (
          <SettingsDialog
            settings={settings}
            applications={applications}
            templates={templates}
            saveSettings={saveSettings}
            onClose={() => setShowSettings(false)}
            onImported={refreshList}
          />
        )}
        <Dialog
          open={Boolean(removing)}
          onOpenChange={(open) => {
            if (!open && !deleteBusy) setRemoving(null);
          }}
        >
          <DialogPopup showCloseButton={!deleteBusy}>
            <DialogHeader>
              <DialogTitle>Bewerbung löschen</DialogTitle>
              <DialogDescription>
                „{removing?.company} · {removing?.role}“ dauerhaft löschen?
                Chat, Entwürfe, Quellen und Builds dieser Bewerbung werden
                entfernt. Zentrale Dateien in „Eigene Dateien“ bleiben erhalten.
                Dies lässt sich nicht rückgängig machen.
              </DialogDescription>
            </DialogHeader>
            {deleteError && (
              <DialogPanel>
                <ErrorNotice error={deleteError} />
              </DialogPanel>
            )}
            <DialogFooter>
              <Button
                variant="ghost"
                disabled={deleteBusy}
                onClick={() => setRemoving(null)}
              >
                Abbrechen
              </Button>
              <Button
                variant="destructive-outline"
                disabled={deleteBusy}
                onClick={() => void deleteApplication()}
              >
                {deleteBusy ? "Löschen…" : "Bewerbung löschen"}
              </Button>
            </DialogFooter>
          </DialogPopup>
        </Dialog>
        <LibraryDialog open={showLibrary} onOpenChange={setShowLibrary} />
        {showSearch && (
          <SearchDialog
            onClose={() => setShowSearch(false)}
            onOpen={(next) => void open(next)}
          />
        )}
      </div>
    </TooltipProvider>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
