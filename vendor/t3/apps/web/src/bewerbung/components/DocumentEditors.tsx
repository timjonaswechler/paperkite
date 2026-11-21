import { useEffect, useState } from "react";
import { Download, FileCode, Save, Trash2 } from "lucide-react";
import type { ApplicationDetail, Build, CoverLetter } from "../shared/api";
import { api, base, errorMessage, textFile } from "../api";
import { registerNavigationGuard } from "../navigation";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { Checkbox } from "~/components/ui/checkbox";
import { Badge } from "~/components/ui/badge";
import { ErrorNotice, Field } from "./Controls";
import { BrowserDocumentFrame } from "~/components/files/BrowserDocumentFrame";

export function useDocumentDraftGuard(dirty: boolean) {
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- protects an unsaved document when navigating to another application or work area
  useEffect(
    () =>
      registerNavigationGuard(
        () => !dirty || confirm("Ungespeicherte Dokumentänderungen verwerfen?"),
      ),
    [dirty],
  );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- protects document input before a browser reload
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty) event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
}

type EditorProps = {
  app: ApplicationDetail;
  autoBuild: boolean;
  onRefresh: () => Promise<void>;
  onAdvanced: () => void;
};

export function CoverLetterEditor({ app, autoBuild, onRefresh, onAdvanced }: EditorProps) {
  const [fields, setFields] = useState<CoverLetter | null>(null);
  const [revision, setRevision] = useState(app.revision);
  const [conversion, setConversion] = useState(false);
  const [replace, setReplace] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useDocumentDraftGuard(dirty);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- loads the current letter and its revision from the business API
  useEffect(() => {
    const controller = new AbortController();
    void api<{ fields: CoverLetter; revision: number; requiresConversion: boolean }>(
      `/applications/${app.id}/cover-letter`,
      "GET",
      undefined,
      controller.signal,
    )
      .then((result) => {
        setFields(result.fields);
        setRevision(result.revision);
        setConversion(result.requiresConversion);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(errorMessage(error));
      });
    return () => controller.abort();
  }, [app.id]);
  async function save(build: boolean) {
    if (!fields || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (dirty) {
        const saved = await api<{ revision: number }>(
          `/applications/${app.id}/cover-letter`,
          "PUT",
          { revision, fields, replaceExisting: replace },
        );
        setRevision(saved.revision);
        setDirty(false);
        setConversion(false);
        setReplace(false);
      }
      if (build || (autoBuild && dirty))
        await api(`/applications/${app.id}/builds`, "POST", { kind: "cover" });
      await onRefresh();
      setNotice(build ? "Gespeichert. PDF-Build gestartet." : "Anschreiben gespeichert.");
    } catch (error) {
      setError(errorMessage(error));
    }
    setBusy(false);
  }
  const editable = fields && (!conversion || replace);
  const names: { key: keyof CoverLetter; label: string; rows: number }[] = [
    { key: "sender", label: "Absender", rows: 3 },
    { key: "recipient", label: "Empfänger", rows: 3 },
    { key: "subject", label: "Betreff", rows: 1 },
    { key: "salutation", label: "Anrede", rows: 1 },
    { key: "body", label: "Anschreibentext", rows: 14 },
    { key: "closing", label: "Grußformel", rows: 1 },
  ];
  return (
    <div className="grid min-w-0 gap-6 xl:grid-cols-2">
      <section className="min-w-0 space-y-4">
        <div>
          <h2 className="text-lg font-medium">Anschreiben verfassen</h2>
          <p className="text-sm text-muted-foreground">
            Text bearbeiten, speichern und als PDF bauen. KI-Unterstützung ist optional im Bereich
            Chats verfügbar.
          </p>
        </div>
        <ErrorNotice error={error} onClose={() => setError("")} />
        {conversion && (
          <div className="space-y-3 rounded-lg border p-4 text-sm">
            <p>
              Diese Bewerbung enthält eine individuelle TeX-Vorlage. Sie bleibt unverändert, solange
              du sie nicht ausdrücklich ersetzt. Du kannst sie weiterhin in den erweiterten Quellen
              bearbeiten.
            </p>
            <label className="flex items-start gap-2">
              <Checkbox
                aria-label="Individuelle Vorlage durch Texteditor ersetzen"
                checked={replace}
                onCheckedChange={(value) => setReplace(value)}
              />
              <span>
                Stattdessen einen neuen Entwurf im Texteditor beginnen und die vorhandene Vorlage
                beim Speichern ersetzen.
              </span>
            </label>
          </div>
        )}
        {fields &&
          names.map(({ key, label, rows }) => (
            <Field key={key} label={label}>
              {rows === 1 ? (
                <Input
                  aria-label={label}
                  value={fields[key]}
                  disabled={!editable || busy || app.harness.busy}
                  maxLength={2000}
                  onChange={(event) => {
                    setFields({ ...fields, [key]: event.target.value });
                    setDirty(true);
                  }}
                />
              ) : (
                <Textarea
                  aria-label={label}
                  rows={rows}
                  value={fields[key]}
                  disabled={!editable || busy || app.harness.busy}
                  maxLength={key === "body" ? 40000 : 2000}
                  onChange={(event) => {
                    setFields({ ...fields, [key]: event.target.value });
                    setDirty(true);
                  }}
                />
              )}
            </Field>
          ))}
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={!dirty || !editable || busy || app.harness.busy}
            onClick={() => void save(false)}
          >
            <Save />
            Speichern{dirty ? " *" : ""}
          </Button>
          <Button
            variant="outline"
            disabled={!fields || busy || app.harness.busy || (dirty && !editable)}
            onClick={() => void save(true)}
          >
            {dirty ? "Speichern & PDF bauen" : "PDF bauen"}
          </Button>
          <Button variant="ghost" onClick={onAdvanced}>
            <FileCode />
            Erweiterte Quellen
          </Button>
        </div>
        <p role="status" className="text-sm text-muted-foreground">
          {notice}
        </p>
      </section>
      <DocumentPreview app={app} kind="cover" dirty={dirty} onRefresh={onRefresh} />
    </div>
  );
}

