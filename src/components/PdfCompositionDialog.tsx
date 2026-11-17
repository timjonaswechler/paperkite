import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Download } from "lucide-react";
import type {
  ApplicationDetail,
  LibraryDocument,
  PdfCompression,
  PdfJob,
  PdfPlan,
} from "../../shared/api";
import { api, ApiError, base, errorMessage } from "../api";
import {
  pdfKey,
  pdfSources,
  planSourceKey,
  rehydratePdfPlan,
  validPageRange,
  type PdfRow,
} from "../pdfComposition";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Checkbox } from "./ui/checkbox";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogPanel,
  DialogFooter,
} from "./ui/dialog";
import { Choice, ErrorNotice, Field, IconButton } from "./Controls";

const bytesLabel = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
const active = (job: PdfJob) =>
  job.status === "queued" || job.status === "running";
export function PdfCompositionDialog({
  app,
  documents,
  onClose,
  onSaved,
}: {
  app?: ApplicationDetail;
  documents: LibraryDocument[];
  onClose: () => void;
  onSaved?: () => void;
}) {
  const [rows, setRows] = useState<PdfRow[]>([]);
  const [revision, setRevision] = useState(0);
  const [compression, setCompression] = useState<PdfCompression>("lossless");
  const [label, setLabel] = useState(
    app
      ? `${app.company} – Bewerbungsunterlagen`
      : "Zusammengefügte Unterlagen",
  );
  const [ready, setReady] = useState(false);
  const [capable, setCapable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [job, setJob] = useState<PdfJob | null>(null);
  const [jobs, setJobs] = useState<PdfJob[]>([]);
  const [pollId, setPollId] = useState("");
  const [reload, setReload] = useState(0);
  const [conflict, setConflict] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setReady(false);
    void (async () => {
      const [health, plan, history] = await Promise.all([
        api<{ pdfProcessing: boolean }>(
          "/health",
          "GET",
          undefined,
          controller.signal,
        ),
        app
          ? api<PdfPlan>(
              `/applications/${app.id}/pdf-plan`,
              "GET",
              undefined,
              controller.signal,
            )
          : Promise.resolve<PdfPlan>({
              revision: 0,
              items: [],
              compression: "lossless" as const,
            }),
        app
          ? api<PdfJob[]>(
              `/applications/${app.id}/pdf-jobs`,
              "GET",
              undefined,
              controller.signal,
            )
          : api<PdfJob[]>("/pdf-jobs", "GET", undefined, controller.signal),
      ]);
      if (controller.signal.aborted) return;
      setCapable(health.pdfProcessing === true);
      setRevision(plan.revision);
      setCompression(plan.compression);
      setRows(
        rehydratePdfPlan(
          plan.items,
          pdfSources(documents, app),
          app,
          plan.excluded ?? [],
        ),
      );
      setJobs(history);
      setConflict(false);
      setReady(true);
    })().catch((e) => {
      if (!controller.signal.aborted) setError(errorMessage(e));
    });
    return () => controller.abort();
    // The dialog edits a snapshot; reopening picks up changed application sources.
  }, [app?.id, reload]);
  useEffect(() => {
    if (!pollId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await api<PdfJob>(
          `/pdf-jobs/${pollId}`,
          "GET",
          undefined,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        setJob(result);
        setJobs((current) => [
          result,
          ...current.filter((item) => item.id !== result.id),
        ]);
        if (active(result)) timer = setTimeout(() => void poll(), 1200);
        else setPollId("");
      } catch (e) {
        if (!controller.signal.aborted) {
          setError(
            `PDF-Status konnte nicht geladen werden: ${errorMessage(e)}`,
          );
          setPollId("");
        }
      }
    };
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [pollId]);
  const included = rows.filter((row) => row.included);
  const invalid = included.some((row) => !validPageRange(row.pages ?? ""));
  const running = Boolean(job && active(job));
  const historyBusy = jobs.some(active);
  function move(index: number, direction: number) {
    setRows((current) => {
      const next = [...current];
      const target = index + direction;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  }
  async function compose() {
    if (
      busy ||
      running ||
      historyBusy ||
      !ready ||
      !capable ||
      invalid ||
      !included.length ||
      included.length > 40 ||
      conflict
    )
      return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const items = included.map(({ kind, id, pages }) => ({
        kind,
        id,
        ...(pages?.trim() ? { pages: pages.replace(/\s/g, "") } : {}),
      }));
      if (app) {
        const saved = await api<PdfPlan>(
          `/applications/${app.id}/pdf-plan`,
          "PUT",
          {
            revision,
            items,
            compression,
            excluded: rows
              .filter((row) => !row.included)
              .map((row) => planSourceKey(row, app)),
          },
        );
        setRevision(saved.revision);
      }
      const result = await api<PdfJob>("/pdf-jobs", "POST", {
        ...(app ? { appId: app.id } : {}),
        items,
        compression,
        label: label.trim() || undefined,
      });
      setJob(result);
      setJobs((current) => [
        result,
        ...current.filter((item) => item.id !== result.id),
      ]);
      if (active(result)) setPollId(result.id);
    } catch (e) {
      setError(errorMessage(e));
      if (e instanceof ApiError && e.status === 409 && app) setConflict(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogPopup className="max-w-3xl" showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>PDF zusammenfügen / optimieren</DialogTitle>
          <DialogDescription>
            PDF, JPG und PNG lokal verarbeiten. Originaldateien werden nie
            überschrieben. Digitale Signaturen bleiben nur in den Originalen
            gültig.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <ErrorNotice error={error} onClose={() => setError("")} />
          {!ready && !error && (
            <p role="status" className="text-sm text-muted-foreground">
              Quellen werden geladen…
            </p>
          )}
          {ready && !capable && (
            <p role="status" className="text-sm text-muted-foreground">
              PDF-Verarbeitung ist auf diesem Server nicht verfügbar.
              Zusammenfügen und Optimieren sind deshalb deaktiviert.
            </p>
          )}
          {((!ready && error) || conflict) && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setError("");
                setReload((n) => n + 1);
              }}
            >
              Plan neu laden
            </Button>
          )}
          <Field label="Ergebnisbezeichnung">
            <Input
              aria-label="Ergebnisbezeichnung"
              value={label}
              maxLength={180}
              disabled={busy || running}
              onChange={(e) => setLabel(e.target.value)}
            />
          </Field>
          <ol
            className="divide-y divide-border/50 rounded-lg border border-border/60"
            aria-label="PDF-Reihenfolge"
          >
            {rows.map((row, index) => (
              <li
                key={pdfKey(row)}
                className="space-y-2 p-3"
                data-pdf-source={pdfKey(row)}
              >
                <div className="flex items-center gap-2">
                  <Checkbox
                    aria-label={`${row.label} einschließen`}
                    checked={row.included}
                    disabled={busy || running}
                    onCheckedChange={(included) =>
                      setRows((current) =>
                        current.map((item) =>
                          pdfKey(item) === pdfKey(row)
                            ? { ...item, included }
                            : item,
                        ),
                      )
                    }
                  />
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {index + 1}. {row.label}
                  </span>
                  <IconButton
                    label={`${row.label} nach oben`}
                    disabled={index === 0 || busy || running}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUp />
                  </IconButton>
                  <IconButton
                    label={`${row.label} nach unten`}
                    disabled={index === rows.length - 1 || busy || running}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDown />
                  </IconButton>
                </div>
                {row.mime === "application/pdf" ? (
                  <Input
                    aria-label={`Seiten für ${row.label}`}
                    placeholder="Alle Seiten (z. B. 1-3,5)"
                    value={row.pages ?? ""}
                    disabled={!row.included || busy || running}
                    aria-invalid={
                      row.included && !validPageRange(row.pages ?? "")
                    }
                    onChange={(e) =>
                      setRows((current) =>
                        current.map((item) =>
                          pdfKey(item) === pdfKey(row)
                            ? { ...item, pages: e.target.value }
                            : item,
                        ),
                      )
                    }
                  />
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Bild · eine Seite
                  </p>
                )}
              </li>
            ))}
          </ol>
          {!rows.length && ready && (
            <p className="text-sm text-muted-foreground">
              Keine Quellen verfügbar. Wähle Anlagen aus oder baue ein
              Anschreiben / einen Lebenslauf.
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            {included.length} von maximal 40 Quellen · Reihenfolge von oben nach
            unten. Leeres Seitenfeld = alle Seiten; z. B. 1-3,5. Seiten
            außerhalb des Dokuments werden als Fehler gemeldet.
          </p>
          <Field label="Kompression">
            <Choice
              label="Kompression"
              value={compression}
              disabled={busy || running}
              onChange={(value) => setCompression(value as PdfCompression)}
              options={[
                { value: "lossless", label: "Verlustfrei" },
                { value: "compact", label: "Kompakt (150 dpi)" },
              ]}
            />
          </Field>
          <p className="text-xs text-muted-foreground">
            {compression === "compact"
              ? "Kompakt reduziert Bilder auf 150 dpi und kann die Lesbarkeit beeinträchtigen. Ergebnis vor dem Versand prüfen. "
              : "Verlustfrei erhält die Bildqualität. "}
            Keine Cloud-Verarbeitung; eine bestimmte Zielgröße ist nicht
            garantiert.
          </p>
          {app && (
            <p className="text-xs text-muted-foreground">
              Beim Erstellen wird der Plan gespeichert; der Auftrag verwendet
              feste Quellstände. Beim erneuten Öffnen werden neueste
              erfolgreiche Builds und verfügbare Anlagen ergänzt.
            </p>
          )}
          {invalid && (
            <p role="alert" className="text-sm text-destructive-foreground">
              Ungültiger Seitenbereich. Verwende positive Seitenzahlen, z. B.
              1-3,5.
            </p>
          )}
          {job && (
            <section
              className="space-y-3 rounded-lg border border-border/60 p-3"
              aria-label="PDF-Ergebnis"
            >
              <p role="status" className="text-sm">
                {
                  {
                    queued: "In Warteschlange…",
                    running: "PDF wird verarbeitet…",
                    success: "PDF fertig",
                    failed: "PDF-Verarbeitung fehlgeschlagen",
                  }[job.status]
                }
              </p>
              {job.status === "failed" && (
                <ErrorNotice
                  error={job.error || "PDF konnte nicht erstellt werden."}
                />
              )}
              {job.note && (
                <p className="text-xs text-muted-foreground">{job.note}</p>
              )}
              {running && !pollId && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPollId(job.id)}
                >
                  Status erneut laden
                </Button>
              )}
              {job.status === "success" && (
                <>
                  <p className="text-sm">
                    Vorher: {bytesLabel(job.sourceBytes)} · Nachher:{" "}
                    {bytesLabel(job.bytes ?? 0)} · {job.pages ?? "?"} Seiten im
                    Ergebnis
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      render={
                        <a
                          href={`${base}/pdf-jobs/${job.id}/file?download=1`}
                        />
                      }
                    >
                      <Download />
                      PDF herunterladen
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={
                        busy ||
                        job.bytes === undefined ||
                        job.bytes > 25 * 1024 * 1024
                      }
                      onClick={async () => {
                        setBusy(true);
                        setError("");
                        setNotice("");
                        try {
                          const saved = await api<
                            LibraryDocument & { duplicate?: boolean }
                          >(`/pdf-jobs/${job.id}/save`, "POST", {
                            label: job.label,
                          });
                          setNotice(
                            saved.duplicate
                              ? `Bereits in Eigene Dateien vorhanden: ${saved.label}. Die bestehende Datei bleibt unverändert.`
                              : `In Eigene Dateien gespeichert: ${saved.label}.`,
                          );
                          onSaved?.();
                        } catch (e) {
                          setError(errorMessage(e));
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      In Eigene Dateien speichern
                    </Button>
                  </div>
                  {(job.bytes ?? 0) > 25 * 1024 * 1024 && (
                    <p className="text-xs text-muted-foreground">
                      Größer als 25 MiB: nur Download, kein Speichern in der
                      Bibliothek.
                    </p>
                  )}
                </>
              )}
            </section>
          )}
          {notice && (
            <p role="status" className="text-sm">
              {notice}
            </p>
          )}
          {historyBusy && !running && (
            <p role="status" className="text-xs text-muted-foreground">
              Ein PDF-Auftrag läuft bereits. Öffne „Bisherige PDF-Aufträge“, um
              seinen Status zu verfolgen.
            </p>
          )}
          {jobs.length > 0 && (
            <details>
              <summary className="cursor-pointer text-sm">
                Bisherige PDF-Aufträge
              </summary>
              <ul className="mt-2 space-y-2">
                {jobs.map((entry) => (
                  <li
                    key={entry.id}
                    className="flex flex-wrap items-center justify-between gap-2 text-xs"
                  >
                    <span>
                      {entry.label} ·{" "}
                      {new Date(entry.created).toLocaleString("de-DE")} ·{" "}
                      {
                        {
                          queued: "Warteschlange",
                          running: "In Bearbeitung",
                          success: "Fertig",
                          failed: "Fehlgeschlagen",
                        }[entry.status]
                      }
                    </span>
                    {entry.status !== "failed" ? (
                      <Button
                        size="xs"
                        variant="ghost"
                        disabled={running || busy}
                        onClick={() => {
                          setJob(entry);
                          setNotice("");
                          if (active(entry)) setPollId(entry.id);
                        }}
                      >
                        {active(entry) ? "Status verfolgen" : "Ergebnis"}
                      </Button>
                    ) : (
                      <span>{entry.error}</span>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </DialogPanel>
        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Schließen
          </Button>
          <Button
            disabled={
              !ready ||
              !capable ||
              busy ||
              running ||
              historyBusy ||
              conflict ||
              !included.length ||
              included.length > 40 ||
              invalid
            }
            onClick={() => void compose()}
          >
            {busy ? "Speichern…" : "PDF erstellen"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
