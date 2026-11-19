import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useBlocker, useLocation, useNavigate } from "@tanstack/react-router";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import type {
  Application,
  ApplicationDetail,
  ApplicationNavigation,
  ApplicationStatus,
  Settings,
  TemplateSummary,
} from "./shared/api";
import { api, errorMessage, isApiError, requireBusiness } from "./api";
import { confirmNavigation } from "./navigation";
import { useNewThreadHandler } from "~/hooks/useHandleNewThread";
import { useThreadActions } from "~/hooks/useThreadActions";
import { waitForProject, useThreadShell } from "~/state/entities";
import { useThreadRouteTarget } from "~/hooks/useThreadRouteTarget";
import { useComposerDraftStore } from "~/composerDraftStore";
import { ApplicationDialog, type ApplicationFormRequest } from "./components/ApplicationDialog";
import { LibraryDialog } from "./components/DocumentLibrary";
import { SearchDialog } from "./components/SearchDialog";
import { ErrorNotice } from "./components/Controls";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogPanel,
  DialogFooter,
} from "~/components/ui/dialog";

export type ApplicationAction = "edit" | "copy" | "documents" | "source" | "delete";
type ChatRemoval = {
  applicationId: string;
  id: string;
  title: string;
  environmentId: string;
};
const ApplicationContext = createContext<ReturnType<typeof useApplicationController> | null>(null);

export function useApplications() {
  const context = useContext(ApplicationContext);
  if (!context) throw new Error("Bewerbungsverwaltung ist nicht bereit.");
  return context;
}

