import { useEffect, useRef, useState } from "react";
import type { LayoutLibrary, LayoutVersion, CvModJob } from "../shared/api";
import { api, errorMessage } from "../api";
import { useApplications } from "../ApplicationsProvider";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Badge } from "~/components/ui/badge";
import { Choice, ErrorNotice, Field } from "./Controls";
import { CvModImportPanel } from "./CvModImportPanel";

export function useLayoutLibrary() {
  const [data, setData] = useState<LayoutLibrary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reads the durable library on mount or explicit refresh without changing document drafts
  useEffect(() => {
    const controller = new AbortController();
    void api<LayoutLibrary>("/cv-mods/library", "GET", undefined, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setData(value);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(errorMessage(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- explicit invalidation token re-reads the external library after a user action
  }, [refresh]);
  return {
    data,
    loading,
    error,
    reload: () => {
      setLoading(true);
      setError("");
      setRefresh((value) => value + 1);
    },
  };
}
const layoutLabel = (layout: LayoutVersion) =>
  `${layout.label} · Stand ${layout.versionId.split(".").at(-1)!.slice(0, 8)}`;
export function layoutOptions(
  data: LayoutLibrary | null,
  kind: "cv" | "cover",
  selected?: string | null,
): { value: string; label: string; disabled?: boolean }[] {
  const choices = (data?.layouts || [])
    .filter((layout) => layout.kind === kind)
    .map((layout) => ({
      value: layout.versionId,
      label: layoutLabel(layout) + (layout.available ? "" : " · nicht verfügbar"),
      disabled: !layout.available,
    }));
  if (selected && !choices.some((choice) => choice.value === selected))
    choices.push({
      value: selected,
      label: "Gesicherter Stand · " + selected.split(".").at(-1)!.slice(0, 8),
      disabled: true,
    });
  return choices;
}
export function LayoutLibraryPanel({ onDocumentsChanged }: { onDocumentsChanged?: () => void }) {
  const app = useApplications();
  const { data, loading, error, reload } = useLayoutLibrary();
  const [busy, setBusy] = useState(false);
  const [mutationError, setMutationError] = useState("");
  const previous = useRef("");
  const groups = new Map<string, LayoutVersion[]>();
  for (const layout of data?.layouts || [])
    groups.set(layout.importId, [...(groups.get(layout.importId) || []), layout]);
  function jobsChanged(jobs: CvModJob[]) {
    const current = jobs
      .map((job) => [job.id, job.approvedVersionId, job.label].join(":"))
      .join("|");
    if (current !== previous.current) {
      previous.current = current;
      reload();
    }
  }
  async function setDefault(kind: "cv" | "cover", id: string) {
    if (busy) return;
    setBusy(true);
    setMutationError("");
    try {
      await app.saveSettings(
        kind === "cv" ? { defaultCvModId: id || null } : { defaultCoverModId: id || null },
      );
      reload();
    } catch (e) {
      setMutationError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="Vorlagenbibliothek" className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-medium">Vorlagenbibliothek</h2>
        <Button
          size="sm"
          variant="outline"
          disabled={busy || loading}
          onClick={() => {
            reload();
            void app.refreshAll();
          }}
        >
          Vorlagen neu laden
        </Button>
      </div>
      <ErrorNotice error={error || mutationError} />
      <p className="text-xs text-muted-foreground">
        Standards gelten nur für neue Bewerbungen. Bestehende Bewerbungen behalten ihre gewählte
        Version; Auswahl und Layoutwechsel erstellen keinen neuen Mod und keinen KI-Text.
      </p>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        {(["cv", "cover"] as const).map((kind) => (
          <Field key={kind} label={kind === "cv" ? "Standard-Lebenslauf" : "Standard-Anschreiben"}>
            <Choice
              label={kind === "cv" ? "Standard-Lebenslauf" : "Standard-Anschreiben"}
              value={data?.defaults[kind] || ""}
              disabled={loading || busy || !data}
              onChange={(value) => void setDefault(kind, value)}
              options={[
                { value: "", label: "Keine importierte Standardvorlage" },
                ...layoutOptions(data, kind, data?.defaults[kind]),
              ]}
            />
          </Field>
        ))}
      </div>
      {!loading && data?.layouts.length === 0 && (
        <p role="status" className="text-sm text-muted-foreground">
          Noch keine freigegebenen Layouts. Eine Vorlage unten importieren und nach der Durchsicht
          freigeben. Neue Bewerbungen sind auch ohne importiertes Layout möglich.
        </p>
      )}
      <ul className="grid min-w-0 gap-3 sm:grid-cols-2">
        {[...groups.entries()].map(([id, layouts]) => (
          <LayoutCard key={id} layouts={layouts} defaults={data!.defaults} onChanged={reload} />
        ))}
      </ul>
      <details>
        <summary className="cursor-pointer text-sm font-medium">
          Layout importieren & laufende Imports
        </summary>
        <div className="mt-4">
          <CvModImportPanel
            templateType="all"
            onJobs={jobsChanged}
            {...(onDocumentsChanged ? { onDocumentsChanged } : {})}
          />
        </div>
      </details>
    </section>
  );
}
function LayoutCard({
  layouts,
  defaults,
  onChanged,
}: {
  layouts: LayoutVersion[];
  defaults: LayoutLibrary["defaults"];
  onChanged: () => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ value: string; updated: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const layout =
    layouts.find((item) => item.versionId === selected) ||
    layouts.find((item) => item.versionId === defaults[item.kind]) ||
    layouts[0]!;
  async function rename() {
    if (!draft || busy) return;
    setBusy(true);
    setError("");
    try {
      await api(`/cv-mods/jobs/${layout.importId}/label`, "POST", {
        label: draft.value,
        updated: draft.updated,
      });
      setDraft(null);
      onChanged();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <li className="min-w-0 space-y-3 rounded-lg border p-3" data-layout-id={layout.importId}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="min-w-0 break-words text-sm font-medium">{layout.label}</h3>
        <Badge variant="outline">{layout.kind === "cv" ? "Lebenslauf" : "Anschreiben"}</Badge>
      </div>
      <Field label="Layoutname">
        <Input
          aria-label={`Layoutname ${layout.label}`}
          value={draft?.value ?? layout.label}
          maxLength={120}
          disabled={busy}
          onChange={(event) =>
            setDraft({ value: event.target.value, updated: draft?.updated ?? layout.updated })
          }
        />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={!draft || busy || !draft.value.trim()}
          onClick={() => void rename()}
        >
          Name speichern
        </Button>
        {draft && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setDraft(null)}>
            Zurücksetzen
          </Button>
        )}
      </div>
      <Choice
        label={`Freigegebener Stand für ${layout.label}`}
        value={layout.versionId}
        onChange={setSelected}
        options={layouts.map((item) => ({
          value: item.versionId,
          label: layoutLabel(item) + (item.available ? "" : " · nicht verfügbar"),
        }))}
      />
      <p className="break-all text-xs text-muted-foreground">{layout.versionId}</p>
      {defaults[layout.kind] === layout.versionId && (
        <p className="text-xs">
          Standard für neue {layout.kind === "cv" ? "Lebensläufe" : "Anschreiben"}
        </p>
      )}
      {layout.signature === "required" && (
        <p className="text-xs text-muted-foreground">
          Benötigt deine gespeicherte Unterschrift beim PDF-Bau.
        </p>
      )}
      {layout.signature === null && (
        <p className="text-xs text-muted-foreground">
          Ältere Datenanbindung ohne zentrale Profildeklaration.
        </p>
      )}
      <ErrorNotice error={error || layout.error || ""} />
    </li>
  );
}
