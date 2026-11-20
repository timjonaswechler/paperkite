import { useEffect, useState } from "react";
import { randomUUID } from "~/lib/utils";
import { ArrowDown, ArrowUp, Download, Files, Plus, Save, Trash2 } from "lucide-react";
import type {
  ApplicationDetail,
  DeliveryJob,
  DeliveryOutput,
  DeliveryPlan,
  PdfInput,
  Settings,
} from "../shared/api";
import { api, base, errorMessage } from "../api";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Checkbox } from "~/components/ui/checkbox";
import { Badge } from "~/components/ui/badge";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogPanel,
  DialogFooter,
} from "~/components/ui/dialog";
import { Choice, ErrorNotice, Field, IconButton } from "./Controls";
import { DocumentLibrary } from "./DocumentLibrary";
import { useDocumentDraftGuard } from "./DocumentEditors";

const keyOf = (item: PdfInput) => item.kind + ":" + item.id;
function filename(label: string, settings: Settings | null, app: ApplicationDetail) {
  const part = (value: string) =>
    value
      .normalize("NFKD")
      .replace(/ß/g, "ss")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 45);
  return ([label, settings?.applicantName ?? "", app.company, app.role].map(part).filter(Boolean).join("_").slice(0, 175) || "Bewerbung") + ".pdf";
}
export function DeliveryPanel({
  app,
  settings,
  updateToken,
  onRefresh,
}: {
  app: ApplicationDetail;
  settings: Settings | null;
  updateToken: number;
  onRefresh: () => Promise<void>;
}) {
  const [plan, setPlan] = useState<DeliveryPlan | null>(null);
  const [jobs, setJobs] = useState<DeliveryJob[]>([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [selectionRevision, setSelectionRevision] = useState(app.revision);
  const [selectionBusy, setSelectionBusy] = useState(false);
  useDocumentDraftGuard(dirty);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- loads the persisted output plan once without replacing edits on build notifications
  useEffect(() => {
    const controller = new AbortController();
    void api<DeliveryPlan>(
      `/applications/${app.id}/delivery-plan`,
      "GET",
      undefined,
      controller.signal,
    )
      .then(setPlan)
      .catch((error) => {
        if (!controller.signal.aborted) setError(errorMessage(error));
      });
    return () => controller.abort();
  }, [app.id]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- refreshes durable delivery jobs after business completion/reconnect events
  useEffect(() => {
    void updateToken;
    const controller = new AbortController();
    void api<DeliveryJob[]>(
      `/applications/${app.id}/deliveries`,
      "GET",
      undefined,
      controller.signal,
    )
      .then(setJobs)
      .catch((error) => {
        if (!controller.signal.aborted) setError(errorMessage(error));
      });
    return () => controller.abort();
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- completion events invalidate the external job list even when its URL is unchanged
  }, [app.id, updateToken]);
  const sources: { item: PdfInput; label: string; mime: string; stale: boolean }[] = [];
  for (const kind of ["cover", "cv"] as const) {
    const current = app.builds.find((build) => build.kind === kind && build.status === "success");
    if (current)
      sources.push({
        item: { kind: "build", id: current.id },
        label: kind === "cv" ? "Lebenslauf" : "Anschreiben",
        mime: "application/pdf",
        stale: app.documentStatus?.[kind] === "outdated",
      });
  }
  for (const document of app.documents)
    sources.push({
      item: { kind: "document", id: document.id },
      label: document.label,
      mime: document.mime,
      stale: false,
    });
  for (const item of plan?.outputs.flatMap((output) => output.items) ?? []) {
    if (sources.some((source) => keyOf(source.item) === keyOf(item))) continue;
    const oldBuild = app.builds.find((build) => build.id === item.id);
    sources.push({
      item,
      label: oldBuild
        ? `${oldBuild.kind === "cv" ? "Lebenslauf" : "Anschreiben"} · älterer Stand r${oldBuild.revision}`
        : "Nicht mehr ausgewählte Unterlage – Auswahl prüfen",
      mime: "application/pdf",
      stale: true,
    });
  }
  function editOutput(id: string, patch: Partial<DeliveryOutput>) {
    if (!plan) return;
    setPlan({
      ...plan,
      outputs: plan.outputs.map((output) => (output.id === id ? { ...output, ...patch } : output)),
    });
    setDirty(true);
  }
  function changeFormat(format: string) {
    if (!plan || (format !== "pdf" && format !== "zip") || format === plan.format) return;
    const items = [
      ...new Map(
        plan.outputs.flatMap((output) => output.items).map((item) => [keyOf(item), item]),
      ).values(),
    ];
    const outputs: DeliveryOutput[] =
      format === "pdf"
        ? [{ id: "gesamt", label: "Bewerbung", mode: "merge", compression: "none", items }]
        : ([
            {
              id: "cover",
              label: "Anschreiben",
              mode: "original",
              compression: "none",
              items: items.filter(
                (item) =>
                  item.kind === "build" &&
                  app.builds.find((build) => build.id === item.id)?.kind === "cover",
              ),
            },
            {
              id: "cv",
              label: "Lebenslauf",
              mode: "original",
              compression: "none",
              items: items.filter(
                (item) =>
                  item.kind === "build" &&
                  app.builds.find((build) => build.id === item.id)?.kind === "cv",
              ),
            },
            {
              id: "attachments",
              label: "Anlagen",
              mode: "merge",
              compression: "none",
              items: items.filter((item) => item.kind === "document"),
            },
          ].filter((output) => output.items.length > 0) as DeliveryOutput[]);
    if (!outputs.length)
      outputs.push({
        id: "gesamt",
        label: "Bewerbung",
        mode: "merge",
        compression: "none",
        items: [],
      });
    setPlan({ ...plan, format, outputs });
    setDirty(true);
  }
  function move(output: DeliveryOutput, index: number, direction: number) {
    const items = [...output.items],
      target = index + direction;
    if (target < 0 || target >= items.length) return;
    [items[index], items[target]] = [items[target]!, items[index]!];
    editOutput(output.id, { items });
  }
  function toggleSource(output: DeliveryOutput, item: PdfInput, included: boolean) {
    let items = output.items.filter((current) => keyOf(current) !== keyOf(item));
    if (included) {
      if (output.mode === "original") items = [];
      if (item.kind === "build") {
        const kind = app.builds.find((build) => build.id === item.id)?.kind;
        items = items.filter(
          (current) =>
            current.kind !== "build" ||
            app.builds.find((build) => build.id === current.id)?.kind !== kind,
        );
      }
      items.push(item);
    }
    editOutput(output.id, { items });
  }
  async function reload() {
    if (dirty && !confirm("Ungespeicherten Paketplan verwerfen?")) return;
    try {
      setPlan(await api<DeliveryPlan>(`/applications/${app.id}/delivery-plan`));
      setDirty(false);
      setError("");
    } catch (error) {
      setError(errorMessage(error));
    }
  }
  async function save(generate: boolean) {
    if (!plan || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const saved = dirty
        ? await api<DeliveryPlan>(`/applications/${app.id}/delivery-plan`, "PUT", plan)
        : plan;
      setPlan(saved);
      setDirty(false);
      if (generate)
        await api(`/applications/${app.id}/deliveries`, "POST", { revision: saved.revision });
      setJobs(await api<DeliveryJob[]>(`/applications/${app.id}/deliveries`));
      await onRefresh();
      setNotice(
        generate
          ? "Paketerstellung gestartet. Du kannst diesen Bereich verlassen und später herunterladen."
          : "Paketplan gespeichert.",
      );
    } catch (error) {
      setError(errorMessage(error));
    }
    setBusy(false);
  }
  async function saveSelection() {
    setSelectionBusy(true);
    setError("");
    try {
      await api(`/applications/${app.id}`, "PATCH", {
        revision: selectionRevision,
        documentIds: selected,
      });
      const previous = new Set(app.documents.map((document) => document.id));
      if (plan) {
        const added = selected
          .filter((id) => !previous.has(id))
          .map((id) => ({ kind: "document" as const, id }));
        setPlan({
          ...plan,
          outputs: plan.outputs.map((output, index) => ({
            ...output,
            items: [
              ...output.items.filter(
                (item) => item.kind !== "document" || selected.includes(item.id),
              ),
              ...((plan.format === "pdf" && index === 0 && output.mode === "merge") ||
              (output.id === "attachments" && output.mode === "merge")
                ? added
                : []),
            ],
          })),
        });
        setDirty(true);
      }
      await onRefresh();
      setSelecting(false);
    } catch (error) {
      setError(errorMessage(error));
    }
    setSelectionBusy(false);
  }
  return (
    <section className="min-w-0 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-medium">Versandpaket zusammenstellen</h2>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Lege fest, welche PDFs entstehen und welche Originale darin vorkommen. Standard ist eine
            Gesamt-PDF; ZIP enthält getrennte oder selbst zusammengestellte Ausgaben.
          </p>
        </div>
        <Button
          variant="outline"
          disabled={busy || app.harness.busy}
          onClick={() => {
            setSelected(app.documents.map((document) => document.id));
            setSelectionRevision(app.revision);
            setSelecting(true);
          }}
        >
          <Files />
          Anlagen auswählen
        </Button>
      </div>
      <ErrorNotice error={error} onClose={() => setError("")} />
      {plan && (
        <>
          <div className="max-w-lg">
            <Field label="Download-Format">
              <Choice
                label="Download-Format"
                value={plan.format}
                disabled={busy}
                onChange={changeFormat}
                options={[
                  { value: "pdf", label: "Eine Gesamt-PDF" },
                  { value: "zip", label: "ZIP mit getrennten PDF-Dateien" },
                ]}
              />
            </Field>
          </div>
          {sources.some((source) => source.stale) && (
            <p className="rounded-lg border p-3 text-sm">
              Mindestens eine PDF oder Quellenreferenz ist veraltet. Prüfe den Stand und baue
              Lebenslauf oder Anschreiben bei Bedarf neu.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => {
                const latest = new Map(
                  sources
                    .filter(
                      (source) =>
                        source.item.kind === "build" && !source.label.includes("älterer Stand"),
                    )
                    .map((source) => [
                      app.builds.find((build) => build.id === source.item.id)?.kind,
                      source.item,
                    ]),
                );
                setPlan({
                  ...plan,
                  outputs: plan.outputs.map((output) => ({
                    ...output,
                    items: output.items.map((item) =>
                      item.kind === "build"
                        ? {
                            ...item,
                            id:
                              latest.get(app.builds.find((build) => build.id === item.id)?.kind)
                                ?.id ?? item.id,
                          }
                        : item,
                    ),
                  })),
                });
                setDirty(true);
              }}
            >
              Neueste PDF-Stände übernehmen
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void reload()}>
              Plan neu laden
            </Button>
          </div>
          {plan.outputs.map((output, outputIndex) => (
            <section key={output.id} className="min-w-0 space-y-4 rounded-xl border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-medium">Ausgabedatei {outputIndex + 1}</h3>
                {plan.format === "zip" && plan.outputs.length > 1 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    aria-label={`Ausgabedatei ${outputIndex + 1} entfernen`}
                    onClick={() => {
                      setPlan({
                        ...plan,
                        outputs: plan.outputs.filter((current) => current.id !== output.id),
                      });
                      setDirty(true);
                    }}
                  >
                    <Trash2 />
                    Entfernen
                  </Button>
                )}
              </div>
              <div className="grid min-w-0 gap-4 md:grid-cols-3">
                <Field label="Dokumentbezeichnung">
                  <Input
                    aria-label={`Dokumentbezeichnung ${outputIndex + 1}`}
                    value={output.label}
                    maxLength={80}
                    disabled={busy}
                    onChange={(event) => editOutput(output.id, { label: event.target.value })}
                  />
                </Field>
                <Field label="Ausgabemodus">
                  <Choice
                    label={`Ausgabemodus ${outputIndex + 1}`}
                    value={output.mode}
                    disabled={busy}
                    onChange={(mode) => {
                      if (mode !== "merge" && mode !== "original") return;
                      if (
                        mode === "original" &&
                        output.items.length > 1 &&
                        !confirm(
                          "Für ein unverändertes Original wird nur die erste PDF übernommen. Fortfahren?",
                        )
                      )
                        return;
                      editOutput(output.id, {
                        mode,
                        ...(mode === "original"
                          ? {
                              compression: "none",
                              items: output.items.slice(0, 1).map(({ kind, id }) => ({ kind, id })),
                            }
                          : {}),
                      });
                    }}
                    options={[
                      { value: "merge", label: "PDF zusammenstellen" },
                      { value: "original", label: "Eine Original-PDF unverändert" },
                    ]}
                  />
                </Field>
                <Field label="Kompression">
                  <Choice
                    label={`Kompression ${outputIndex + 1}`}
                    value={output.compression}
                    disabled={busy || output.mode === "original"}
                    onChange={(compression) => {
                      if (
                        compression === "none" ||
                        compression === "lossless" ||
                        compression === "compact"
                      )
                        editOutput(output.id, { compression });
                    }}
                    options={[
                      { value: "none", label: "Keine zusätzliche Kompression" },
                      { value: "lossless", label: "Verlustfrei optimieren" },
                      { value: "compact", label: "Kompakt (150 dpi)" },
                    ]}
                  />
                </Field>
              </div>
              <p className="break-all text-xs text-muted-foreground">
                Dateiname: {filename(output.label, settings, app)}
              </p>
              <fieldset className="space-y-2">
                <legend className="mb-2 text-sm font-medium">Unterlagen für diese Ausgabe</legend>
                {sources.map((source) => (
                  <label key={keyOf(source.item)} className="flex items-start gap-2 text-sm">
                    <Checkbox
                      aria-label={`${source.label} in Ausgabe ${outputIndex + 1}`}
                      disabled={
                        busy || (output.mode === "original" && source.mime !== "application/pdf")
                      }
                      checked={output.items.some((item) => keyOf(item) === keyOf(source.item))}
                      onCheckedChange={(included) => toggleSource(output, source.item, included)}
                    />
                    <span className="min-w-0 break-words">
                      {source.label}
                      {source.stale ? " · Stand prüfen" : ""}
                    </span>
                  </label>
                ))}
                {!sources.length && (
                  <p className="text-sm text-muted-foreground">
                    Zuerst Lebenslauf oder Anschreiben bauen, oder originale Anlagen auswählen.
                  </p>
                )}
              </fieldset>
              <ol aria-label={`Reihenfolge Ausgabe ${outputIndex + 1}`} className="space-y-2">
                {output.items.map((item, index) => {
                  const source = sources.find((source) => keyOf(source.item) === keyOf(item));
                  return (
                    <li key={keyOf(item)} className="space-y-2 rounded-lg border p-3">
                      <div className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 break-words text-sm">
                          {index + 1}. {source?.label ?? "Fehlende Unterlage"}
                        </span>
                        <IconButton
                          label={`Ausgabe ${outputIndex + 1} Unterlage ${index + 1} nach oben`}
                          disabled={busy || index === 0}
                          onClick={() => move(output, index, -1)}
                        >
                          <ArrowUp />
                        </IconButton>
                        <IconButton
                          label={`Ausgabe ${outputIndex + 1} Unterlage ${index + 1} nach unten`}
                          disabled={busy || index === output.items.length - 1}
                          onClick={() => move(output, index, 1)}
                        >
                          <ArrowDown />
                        </IconButton>
                      </div>
                      {source?.mime === "application/pdf" && output.mode === "merge" && (
                        <Input
                          aria-label={`Seiten Ausgabe ${outputIndex + 1} Unterlage ${index + 1}`}
                          placeholder="Alle Seiten oder z. B. 1-3,5"
                          value={item.pages ?? ""}
                          maxLength={200}
                          disabled={busy}
                          onChange={(event) =>
                            editOutput(output.id, {
                              items: output.items.map((current, i) =>
                                i === index ? { ...current, pages: event.target.value } : current,
                              ),
                            })
                          }
                        />
                      )}
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}
          {plan.format === "zip" && (
            <Button
              variant="outline"
              disabled={busy || plan.outputs.length >= 8}
              onClick={() => {
                setPlan({
                  ...plan,
                  outputs: [
                    ...plan.outputs,
                    {
                      id: randomUUID(),
                      label: "Weitere Unterlagen",
                      mode: "merge",
                      items: [],
                      compression: "none",
                    },
                  ],
                });
                setDirty(true);
              }}
            >
              <Plus />
              Ausgabedatei hinzufügen
            </Button>
          )}
          <p className="text-xs text-muted-foreground">
            Originale bleiben unverändert. Zusammenführen erzeugt neue PDFs; digitale Signaturen
            gelten nur im Original. Kompakt kann Bildqualität reduzieren. Die Dateinamen werden
            automatisch vorgegeben; deinen Namen hinterlegst du unter Settings → Bewerbungen.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={busy || !dirty} onClick={() => void save(false)}>
              <Save />
              Paketplan speichern
            </Button>
            <Button
              disabled={
                busy || plan.outputs.some((output) => !output.items.length || !output.label.trim())
              }
              onClick={() => void save(true)}
            >
              <Files />
              {busy ? "Wird vorbereitet…" : "Versandpaket erstellen"}
            </Button>
          </div>
          <p role="status" className="text-sm text-muted-foreground">
            {notice}
          </p>
        </>
      )}
      <section className="space-y-3 border-t pt-5">
        <h3 className="font-medium">Erstellte Pakete</h3>
        {jobs.length === 0 && (
          <p className="text-sm text-muted-foreground">Noch kein Paket erstellt.</p>
        )}
        <ul className="space-y-3">
          {jobs.map((job) => (
            <li key={job.id} className="min-w-0 space-y-2 rounded-lg border p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="min-w-0 break-all text-sm font-medium">{job.filename}</span>
                <Badge variant="outline">
                  {job.status === "success"
                    ? "Bereit"
                    : job.status === "failed"
                      ? "Fehlgeschlagen"
                      : "Wird erstellt…"}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                {new Date(job.created).toLocaleString("de-DE")} · fester Quellenstand r
                {job.sourceRevision}
                {job.sourceRevision !== app.revision ? " · Bewerbung seitdem bearbeitet" : ""}
              </p>
              <ul className="space-y-1 text-xs text-muted-foreground">
                {job.outputs.map((output) => (
                  <li key={output.filename} className="break-all">
                    {output.filename}
                    {output.original ? " · unverändertes Original" : ""}
                  </li>
                ))}
              </ul>
              {job.error && (
                <p role="alert" className="text-sm text-destructive">
                  {job.error}
                </p>
              )}
              {job.status === "success" && (
                <Button
                  variant="outline"
                  render={<a href={`${base}/applications/${app.id}/deliveries/${job.id}/file`} />}
                >
                  <Download />
                  Herunterladen
                </Button>
              )}
            </li>
          ))}
        </ul>
      </section>
      <Dialog
        open={selecting}
        onOpenChange={(open) => {
          if (!selectionBusy) setSelecting(open);
        }}
      >
        <DialogPopup className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Anlagen für diese Bewerbung</DialogTitle>
            <DialogDescription>
              Wähle vorhandene Originaldateien oder lade weitere hoch. Die Reihenfolge und
              Zusammenstellung bestimmst du anschließend je Ausgabedatei.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            {selecting && (
              <DocumentLibrary
                selected={selected}
                onSelectionChange={setSelected}
                onBusyChange={setSelectionBusy}
              />
            )}
          </DialogPanel>
          <DialogFooter>
            <Button variant="ghost" disabled={selectionBusy} onClick={() => setSelecting(false)}>
              Abbrechen
            </Button>
            <Button disabled={selectionBusy} onClick={() => void saveSelection()}>
              Auswahl übernehmen
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </section>
  );
}