function useApplicationController() {
  const navigate = useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  const routeTarget = useThreadRouteTarget();
  const shell = useThreadShell(routeTarget?.kind === "server" ? routeTarget.threadRef : null);
  const draft = useComposerDraftStore((store) =>
    routeTarget?.kind === "draft" ? store.draftThreadsByThreadKey[routeTarget.draftId] : undefined,
  );
  const newThread = useNewThreadHandler();
  const threadActions = useThreadActions();
  useBlocker({
    shouldBlockFn: () => !confirmNavigation(),
    enableBeforeUnload: false,
  });
  const [applications, setApplications] = useState<Application[]>([]);
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [navigation, setNavigation] = useState<ApplicationNavigation>({
    environmentId: "",
    applications: [],
  });
  const [settings, setSettings] = useState<Settings | null>(null);
  const settingsRef = useRef<Settings | null>(null);
  const settingsWrites = useRef(Promise.resolve());
  const [form, setForm] = useState<ApplicationFormRequest | null>(null);
  const [removing, setRemoving] = useState<ApplicationDetail | null>(null);
  const [removingChat, setRemovingChat] = useState<ChatRemoval | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [showLibrary, setShowLibrary] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const projectId = shell?.projectId ?? draft?.projectId;
  const currentId = pathname.startsWith("/bewerbungen/")
    ? (pathname.split("/")[2] ?? "")
    : (navigation.applications.find(
        (app) =>
          app.projectId === projectId ||
          app.chats.some(
            (chat) => routeTarget?.kind === "server" && chat.id === routeTarget.threadRef.threadId,
          ),
      )?.id ?? "");
  const fail = (error: unknown) => setError(errorMessage(error));

  async function refreshList() {
    const [list, masters, chats] = await Promise.all([
      api<Application[]>("/applications"),
      api<TemplateSummary[]>("/templates"),
      api<ApplicationNavigation>("/navigation"),
    ]);
    setApplications(list);
    setTemplates(masters);
    setNavigation(chats);
  }
  async function refreshAll() {
    await refreshList();
    const preferences = await api<Settings>("/settings");
    settingsRef.current = preferences;
    setSettings(preferences);
    setRefreshKey((value) => value + 1);
  }
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- loads the shared business snapshot and refreshes it after browser focus
  useEffect(() => {
    let active = true;
    const refresh = () => {
      void Promise.all([
        api<Application[]>("/applications"),
        api<TemplateSummary[]>("/templates"),
        api<ApplicationNavigation>("/navigation"),
        api<Settings>("/settings"),
      ])
        .then(([list, masters, chats, preferences]) => {
          if (!active) return;
          setApplications(list);
          setTemplates(masters);
          setNavigation(chats);
          settingsRef.current = preferences;
          setSettings(preferences);
          setLoading(false);
        })
        .catch((error) => {
          if (active) {
            setError(errorMessage(error));
            setLoading(false);
          }
        });
    };
    refresh();
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      window.removeEventListener("focus", refresh);
    };
  }, []);

  function open(id: string, panel?: "documents" | "source") {
    void navigate({
      to: "/bewerbungen/$applicationId",
      params: { applicationId: id },
      search: panel ? { panel } : {},
    });
  }
  async function newChat(id: string) {
    try {
      const target = await api<{
        environmentId: EnvironmentId;
        projectId: ProjectId;
      }>(`/applications/${id}/t3-project`, "POST", {});
      const project = scopeProjectRef(target.environmentId, target.projectId);
      requireBusiness(
        await waitForProject(project),
        "Bewerbung wurde noch nicht vom Chatserver geladen.",
      );
      await refreshList();
      requireBusiness(
        (await newThread(project, {
          envMode: "local",
          branch: null,
          worktreePath: null,
          startFromOrigin: false,
        })) !== null,
        "Neuer Chat konnte nicht geöffnet werden.",
      );
    } catch (error) {
      fail(error);
    }
  }
  async function applicationAction(action: ApplicationAction, id: string) {
    if (action === "documents" || action === "source") return open(id, action);
    try {
      const application = await api<ApplicationDetail>(`/applications/${id}`);
      if (action === "delete") {
        setDeleteError("");
        setRemoving(application);
      } else setForm({ mode: action, application });
    } catch (error) {
      fail(error);
    }
  }
  async function changeStatus(application: Application, status: ApplicationStatus) {
    try {
      await api(`/applications/${application.id}`, "PATCH", {
        revision: application.revision,
        status,
      });
      await refreshList();
      setRefreshKey((value) => value + 1);
    } catch (error) {
      fail(error);
      await refreshList().catch(fail);
    }
  }
  function saveSettings(patch: Partial<Settings> | ((current: Settings) => Partial<Settings>)) {
    const write = settingsWrites.current
      .catch(() => {})
      .then(async () => {
        const current = settingsRef.current;
        requireBusiness(current, "Einstellungen noch nicht geladen.");
        try {
          const saved = await api<Settings>("/settings", "PUT", {
            ...(typeof patch === "function" ? patch(current) : patch),
            revision: current.revision,
          });
          settingsRef.current = saved;
          setSettings(saved);
        } catch (error) {
          if (isApiError(error) && error.status === 409) {
            const fresh = await api<Settings>("/settings");
            settingsRef.current = fresh;
            setSettings(fresh);
          }
          throw error;
        }
      });
    settingsWrites.current = write;
    return write;
  }
  function collapse(status: ApplicationStatus) {
    void saveSettings((current) => ({
      collapsedStatuses: current.collapsedStatuses.includes(status)
        ? current.collapsedStatuses.filter((value) => value !== status)
        : [...current.collapsedStatuses, status],
    })).catch(fail);
  }
  async function deleteApplication() {
    if (!removing || deleteBusy) return;
    setDeleteBusy(true);
    setDeleteError("");
    try {
      await api(`/applications/${removing.id}`, "DELETE", {
        revision: removing.revision,
      });
      if (currentId === removing.id) void navigate({ to: "/bewerbungen" });
      setRemoving(null);
      await refreshList();
    } catch (error) {
      setDeleteError(
        isApiError(error) && error.status === 409
          ? `${errorMessage(error)} Bitte laufende Arbeiten beenden und den Löschdialog mit aktuellem Stand erneut öffnen.`
          : errorMessage(error),
      );
      await refreshList().catch(fail);
    }
    setDeleteBusy(false);
  }
  async function deleteChat() {
    if (!removingChat || deleteBusy) return;
    setDeleteBusy(true);
    setDeleteError("");
    const result = await threadActions.deleteThread(
      scopeThreadRef(removingChat.environmentId as EnvironmentId, removingChat.id as ThreadId),
    );
    if (result._tag === "Success") {
      open(removingChat.applicationId);
      setRemovingChat(null);
      await refreshList().catch(fail);
    } else
      setDeleteError(
        "Der native Chatserver hat das Löschen abgelehnt. Laufende Arbeiten und Berechtigungen prüfen.",
      );
    setDeleteBusy(false);
  }
  return {
    applications,
    templates,
    navigation,
    settings,
    currentId,
    routeTarget,
    loading,
    error,
    setError,
    refreshKey,
    refreshList,
    refreshAll,
    open,
    newChat,
    applicationAction,
    changeStatus,
    collapse,
    saveSettings,
    form,
    setForm,
    removing,
    setRemoving,
    removingChat,
    setRemovingChat,
    deleteBusy,
    deleteError,
    setDeleteError,
    deleteApplication,
    deleteChat,
    showLibrary,
    setShowLibrary,
    showSearch,
    setShowSearch,
  };
}

