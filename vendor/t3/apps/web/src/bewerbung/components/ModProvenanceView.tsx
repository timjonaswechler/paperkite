import { useEffect, useState } from "react";
import { Button } from "~/components/ui/button";
import { api, base, errorMessage } from "../api";
import type { CvModJob, ModProvenance } from "../shared/api";
import { Choice, ErrorNotice } from "./Controls";

const statusNames = {
  added: "Hinzugefügt",
  changed: "Geändert",
  removed: "Entfernt",
  unchanged: "Unverändert",
};
export function ModProvenanceView({ job }: { job: CvModJob }) {
  const [open, setOpen] = useState(false);
  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="cursor-pointer text-xs text-muted-foreground">
        Original und Mod-Änderungen
      </summary>
      {open && <ProvenanceBody key={job.versionId || job.updated} job={job} />}
    </details>
  );
}
function ProvenanceBody({ job }: { job: CvModJob }) {
  const [report, setReport] = useState<ModProvenance | null>(null);
  const [selected, setSelected] = useState("");
  const [difference, setDifference] = useState<{
    binary: boolean;
    diff: string;
    truncated: boolean;
  } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reads immutable version provenance and current working-copy integrity when the user opens the inspector
  useEffect(() => {
    const controller = new AbortController();
    void api<ModProvenance>(
      `/cv-mods/jobs/${job.id}/provenance${job.versionId ? "?version=" + encodeURIComponent(job.versionId) : ""}`,
      "GET",
      undefined,
      controller.signal,
    )
      .then(setReport)
      .catch((e) => {
        if (!controller.signal.aborted) setError(errorMessage(e));
      });
    return () => controller.abort();
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- external job revision invalidates working-copy integrity without changing its pinned version
  }, [job.id, job.versionId, job.updated]);
  async function compare() {
    if (!selected || busy || !report) return;
    setBusy(true);
    setError("");
    setDifference(null);
    try {
      setDifference(
        await api(
          `/cv-mods/jobs/${job.id}/diff?path=${encodeURIComponent(selected)}${report.versionId ? "&version=" + encodeURIComponent(report.versionId) : ""}`,
        ),
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mt-3 min-w-0 space-y-3">
      <ErrorNotice error={error} />
      <Button
        size="sm"
        variant="outline"
        render={<a href={`${base}/cv-mods/jobs/${job.id}/original`} />}
      >
        Original herunterladen
      </Button>
      {report ? (
        <>
          <p className="break-all text-xs text-muted-foreground">
            {report.versionId
              ? `Geprüfter Stand: ${report.versionId}`
              : "Ungeprüfter Arbeitsstand – keine freigegebene Mod-Version."}
          </p>
          <p className="break-all text-xs text-muted-foreground">
            Original SHA-256: {report.sourceHash}
          </p>
          <p className="break-all text-xs text-muted-foreground">Mod SHA-256: {report.modDigest}</p>
          {!report.workingSourceIntact && (
            <ErrorNotice error="Die Arbeitsquellen weichen vom geschützten Original ab. Keine neue Version übernehmen; das Original bleibt separat abrufbar." />
          )}
          <p className="text-xs text-muted-foreground">
            Dateiidentität und Datenprüfungen sind keine automatische Layoutgarantie. Gestaltung,
            Schrift, Umbrüche und Datenzuordnung vor Verwendung durchsehen.
          </p>
          {report.notes ? (
            <pre className="max-h-52 overflow-auto whitespace-pre-wrap break-words text-xs">
              {report.notes}
            </pre>
          ) : (
            <p className="text-xs text-muted-foreground">
              Keine Änderungsbegründung des Agenten vorhanden. Unterschiede deshalb besonders
              prüfen.
            </p>
          )}
          <ul className="space-y-1 text-xs">
            {report.files.map((file) => (
              <li key={file.path} className="min-w-0 break-all">
                {statusNames[file.status]} · {file.path}
              </li>
            ))}
          </ul>
          <div className="flex min-w-0 flex-wrap items-end gap-2">
            <div className="min-w-0 flex-1">
              <Choice
                label="Datei für Modvergleich"
                value={selected}
                onChange={(value) => {
                  setSelected(value);
                  setDifference(null);
                }}
                options={[
                  { value: "", label: "Datei auswählen" },
                  ...report.files.map((file) => ({ value: file.path, label: file.path })),
                ]}
              />
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={!selected || busy}
              onClick={() => void compare()}
            >
              Unterschied anzeigen
            </Button>
          </div>
          {selected && (
            <div className="space-y-1 break-all text-xs text-muted-foreground">
              <p>
                Datei im Original:{" "}
                {report.files.find((file) => file.path === selected)?.originalSha256 ||
                  "Nicht vorhanden"}
              </p>
              <p>
                Datei im Mod:{" "}
                {report.files.find((file) => file.path === selected)?.modSha256 ||
                  "Nicht vorhanden"}
              </p>
            </div>
          )}
          {selected && report.files.find((file) => file.path === selected)?.originalSha256 && (
            <Button
              size="xs"
              variant="ghost"
              render={
                <a
                  href={`${base}/cv-mods/jobs/${job.id}/source?path=${encodeURIComponent(selected)}`}
                />
              }
            >
              Originaldatei herunterladen
            </Button>
          )}
          {difference &&
            (difference.binary ? (
              <p className="text-xs text-muted-foreground">
                Binärdatei: Der Datei-Hash zeigt, ob die Datei identisch ist.
              </p>
            ) : (
              <>
                <pre
                  aria-label="Original-Mod-Dateiunterschied"
                  className="max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs"
                >
                  {difference.diff || "Keine Textänderung."}
                </pre>
                {difference.truncated && (
                  <p className="text-xs text-muted-foreground">
                    Diff gekürzt. Vollständige Dateien separat prüfen.
                  </p>
                )}
              </>
            ))}
        </>
      ) : (
        !error && <p className="text-xs text-muted-foreground">Originalvergleich wird geladen…</p>
      )}
    </div>
  );
}
