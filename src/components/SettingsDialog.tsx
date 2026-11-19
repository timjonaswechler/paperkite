// Layout slots adapted from T3 settings/settingsLayout.tsx and SettingsSidebarNav.tsx.
import { useRef, useState, type ReactNode } from "react";
import { ArrowLeft, BookOpen, FileInput, Settings2 } from "lucide-react";
import type { Application, Settings, TemplateSummary } from "../../shared/api";
import { api, errorMessage } from "../api";
import {
  Dialog,
  DialogPopup,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { Switch } from "./ui/switch";
import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "./ui/sidebar";
import { SettingsGroup } from "./settings/SettingsGroup";
import { ErrorNotice } from "./Controls";
import { DocumentLibrary } from "./DocumentLibrary";
import { TemplatesManager } from "./TemplatesManager";
import license from "../T3-LICENSE.txt?raw";

function SettingsRow({
  title,
  description,
  control,
  children,
}: {
  title: string;
  description: string;
  control?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div
      data-slot="settings-row"
      className="group/settings-row @container/settings-row rounded-xl px-3 py-3 sm:px-4"
    >
      <div className="flex flex-col gap-3 @min-[32rem]/settings-row:grid @min-[32rem]/settings-row:grid-cols-[minmax(0,1fr)_auto] @min-[32rem]/settings-row:items-center @min-[32rem]/settings-row:gap-8">
        <div className="min-w-0 flex-1 space-y-1">
          <h3 className="text-sm font-medium text-foreground">{title}</h3>
          <p className="max-w-2xl text-pretty text-xs leading-normal text-muted-foreground">
            {description}
          </p>
        </div>
        {control && (
          <div className="flex w-full min-w-0 shrink-0 items-center gap-2 @min-[32rem]/settings-row:w-auto @min-[32rem]/settings-row:justify-end">
            {control}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}
const sections = [
  { id: "general", label: "Allgemein", icon: Settings2 },
  { id: "files", label: "Eigene Dateien", icon: BookOpen },
  { id: "templates", label: "Vorlagen", icon: FileInput },
];
export function SettingsDialog({
  settings,
  applications,
  templates,
  saveSettings,
  onClose,
  onImported,
}: {
  settings: Settings;
  applications: Application[];
  templates: TemplateSummary[];
  saveSettings: (patch: Partial<Settings>) => Promise<void>;
  onClose: () => void;
  onImported: () => Promise<void>;
}) {
  const [section, setSection] = useState("general");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  async function save(patch: Partial<Settings>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await saveSettings(patch);
      setNotice("Gespeichert.");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPopup
        className="h-[min(48rem,90dvh)] max-w-5xl overflow-hidden"
        showCloseButton={false}
        bottomStickOnMobile={false}
      >
        <header className="flex h-13 shrink-0 items-center gap-3 border-b border-border/60 px-4">
          <Button
            variant="ghost-muted"
            size="icon-sm"
            aria-label="Zurück zum Chat"
            onClick={onClose}
          >
            <ArrowLeft />
          </Button>
          <DialogTitle className="text-base">Einstellungen</DialogTitle>
          <DialogDescription className="sr-only">
            PDF-Erstellung, eigene Dateien und Vorlagen verwalten.
          </DialogDescription>
        </header>
        <div className="flex min-h-0 flex-1">
          <nav
            aria-label="Einstellungsbereiche"
            className="flex w-60 shrink-0 flex-col border-e bg-sidebar text-sidebar-foreground max-md:w-14"
          >
            <SidebarGroup>
              <SidebarMenu>
                {sections.map(({ id, label, icon: Icon }) => (
                  <SidebarMenuItem key={id}>
                    <SidebarMenuButton
                      aria-label={label}
                      aria-current={section === id ? "page" : undefined}
                      isActive={section === id}
                      onClick={() => {
                        setSection(id);
                        setNotice("");
                      }}
                    >
                      <Icon />
                      <span className="truncate max-md:sr-only">{label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroup>
          </nav>
          <div
            className="min-w-0 flex-1 overflow-y-auto p-4 sm:p-8"
            data-settings-page-scroll
          >
            <div className="mx-auto flex max-w-3xl flex-col gap-6">
              <h2 className="text-xl font-semibold">
                {sections.find((s) => s.id === section)?.label}
              </h2>
              <ErrorNotice error={error} onClose={() => setError("")} />
              {section === "general" && (
                <>
                  <SettingsGroup>
                    <SettingsRow
                      title="Nach dem Speichern bauen"
                      description="Nach manuellem Speichern einer CV- oder Anschreiben-Quelldatei automatisch ein PDF bauen."
                      control={
                        <Switch
                          aria-label="Nach dem Speichern bauen"
                          checked={settings.autoBuild}
                          disabled={busy}
                          onCheckedChange={(autoBuild) =>
                            void save({ autoBuild })
                          }
                        />
                      }
                    />
                  </SettingsGroup>
                  <details className="text-xs text-muted-foreground">
                    <summary className="cursor-pointer">
                      Open-Source-Hinweis · T3 Tools
                    </summary>
                    <pre className="mt-3 whitespace-pre-wrap font-sans">
                      {license}
                    </pre>
                  </details>
                </>
              )}
              {section === "files" && (
                <>
                  <p className="text-sm text-muted-foreground">
                    Zeugnisse und Anlagen zentral verwalten. Die Auswahl je
                    Bewerbung änderst du in deren Details.
                  </p>
                  <DocumentLibrary />
                </>
              )}
              {section === "templates" && (
                <>
                  <SettingsGroup>
                    <SettingsRow
                      title="Master importieren"
                      description="Vorbereitete JSON-Datei mit Datei-Map (maximal 24 MiB). Vorhandene Bewerbungen bleiben unabhängig; alte Anschreiben werden nicht als neutraler Standard verwendet."
                      control={
                        <Button
                          variant="outline"
                          disabled={busy}
                          onClick={() => fileRef.current?.click()}
                        >
                          <FileInput />
                          JSON importieren
                        </Button>
                      }
                    />
                    <input
                      ref={fileRef}
                      type="file"
                      className="hidden"
                      accept="application/json,.json"
                      aria-label="Master-JSON importieren"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = "";
                        if (!file) return;
                        setBusy(true);
                        setError("");
                        void (async () => {
                          try {
                            if (file.size > 24 * 1024 * 1024)
                              throw new Error("Import maximal 24 MiB");
                            const result = await api<{ count: number }>(
                              "/templates/import",
                              "POST",
                              JSON.parse(await file.text()),
                            );
                            await onImported();
                            setNotice(`${result.count} Dateien importiert.`);
                          } catch (e) {
                            setError(errorMessage(e));
                          } finally {
                            setBusy(false);
                          }
                        })();
                      }}
                    />
                  </SettingsGroup>
                  <TemplatesManager
                    templates={templates}
                    applications={applications}
                    onChanged={onImported}
                  />
                </>
              )}
              <p role="status" className="text-xs text-muted-foreground">
                {notice}
              </p>
            </div>
          </div>
        </div>
      </DialogPopup>
    </Dialog>
  );
}