export function DocumentPreview({
  app,
  kind,
  dirty,
  onRefresh,
}: {
  app: ApplicationDetail;
  kind: "cv" | "cover";
  dirty: boolean;
  onRefresh: () => Promise<void>;
}) {
  const latest = app.builds.find((build) => build.kind === kind && build.status === "success");
  const running = app.builds.some(
    (build) => build.kind === kind && ["queued", "running"].includes(build.status),
  );
  const [log, setLog] = useState("");
  const [error, setError] = useState("");
  const [deletingBuild, setDeletingBuild] = useState("");
  const [deleteNotice, setDeleteNotice] = useState("");
  const state = app.documentStatus?.[kind] ?? (latest ? "outdated" : "missing");
  const status = dirty
    ? "Ungespeicherte Änderungen"
    : running
      ? "PDF wird gebaut…"
      : state === "current"
        ? "Aktueller Quellenstand"
        : state === "outdated"
          ? "Quellen seit PDF-Erstellung geändert"
          : "Noch kein PDF gebaut";
  async function finalize(build: Build) {
    try {
      await api(`/applications/${app.id}/builds/${build.id}/finalize`, "POST", {});
      await onRefresh();
    } catch (error) {
      setError(errorMessage(error));
    }
  }
  async function remove(build: Build) {
    if (
      deletingBuild ||
      !confirm(
        "Diesen Build samt PDF, Eingaben und Log endgültig löschen? Andere Versionen bleiben erhalten.",
      )
    )
      return;
    setDeletingBuild(build.id);
    setError("");
    setDeleteNotice("");
    try {
      const result = await api<{ ok: boolean; cleanupPending: boolean }>(
        `/applications/${app.id}/builds/${build.id}`,
        "DELETE",
      );
      setLog("");
      await onRefresh();
      setDeleteNotice(
        result.cleanupPending
          ? "Build entfernt. Die Dateibereinigung wird beim nächsten Serverstart erneut versucht."
          : "Build gelöscht.",
      );
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setDeletingBuild("");
    }
  }
  return (
    <section className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-medium">PDF-Vorschau</h2>
        <Badge variant="outline">{status}</Badge>
      </div>
      <ErrorNotice error={error} onClose={() => setError("")} />
      {deleteNotice && (
        <p role="status" className="text-xs text-muted-foreground">
          {deleteNotice}
        </p>
      )}
      {latest ? (
        <>
          <div className="flex h-[65vh] min-h-80 overflow-hidden rounded-lg border">
            <BrowserDocumentFrame
              pdf
              title={kind === "cv" ? "Lebenslauf PDF-Vorschau" : "Anschreiben PDF-Vorschau"}
              src={`${base}/applications/${app.id}/builds/${latest.id}/pdf`}
              documentId={`${app.id}:${kind}`}
              documentKey={latest.id}
            />
          </div>
          <Button
            size="sm"
            variant="outline"
            render={
              <a href={`${base}/applications/${app.id}/builds/${latest.id}/pdf?download=1`} />
            }
          >
            <Download />
            PDF-Entwurf herunterladen
          </Button>
        </>
      ) : (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          Nach dem Bauen erscheint hier die Vorschau. Ein früheres erfolgreiches PDF bleibt bei
          Buildfehlern erhalten.
        </p>
      )}
      <details className="rounded-lg border p-3">
        <summary className="cursor-pointer text-sm">Buildverlauf und Logs</summary>
        <ul className="mt-3 space-y-3">
          {app.builds
            .filter((build) => build.kind === kind)
            .map((build) => (
              <li key={build.id} data-build-id={build.id} className="space-y-2 text-sm">
                <p>
                  {new Date(build.created).toLocaleString("de-DE")} · {build.status} · r
                  {build.revision}
                  {build.finalized ? " · festgehalten" : ""}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      void textFile(`/applications/${app.id}/builds/${build.id}/log`)
                        .then(setLog)
                        .catch((error) => setError(errorMessage(error)));
                    }}
                  >
                    Log anzeigen
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={
                      Boolean(deletingBuild) ||
                      Boolean(build.deletionBlocked) ||
                      Boolean(build.finalized) ||
                      ["queued", "running"].includes(build.status)
                    }
                    aria-label="Build löschen"
                    onClick={() => void remove(build)}
                  >
                    <Trash2 />
                    Löschen
                  </Button>
                  {build.status === "success" && (
                    <>
                      <Button
                        size="sm"
                        variant="ghost"
                        render={
                          <a
                            href={`${base}/applications/${app.id}/builds/${build.id}/pdf?download=1`}
                          />
                        }
                      >
                        PDF
                      </Button>
                      {!build.finalized && (
                        <Button size="sm" variant="ghost" onClick={() => void finalize(build)}>
                          Festhalten
                        </Button>
                      )}
                    </>
                  )}
                </div>
                {build.deletionBlocked && (
                  <p className="text-xs text-muted-foreground">
                    Geschützt: {build.deletionBlocked}
                  </p>
                )}
              </li>
            ))}
        </ul>
      </details>
      {log && (
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded border p-3 text-xs">
          {log}
        </pre>
      )}
    </section>
  );
}
