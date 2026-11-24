import { useEffect, useEffectEvent, useRef, useState } from "react";
import { FileInput, ExternalLink, RefreshCw, Trash2 } from "lucide-react";
import type { CvModJob } from "../shared/api";
import { api, base, errorMessage, requireBusiness } from "../api";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import { randomUUID } from "~/lib/utils";
import { Choice, ErrorNotice, Field } from "./Controls";
import { uploadLibraryDocument } from "./DocumentLibrary";
import { ModProvenanceView } from "./ModProvenanceView";

const statuses: Record<CvModJob["status"], string> = {
  uploaded: "Bereit zum KI-Start",
  generating: "KI erstellt Vorlage und Datenanbindung",
  "needs-input": "Antwort im KI-Thread nötig",
  checking: "PDF-Prüfung läuft",
  review: "Geprüft · zur Durchsicht",
  failed: "Prüfung fehlgeschlagen",
  interrupted: "Unterbrochen",
};
const cases: Record<string, string> = {
  bullets: "Stichpunkte und mehrere Einträge",
  paragraphs: "Fließtext und Sonderzeichen",
  mixed: "Gemischte Inhalte",
  "optional-role": "Optionale Rolle",
  empty: "Ohne Abschnitte",
  "form-full": "Alle Formularfelder und gemischte Inhalte",
  "form-reordered": "Geänderte Reihenfolge",
  "form-excluded": "PDF-Auswahl und Metadaten",
  "form-empty": "Leere Sammlungen",
  "cover-fields": "Alle Anschreiben-Felder",
  "cover-special": "Sonderzeichen und Absätze",
  "cover-long": "Langer Brief und Seitenumbrüche",
  "cover-empty": "Leere Eingaben",
};
type Inspection = { files: string[]; entrypoints: string[]; warnings: string[] };
const pending = (job: CvModJob) => ["generating", "needs-input", "checking"].includes(job.status);
function fileBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Datei konnte nicht gelesen werden"));
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.readAsDataURL(file);
  });
}
export function CvModImportPanel({
  onJobs,
  onDocumentsChanged,
  onSelect,
  templateType = "cv",
}: {
  onJobs?: (jobs: CvModJob[]) => void;
  onDocumentsChanged?: () => void;
  onSelect?: (id: string) => void;
  templateType?: "cv" | "cover" | "all";
}) {
  const [kind, setKind] = useState(templateType === "cover" ? "cover-template" : "cv-template"),
    [file, setFile] = useState<File | null>(null),
    [busy, setBusy] = useState(false),
    [jobs, setJobs] = useState<CvModJob[]>([]),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [reload, setReload] = useState(0),
    [inspection, setInspection] = useState<Inspection | null>(null),
    [entrypoint, setEntrypoint] = useState(""),
    [inspecting, setInspecting] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const locked = useRef(false);
  const selection = useRef(0);
  const attempt = useRef<string | null>(null);
  async function chooseFile(next: File | null) {
    const current = ++selection.current;
    setFile(next);
    setInspection(null);
    setEntrypoint("");
    setError("");
    setInspecting(false);
    attempt.current = null;
    if (!next || kind === "document") return;
    setInspecting(true);
    try {
      requireBusiness(
        /\.(zip|tex)$/i.test(next.name) &&
          next.size > 0 &&
          next.size <= (/\.tex$/i.test(next.name) ? 4 : 8) * 1024 * 1024,
        "LaTeX-ZIP bis 8 MiB oder einzelne .tex-Datei bis 4 MiB wählen. Eine PDF ist eine Anlage, keine editierbare Vorlage.",
      );
      const result = await api<Inspection>("/cv-mods/inspect", "POST", {
        name: next.name,
        zipBase64: await fileBase64(next),
      });
      if (current !== selection.current) return;
      setInspection(result);
      setEntrypoint(result.entrypoints.length === 1 ? result.entrypoints[0]! : "");
    } catch (e) {
      if (current === selection.current) setError(errorMessage(e));
    } finally {
      if (current === selection.current) setInspecting(false);
    }
  }
  async function mutate(job: CvModJob, action: "approve" | "source", value: string) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      await api(`/cv-mods/jobs/${job.id}/${action}`, "POST", {
        updated: job.updated,
        ...(action === "approve" ? { versionId: value } : { entrypoint: value }),
      });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      locked.current = false;
      setBusy(false);
      setReload((v) => v + 1);
    }
  }
  const publish = useEffectEvent((next: CvModJob[]) => onJobs?.(next));
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- polls durable external import jobs only while work is active and cancels on unmount
  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = async () => {
      try {
        const next = await api<CvModJob[]>("/cv-mods/jobs", "GET", undefined, abort.signal);
        if (abort.signal.aborted) return;
        const matching = next.filter(
          (job) =>
            templateType === "all" ||
            (templateType === "cover"
              ? job.documentType === "cover-template"
              : job.documentType !== "cover-template"),
        );
        setJobs(matching);
        publish(matching);
        if (matching.some(pending)) timer = setTimeout(() => void read(), 2000);
      } catch (e) {
        if (!abort.signal.aborted) setError(errorMessage(e));
      }
    };
    void read();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- explicit invalidation token reloads external server jobs after a local mutation
  }, [reload, templateType]);
  async function remove(job: CvModJob) {
    if (
      !confirm(
        "Vorlagenimport samt KI-Thread und eigenen Dateien löschen? In Bewerbungen verwendete Vorlagen werden nicht gelöscht.",
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      await api(`/cv-mods/jobs/${job.id}`, "DELETE", { updated: job.updated });
      setReload((value) => value + 1);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function run(id: string, action: "start" | "check") {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      await api(`/cv-mods/jobs/${id}/${action}`, "POST", {});
      setReload((v) => v + 1);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  async function upload() {
    if (
      !file ||
      locked.current ||
      inspecting ||
      (kind !== "document" && (!inspection || !entrypoint))
    )
      return;
    locked.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (kind === "document") {
        await uploadLibraryDocument(file);
        onDocumentsChanged?.();
        setNotice("Datei in der Dokumentenbibliothek gespeichert.");
      } else {
        attempt.current ??= randomUUID();
        const job = await api<CvModJob>("/cv-mods/jobs", "POST", {
          documentType: kind,
          name: file.name,
          zipBase64: await fileBase64(file),
          requestId: attempt.current,
          entrypoint,
        });
        setJobs((previous) => [job, ...previous.filter((item) => item.id !== job.id)]);
        if (job.status === "uploaded") await api(`/cv-mods/jobs/${job.id}/start`, "POST", {});
        setNotice(
          "Import gespeichert. Fortschritt und Rückfragen findest du unten im zugehörigen KI-Thread.",
        );
      }
      setFile(null);
      setInspection(null);
      attempt.current = null;
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      locked.current = false;
      setBusy(false);
      setReload((v) => v + 1);
    }
  }
  return (
    <section className="space-y-4" aria-label="Vorlage hochladen" data-cv-mod-import>
      <ErrorNotice error={error} onClose={() => setError("")} />
      <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Field label="Dokumenttyp">
          <Choice
            label="Dokumenttyp beim Hochladen"
            value={kind}
            onChange={(v) => {
              selection.current++;
              setKind(v);
              setFile(null);
              setInspection(null);
              setInspecting(false);
              attempt.current = null;
            }}
            disabled={busy}
            options={[
              ...(templateType !== "cover"
                ? [{ value: "cv-template", label: "Lebenslauf-Vorlage (ZIP / TeX)" }]
                : []),
              ...(templateType !== "cv"
                ? [{ value: "cover-template", label: "Anschreiben-Vorlage (ZIP / TeX)" }]
                : []),
              { value: "document", label: "Dokument / Anlage" },
            ]}
          />
        </Field>
        <div className="flex min-w-0 flex-wrap items-end gap-2">
          <Button variant="outline" disabled={busy} onClick={() => input.current?.click()}>
            <FileInput />
            Datei auswählen
          </Button>
          <span className="min-w-0 break-all text-xs text-muted-foreground">{file?.name}</span>
        </div>
      </div>
      <input
        ref={input}
        className="hidden"
        type="file"
        aria-label="Datei für Vorlagenimport auswählen"
        accept={kind !== "document" ? ".zip,.tex,application/zip" : ".pdf,.jpg,.jpeg,.png"}
        onChange={(e) => {
          void chooseFile(e.target.files?.[0] || null);
          e.target.value = "";
        }}
      />
      {inspecting && (
        <p role="status" className="text-xs text-muted-foreground">
          Quelldateien werden geprüft – ohne KI-Start…
        </p>
      )}
      {inspection && (
        <div className="space-y-2 text-xs">
          <Field label="LaTeX-Hauptdatei">
            <Choice
              label="LaTeX-Hauptdatei"
              value={entrypoint}
              disabled={busy}
              onChange={(value) => {
                setEntrypoint(value);
                attempt.current = null;
              }}
              options={[
                { value: "", label: "Hauptdatei auswählen" },
                ...inspection.entrypoints.map((value) => ({ value, label: value })),
              ]}
            />
          </Field>
          <p className="text-muted-foreground">
            {inspection.files.length} Quelldateien erkannt. ZIP mit Bildern, Fonts und
            Begleitdateien bis 8 MiB; einzelne TeX bis 4 MiB. Paket- und Fontverfügbarkeit wird beim
            Bauen geprüft.
          </p>
          {inspection.warnings.map((warning) => (
            <p key={warning} className="break-words">
              {warning}
            </p>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-lg text-xs text-muted-foreground">
          {kind !== "document"
            ? kind === "cover-template"
              ? "KI bindet Anschreiben-Felder, Bewerberprofil und Unterschriftsbedarf an deine Originalvorlage an. Danach Prüf-PDFs durchsehen und den konkreten Stand freigeben."
              : "KI erstellt Formular und Datenanbindung für deine Originalvorlage mit den vorhandenen nativen Einstellungen. Danach Prüf-PDFs durchsehen und den konkreten Stand freigeben."
            : "Die Datei wird als Anlage gespeichert; es startet keine KI."}
        </p>
        <Button
          disabled={
            !file || busy || inspecting || (kind !== "document" && (!inspection || !entrypoint))
          }
          onClick={() => void upload()}
        >
          {busy
            ? "Wird verarbeitet…"
            : kind !== "document"
              ? "Hochladen & Mod erstellen"
              : "Datei hochladen"}
        </Button>
      </div>
      {notice && (
        <p role="status" className="text-xs text-muted-foreground">
          {notice}
        </p>
      )}
      <ul className="space-y-3">
        {jobs.map((job) => (
          <li
            key={job.id}
            className="min-w-0 space-y-3 rounded-lg border p-3"
            data-cv-mod-job={job.id}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="min-w-0 break-all text-sm font-medium">{job.label || job.name}</h3>
              <Badge variant="outline">
                {job.status === "review" && job.approvedVersionId === job.versionId
                  ? "Freigegeben · verwendbar"
                  : statuses[job.status]}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              {job.files.length} Quelldateien · Hauptdatei:{" "}
              {job.selectedEntrypoint ||
                (job.entrypoints.length === 1 ? job.entrypoints[0] : "noch auswählen")}
            </p>
            <p className="text-xs text-muted-foreground">
              {job.documentType === "cover-template"
                ? "Anschreiben-Vorlage"
                : (job.manifest?.format || job.targetFormat) === "bewerbung-cv-form-v2"
                  ? "Formular-Mod v2"
                  : "Ältere Datenanbindung v1"}{" "}
              · Prüf-PDFs und Layout vor Verwendung durchsehen.
            </p>
            {job.warnings?.map((warning) => (
              <p key={warning} className="break-words text-xs text-muted-foreground">
                {warning}
              </p>
            ))}
            {job.status === "uploaded" && job.entrypoints.length > 1 && (
              <Field label="Hauptdatei vor KI-Start auswählen">
                <Choice
                  label={`Hauptdatei für ${job.name}`}
                  value={job.selectedEntrypoint || ""}
                  disabled={busy}
                  onChange={(value) => void mutate(job, "source", value)}
                  options={[
                    { value: "", label: "Hauptdatei auswählen" },
                    ...job.entrypoints.map((value) => ({ value, label: value })),
                  ]}
                />
              </Field>
            )}
            {job.error && <ErrorNotice error={job.error} />}
            <div className="flex flex-wrap gap-2">
              {job.threadUrl && (
                <Button
                  size="sm"
                  variant="outline"
                  render={<a href={job.threadUrl} target="_blank" rel="noopener noreferrer" />}
                >
                  <ExternalLink />
                  KI-Thread öffnen
                </Button>
              )}
              {job.status === "uploaded" && (
                <Button
                  size="sm"
                  disabled={busy || (!job.selectedEntrypoint && job.entrypoints.length !== 1)}
                  onClick={() => void run(job.id, "start")}
                >
                  KI starten
                </Button>
              )}
              {job.threadId && !["generating", "checking"].includes(job.status) && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void run(job.id, "check")}
                >
                  <RefreshCw />
                  Erneut prüfen
                </Button>
              )}
              {!["generating", "checking"].includes(job.status) && (
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => void remove(job)}>
                  <Trash2 />
                  Entfernen
                </Button>
              )}
              {job.status === "review" &&
                job.versionId &&
                job.approvedVersionId !== job.versionId && (
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() => void mutate(job, "approve", job.versionId!)}
                  >
                    Layout geprüft – Vorlage freigeben
                  </Button>
                )}
              {onSelect &&
                job.status === "review" &&
                job.versionId &&
                job.approvedVersionId === job.versionId && (
                  <Button size="sm" onClick={() => onSelect(job.versionId!)}>
                    {job.documentType === "cover-template"
                      ? "Für dieses Anschreiben verwenden"
                      : "Für diese Bewerbung verwenden"}
                  </Button>
                )}
            </div>
            <ModProvenanceView job={job} />
            {job.checks.length > 0 && (
              <details>
                <summary className="cursor-pointer text-xs text-muted-foreground">
                  Build-Prüfungen und Vorschau
                </summary>
                <ul className="mt-2 space-y-2">
                  {job.checks.map((check) => (
                    <li key={check.id} className="space-y-1 text-xs">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span>
                          {cases[check.id] || check.id} ·{" "}
                          {check.status === "passed"
                            ? "Bestanden"
                            : check.status === "unsupported"
                              ? "Feld nicht deklariert"
                              : "Fehler"}
                        </span>
                        {check.status === "passed" && (
                          <Button
                            size="xs"
                            variant="ghost"
                            render={
                              <a
                                href={`${base}/cv-mods/jobs/${job.id}/pdf/${check.id}`}
                                target="_blank"
                                rel="noopener noreferrer"
                              />
                            }
                          >
                            PDF öffnen
                          </Button>
                        )}
                      </div>
                      {check.error && (
                        <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-muted-foreground">
                          {check.error}
                        </pre>
                      )}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
