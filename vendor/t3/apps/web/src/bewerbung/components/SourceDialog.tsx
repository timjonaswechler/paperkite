import { useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";
import type { Application, ApplicationDetail } from "~/bewerbung/shared/api";
import { api, base, errorMessage, sourceFile } from "../api";
import { EntryReuse } from "../EntryReuse";
import { registerNavigationGuard } from "../navigation";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogPanel,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Choice, ErrorNotice } from "./Controls";

export function SourceDialog({
  app,
  applications,
  autoBuild,
  onClose,
  onRefresh,
}: {
  app: ApplicationDetail;
  applications: Application[];
  autoBuild: boolean;
  onClose: () => void;
  onRefresh: () => Promise<void>;
}) {
  const [file, setFile] = useState("");
  const [content, setContent] = useState("");
  const [revision, setRevision] = useState(app.revision);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [source, setSource] = useState("");
  const [sourceFiles, setSourceFiles] = useState<string[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const readSequence = useRef(0);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- registers the dirty source guard with application navigation
  useEffect(
    () => registerNavigationGuard(() => !dirty || confirm("Ungespeicherte Quelle verwerfen?")),
    [dirty],
  );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- warns before unloading unsaved source bytes
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty) event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const sourceSequence = useRef(0);
  async function chooseSource(next: string) {
    const sequence = ++sourceSequence.current;
    setSource(next);
    setSourceFiles([]);
    setSelectedFiles([]);
    if (!next) return;
    try {
      const result = await api<ApplicationDetail>(`/applications/${next}`);
      if (sequence === sourceSequence.current)
        setSourceFiles(
          result.files.filter((f) => f.name !== "application.json").map((f) => f.name),
        );
    } catch (e) {
      if (sequence === sourceSequence.current) setError(errorMessage(e));
    }
  }
  function close() {
    if (!busy && (!dirty || confirm("Ungespeicherte Quelle verwerfen?"))) onClose();
  }
  async function read(name: string) {
    if (dirty && !confirm("Ungespeicherte Dateiänderungen verwerfen?")) return;
    const sequence = ++readSequence.current;
    setBusy(true);
    setError("");
    try {
      const loaded = await sourceFile(
        `/applications/${app.id}/file?path=${encodeURIComponent(name)}`,
      );
      if (sequence === readSequence.current) {
        setFile(name);
        setContent(loaded.text);
        setRevision(loaded.revision);
        setDirty(false);
      }
    } catch (e) {
      setError(errorMessage(e));
    }

    if (sequence === readSequence.current) setBusy(false);
  }
  async function save() {
    if (!dirty || busy) return;
    setBusy(true);
    setError("");
    try {
      const saved = await api<{ revision: number }>(`/applications/${app.id}/file`, "PUT", {
        path: file,
        content,
        revision,
      });
      setRevision(saved.revision);
      setDirty(false);
      setNotice("Quelle gespeichert.");
      if (autoBuild)
        await api(`/applications/${app.id}/builds`, "POST", {
          kind: file.startsWith("anschreiben/") ? "cover" : "cv",
        });
      await onRefresh();
    } catch (e) {
      setError(errorMessage(e));
    }

    setBusy(false);
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogPopup className="max-w-5xl h-[90dvh]" showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>Lebenslauf / Quellen bearbeiten</DialogTitle>
          <DialogDescription>
            Erweiterter Editor für Lua-Profile und TeX. Dies sind interne Bewerbungsquellen, keine
            Zeugnisse oder Anlagen.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <ErrorNotice error={error} onClose={() => setError("")} />
          <div className="flex flex-wrap items-center gap-2">
            <div className="min-w-52 flex-1">
              <Choice
                label="Quelldatei auswählen"
                value={file}
                disabled={busy}
                onChange={(name) => {
                  if (name) void read(name);
                }}
                options={[
                  { value: "", label: "Quelldatei auswählen…" },
                  ...app.files.filter((f) => f.text).map((f) => ({ value: f.name, label: f.name })),
                ]}
              />
            </div>
            <Button
              disabled={!dirty || busy || app.harness.busy || file === "application.json"}
              onClick={() => void save()}
            >
              Speichern{dirty ? " *" : ""}
            </Button>
            <Button
              variant="outline"
              render={<a href={`${base}/applications/${app.id}/download`} />}
            >
              <Download />
              Quellen-ZIP
            </Button>
          </div>
          {file ? (
            <>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {dirty ? "Ungespeicherte Änderungen" : "Gespeicherter Stand"} · r{revision}
                  {autoBuild ? " · Automatischer Build aktiv" : ""}
                </span>
                <a
                  className="underline"
                  href={`${base}/applications/${app.id}/file?download=1&path=${encodeURIComponent(file)}`}
                >
                  Quelldatei herunterladen
                </a>
              </div>
              <textarea
                className="h-[42dvh] min-h-64 w-full resize-y rounded-lg border border-input bg-background p-4 font-mono text-xs leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                aria-label="Quelldatei"
                spellCheck={false}
                readOnly={file === "application.json" || app.harness.busy || busy}
                value={content}
                onChange={(e) => {
                  setContent(e.target.value);
                  setDirty(true);
                }}
              />
            </>
          ) : (
            <p className="py-8 text-sm text-muted-foreground">
              Wähle eine Datei im Menü. Lua-Konfiguration und TeX bleiben direkt editierbar;
              application.json ist schreibgeschützt.
            </p>
          )}
          <p role="status" className="text-xs text-muted-foreground">
            {notice}
          </p>
          <details className="rounded-lg border border-border/60 p-4">
            <summary className="cursor-pointer text-sm font-medium">
              Einzelne Lebenslauf-Einträge wiederverwenden
            </summary>
            <div className="mt-4">
              <EntryReuse
                id={app.id}
                revision={app.revision}
                profile={app.profile}
                files={app.files.map((f) => f.name)}
                applications={applications}
                disabled={dirty || busy || app.harness.busy}
                api={api}
                onError={(e) => setError(errorMessage(e))}
                onDone={async () => {
                  setFile("");
                  await onRefresh();
                  setNotice("CV-Einträge unabhängig kopiert.");
                }}
              />
            </div>
          </details>
          <details className="rounded-lg border border-border/60 p-4">
            <summary className="cursor-pointer text-sm font-medium">
              Ganze Quelldateien aus anderer Bewerbung übernehmen
            </summary>
            <div className="mt-4 space-y-3">
              <Choice
                label="Quellbewerbung für Dateien"
                value={source}
                onChange={(next) => void chooseSource(next)}
                options={[
                  { value: "", label: "Bewerbung auswählen…" },
                  ...applications
                    .filter((a) => a.id !== app.id)
                    .map((a) => ({
                      value: a.id,
                      label: `${a.company} · ${a.role}`,
                    })),
                ]}
              />
              <div className="grid max-h-48 gap-2 overflow-auto sm:grid-cols-2">
                {sourceFiles.map((name) => (
                  <label className="flex items-center gap-2 text-xs" key={name}>
                    <Checkbox
                      checked={selectedFiles.includes(name)}
                      onCheckedChange={(checked) =>
                        setSelectedFiles(
                          checked
                            ? [...selectedFiles, name]
                            : selectedFiles.filter((f) => f !== name),
                        )
                      }
                    />
                    <span className="break-all">{name}</span>
                  </label>
                ))}
              </div>
              <Button
                variant="outline"
                disabled={!selectedFiles.length || dirty || busy || app.harness.busy}
                onClick={async () => {
                  if (
                    !confirm(
                      "Ausgewählte Quelldateien hier ersetzen? Die Quellbewerbung bleibt unverändert.",
                    )
                  )
                    return;
                  setBusy(true);
                  setError("");
                  try {
                    await api(`/applications/${app.id}/reuse`, "POST", {
                      source,
                      files: selectedFiles,
                      revision: app.revision,
                    });
                    setFile("");
                    setSelectedFiles([]);
                    await onRefresh();
                    setNotice("Quelldateien unabhängig kopiert.");
                  } catch (e) {
                    setError(errorMessage(e));
                  }

                  setBusy(false);
                }}
              >
                Quelldateien übernehmen
              </Button>
            </div>
          </details>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
