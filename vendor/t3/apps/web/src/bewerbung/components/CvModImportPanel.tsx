import { useEffect, useEffectEvent, useRef, useState } from "react";
import { FileInput, ExternalLink, RefreshCw, Trash2 } from "lucide-react";
import type { CvModJob } from "../shared/api";
import { api, base, errorMessage, requireBusiness } from "../api";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import { Choice, ErrorNotice, Field } from "./Controls";
import { uploadLibraryDocument } from "./DocumentLibrary";

const statuses: Record<CvModJob["status"], string> = {
  uploaded: "Bereit zum KI-Start",
  generating: "KI erstellt Adapter",
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
};
const pending = (job: CvModJob) => ["generating", "needs-input", "checking"].includes(job.status);
function fileBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("ZIP konnte nicht gelesen werden"));
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.readAsDataURL(file);
  });
}
export function CvModImportPanel({
  onJobs,
  onDocumentsChanged,
  onSelect,
}: {
  onJobs?: (jobs: CvModJob[]) => void;
  onDocumentsChanged?: () => void;
  onSelect?: (id: string) => void;
}) {
  const [kind, setKind] = useState("cv-template"),
    [file, setFile] = useState<File | null>(null),
    [busy, setBusy] = useState(false),
    [jobs, setJobs] = useState<CvModJob[]>([]),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [reload, setReload] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const publish = useEffectEvent((next: CvModJob[]) => onJobs?.(next));
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- polls durable external import jobs only while work is active and cancels on unmount
  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = async () => {
      try {
        const next = await api<CvModJob[]>("/cv-mods/jobs", "GET", undefined, abort.signal);
        if (abort.signal.aborted) return;
        setJobs(next);
        publish(next);
        if (next.some(pending)) timer = setTimeout(() => void read(), 2000);
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
  }, [reload]);
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
    setBusy(true);
    setError("");
    try {
      await api(`/cv-mods/jobs/${id}/${action}`, "POST", {});
      setReload((v) => v + 1);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function upload() {
    if (!file || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (kind === "document") {
        await uploadLibraryDocument(file);
        onDocumentsChanged?.();
        setNotice("Datei in der Dokumentenbibliothek gespeichert.");
      } else {
        requireBusiness(
          /\.zip$/i.test(file.name) && file.size > 0 && file.size <= 8 * 1024 * 1024,
          "Lebenslauf-Vorlage als LaTeX-ZIP bis 8 MiB hochladen. Eine PDF allein genügt nicht.",
        );
        const job = await api<CvModJob>("/cv-mods/jobs", "POST", {
          documentType: "cv-template",
          name: file.name,
          zipBase64: await fileBase64(file),
        });
        setJobs((previous) => [job, ...previous]);
        await api(`/cv-mods/jobs/${job.id}/start`, "POST", {});
      }
      setFile(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
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
              setKind(v);
              setFile(null);
            }}
            disabled={busy}
            options={[
              { value: "cv-template", label: "Lebenslauf-Vorlage (LaTeX-ZIP)" },
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
        accept={kind === "cv-template" ? ".zip,application/zip" : ".pdf,.jpg,.jpeg,.png"}
        onChange={(e) => {
          setFile(e.target.files?.[0] || null);
          e.target.value = "";
        }}
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-lg text-xs text-muted-foreground">
          {kind === "cv-template"
            ? "KI erstellt die Datenanbindung mit deinen nativen Provider- und Berechtigungseinstellungen. Der Start kann Kosten verursachen."
            : "Die Datei wird als Anlage gespeichert; es startet keine KI."}
        </p>
        <Button disabled={!file || busy} onClick={() => void upload()}>
          {busy
            ? "Wird verarbeitet…"
            : kind === "cv-template"
              ? "Hochladen & KI starten"
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
              <h3 className="min-w-0 break-all text-sm font-medium">{job.name}</h3>
              <Badge variant="outline">{statuses[job.status]}</Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              {job.files.length} Quelldateien · {job.entrypoints.join(", ")}
            </p>
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
                <Button size="sm" disabled={busy} onClick={() => void run(job.id, "start")}>
                  KI starten
                </Button>
              )}
              {job.threadId && !pending(job) && (
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
              {!pending(job) && (
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => void remove(job)}>
                  <Trash2 />
                  Entfernen
                </Button>
              )}
              {onSelect && job.status === "review" && (
                <Button size="sm" onClick={() => onSelect(job.id)}>
                  Für diese Bewerbung verwenden
                </Button>
              )}
            </div>
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