export function ApplicationsProvider({ children }: { children: ReactNode }) {
  const app = useApplicationController();
  return (
    <ApplicationContext value={app}>
      {children}
      {app.error && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) app.setError("");
          }}
        >
          <DialogPopup>
            <DialogHeader>
              <DialogTitle>Bewerbungsverwaltung</DialogTitle>
            </DialogHeader>
            <DialogPanel>
              <ErrorNotice error={app.error} />
            </DialogPanel>
            <DialogFooter>
              <Button onClick={() => app.setError("")}>Schließen</Button>
            </DialogFooter>
          </DialogPopup>
        </Dialog>
      )}
      {app.form && (
        <ApplicationDialog
          request={app.form}
          applications={app.applications}
          templates={app.templates}
          onClose={() => app.setForm(null)}
          onSaved={async (application) => {
            await app.refreshList();
            app.open(application.id);
          }}
        />
      )}
      <Dialog
        open={Boolean(app.removing || app.removingChat)}
        onOpenChange={(open) => {
          if (!open && !app.deleteBusy) {
            app.setRemoving(null);
            app.setRemovingChat(null);
          }
        }}
      >
        <DialogPopup showCloseButton={!app.deleteBusy}>
          <DialogHeader>
            <DialogTitle>{app.removing ? "Bewerbung löschen" : "Chat löschen"}</DialogTitle>
            <DialogDescription>
              {app.removing
                ? `„${app.removing.company} · ${app.removing.role}“ mit allen Chats, Quellen und Builds dauerhaft löschen? Zentrale Dateien bleiben erhalten.`
                : `„${app.removingChat?.title}“ dauerhaft löschen? Andere Chats und die Bewerbungsunterlagen bleiben erhalten.`}
            </DialogDescription>
          </DialogHeader>
          {app.deleteError && (
            <DialogPanel>
              <ErrorNotice error={app.deleteError} />
            </DialogPanel>
          )}
          <DialogFooter>
            <Button
              variant="ghost"
              disabled={app.deleteBusy}
              onClick={() => {
                app.setRemoving(null);
                app.setRemovingChat(null);
              }}
            >
              Abbrechen
            </Button>
            <Button
              variant="destructive-outline"
              disabled={app.deleteBusy}
              onClick={() => void (app.removing ? app.deleteApplication() : app.deleteChat())}
            >
              {app.deleteBusy ? "Löschen…" : app.removing ? "Bewerbung löschen" : "Chat löschen"}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
      <LibraryDialog open={app.showLibrary} onOpenChange={app.setShowLibrary} />
      {app.showSearch && (
        <SearchDialog onClose={() => app.setShowSearch(false)} onOpen={app.open} />
      )}
    </ApplicationContext>
  );
}
