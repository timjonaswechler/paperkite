import { useState } from "react";
import { Download, Eye, FileText, X } from "lucide-react";
import type { ApplicationDetail, LibraryDocument } from "../../shared/api";
import { api, base, errorMessage, textFile } from "../api";
import {
  Sheet,
  SheetPopup,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "./ui/sheet";
import { Button } from "./ui/button";
import { ErrorNotice, IconButton } from "./Controls";
import { DocumentPreview, formatBytes } from "./DocumentLibrary";
import { PdfCompositionDialog } from "./PdfCompositionDialog";

export function DocumentsPanel({
  app,
  open,
  onClose,
  onRefresh,
  onEdit,
}: {
  app: ApplicationDetail;
  open: boolean;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onEdit: () => void;
}) {
  const [pdf, setPdf] = useState("");
  const [composing, setComposing] = useState(false);
  const [log, setLog] = useState<{ title: string; text: string } | null>(null);
  const [document, setDocument] = useState<LibraryDocument | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const chosen =
    pdf ||
    app.builds.find(
      (build) => build.kind === "cv" && build.status === "success",
    )?.id ||
    app.builds.find((build) => build.status === "success")?.id;
  const buildBusy = app.builds.some(
    (b) => b.status === "queued" || b.status === "running",
  );
  function closePanel() {
    setComposing(false);
    onClose();
  }
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet
      open={open}
      onOpenChange={(value) => {
        if (!value) closePanel();
      }}
    >
      <SheetPopup
        side="right"
        className="w-[min(56rem,100vw)] max-w-none"
        showCloseButton={false}
      >
        <SheetHeader>
          <div className="flex items-center justify-between gap-3">
            <SheetTitle>Unterlagen</SheetTitle>
            <IconButton label="Unterlagen schließen" onClick={closePanel}>
              <X />
            </IconButton>
          </div>
          <SheetDescription>
            {app.company} · {app.role}
          </SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 pb-6">
          <ErrorNotice error={error} onClose={() => setError("")} />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              disabled={busy || app.harness.busy || buildBusy}
              onClick={() =>
                void action(async () => {
                  await api(`/applications/${app.id}/builds`, "POST", {
                    kind: "cv",
                  });
                  setPdf("");
                  await onRefresh();
                })
              }
            >
              Lebenslauf bauen
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || app.harness.busy || buildBusy}
              onClick={() =>
                void action(async () => {
                  await api(`/applications/${app.id}/builds`, "POST", {
                    kind: "cover",
                  });
                  setPdf("");
                  await onRefresh();
                })
              }
            >
              Anschreiben bauen
            </Button>
            <Button
              variant="outline"
              size="sm"
              render={<a href={`${base}/applications/${app.id}/package`} />}
            >
              <Download />
              Dokumentpaket
            </Button>
          </div>
          <div className="space-y-2">
            <Button
              size="sm"
              variant="outline"
              disabled={busy || app.harness.busy || buildBusy}
              onClick={() => setComposing(true)}
            >
              PDF zusammenfügen / optimieren
            </Button>
            <p className="text-xs text-muted-foreground">
              Neueste erfolgreiche Anschreiben- und Lebenslauf-Builds mit den
              ausgewählten Anlagen zu einem PDF verbinden.
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            Versandpaket: nur die neuesten erfolgreichen Lebenslauf- und
            Anschreiben-PDFs sowie die aktuell ausgewählten Anlagen.
          </p>
          <div className="min-h-64 h-[42dvh] shrink-0 overflow-hidden rounded-lg border border-border/60 bg-muted/30">
            {chosen ? (
              <object
                type="application/pdf"
                aria-label="PDF-Vorschau"
                className="h-full w-full"
                data={`${base}/applications/${app.id}/builds/${chosen}/pdf`}
              >
                <a
                  href={`${base}/applications/${app.id}/builds/${chosen}/pdf`}
                  target="_blank"
                  rel="noreferrer"
                >
                  PDF öffnen
                </a>
              </object>
            ) : (
              <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
                Noch kein erfolgreiches PDF. Baue einen Entwurf aus den
                gespeicherten Quellen; fehlende Quellen erscheinen im Build-Log.
              </div>
            )}
          </div>
          <section className="space-y-2">
            <h2 className="text-sm font-medium">Build-Verlauf</h2>
            <p className="text-xs text-muted-foreground">
              Buildquellen enthalten den unveränderlichen Quellstand, die
              damaligen Anlagen und private Bewerbungsdaten – nicht zum Versand.
            </p>
            <div className="divide-y divide-border/50 rounded-lg border border-border/60">
              {app.builds.map((build) => (
                <article key={build.id} className="space-y-1.5 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <strong className="text-sm font-medium">
                      {build.kind === "cv" ? "Lebenslauf" : "Anschreiben"} · r
                      {build.revision}
                    </strong>
                    <span className="text-xs text-muted-foreground">
                      {
                        {
                          success: "Erfolgreich",
                          failed: "Fehlgeschlagen",
                          running: "Wird gebaut",
                          queued: "In Warteschlange",
                        }[build.status]
                      }
                      {build.finalized ? " · festgehalten" : ""}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {new Date(build.created).toLocaleString("de-DE")}
                  </p>
                  <div className="flex flex-wrap items-center gap-1">
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() =>
                        void action(async () =>
                          setLog({
                            title: `${build.kind === "cv" ? "Lebenslauf" : "Anschreiben"} · r${build.revision}`,
                            text: await textFile(
                              `/applications/${app.id}/builds/${build.id}/log`,
                            ),
                          }),
                        )
                      }
                    >
                      Log
                    </Button>
                    {build.status === "success" && (
                      <>
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() => setPdf(build.id)}
                        >
                          <Eye />
                          Vorschau
                        </Button>
                        <Button
                          size="xs"
                          variant="ghost"
                          render={
                            <a
                              href={`${base}/applications/${app.id}/builds/${build.id}/pdf?download=1`}
                            />
                          }
                        >
                          PDF
                        </Button>
                        <Button
                          size="xs"
                          variant="ghost"
                          render={
                            <a
                              href={`${base}/applications/${app.id}/builds/${build.id}/zip`}
                            />
                          }
                        >
                          Buildquellen (ZIP)
                        </Button>
                        {!build.finalized && (
                          <Button
                            size="xs"
                            variant="outline"
                            disabled={busy}
                            onClick={() =>
                              void action(async () => {
                                await api(
                                  `/applications/${app.id}/builds/${build.id}/finalize`,
                                  "POST",
                                  {},
                                );
                                await onRefresh();
                              })
                            }
                          >
                            Festhalten
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </article>
              ))}
              {!app.builds.length && (
                <p className="p-3 text-xs text-muted-foreground">
                  Noch keine Builds.
                </p>
              )}
            </div>
          </section>
          {log && (
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-medium">Build-Log · {log.title}</h2>
                <IconButton
                  label="Build-Log schließen"
                  onClick={() => setLog(null)}
                >
                  <X />
                </IconButton>
              </div>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted/50 p-3 font-mono text-xs">
                {log.text}
              </pre>
            </section>
          )}
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium">
                Ausgewählte Zeugnisse und Anlagen
              </h2>
              <Button variant="ghost" size="xs" onClick={onEdit}>
                Auswahl ändern
              </Button>
            </div>
            <ul className="divide-y divide-border/50">
              {app.documents.map((doc) => (
                <li key={doc.id} className="flex items-center gap-2 py-2">
                  <FileText className="size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{doc.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatBytes(doc.bytes)}
                    </p>
                  </div>
                  <IconButton
                    label={`${doc.label} ansehen`}
                    onClick={() => setDocument(doc)}
                  >
                    <Eye />
                  </IconButton>
                  <IconButton
                    label={`${doc.label} herunterladen`}
                    render={
                      <a href={`${base}/documents/${doc.id}/file?download=1`} />
                    }
                  >
                    <Download />
                  </IconButton>
                </li>
              ))}
            </ul>
            {!app.documents.length && (
              <p className="text-xs text-muted-foreground">
                Keine Anlagen ausgewählt.
              </p>
            )}
          </section>
        </div>
        {open && composing && (
          <PdfCompositionDialog
            app={app}
            documents={app.documents}
            onClose={() => setComposing(false)}
          />
        )}
        <DocumentPreview
          document={document}
          onClose={() => setDocument(null)}
        />
      </SheetPopup>
    </Sheet>
  );
}
