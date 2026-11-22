import { useEffect, useState } from "react";
import { Plus, Save, Eye, Pencil, FileCode, Trash2 } from "lucide-react";
import { randomUUID } from "~/lib/utils";
import type { ApplicationDetail, CvState, CvData, CvEntry, CvModJob } from "../shared/api";
import { api, errorMessage } from "../api";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import { Input } from "~/components/ui/input";
import { Menu, MenuTrigger, MenuPopup, MenuItem, MenuSeparator } from "~/components/ui/menu";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogPanel,
  DialogFooter,
} from "~/components/ui/dialog";
import { Choice, ErrorNotice } from "./Controls";
import { DocumentPreview, useDocumentDraftGuard } from "./DocumentEditors";
import { CvModImportPanel } from "./CvModImportPanel";
import { CvContentEditor } from "./CvContentEditor";
import { FormModRenderer } from "./FormModRenderer";
import { CvEditable as Editable } from "./CvEditable";
import type { FormMod, Values } from "../../../../../../../shared/cv-form";
import { Checkbox } from "~/components/ui/checkbox";
import styles from "./cv-editor.module.css";

const names: Record<string, string> = {
  firstName: "Vorname",
  lastName: "Nachname",
  displayName: "Name",
  role: "Rolle / Berufsbezeichnung",
  email: "E-Mail",
  phone: "Telefon",
  street: "Straße",
  postalCode: "PLZ",
  city: "Ort",
  birthday: "Geburtsdatum",
  birthplace: "Geburtsort",
  photo: "Foto-Datei",
  signature: "Unterschrift-Datei",
  title: "Bezeichnung",
  organization: "Organisation",
  period: "Zeitraum",
  label: "Kategorie",
  subtitle: "Fachrichtung / Zusatz",
  grade: "Note",
};
const kinds = [
  { kind: "experience", label: "Berufserfahrung" },
  { kind: "education", label: "Ausbildung" },
  { kind: "skills", label: "Kenntnisse" },
  { kind: "engagement", label: "Engagement" },
];
export function CvEditor({
  app,
  autoBuild,
  onRefresh,
  onAdvanced,
}: {
  app: ApplicationDetail;
  autoBuild: boolean;
  onRefresh: () => Promise<void>;
  onAdvanced: () => void;
}) {
  const [state, setState] = useState<CvState | null>(null),
    [data, setData] = useState<CvData | null>(null),
    [mods, setMods] = useState<CvModJob[]>([]),
    [formMods, setFormMods] = useState<Omit<FormMod, "files">[]>([]),
    [formValues, setFormValues] = useState<Values>({}),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [reading, setReading] = useState(false),
    [preview, setPreview] = useState(false),
    [focus, setFocus] = useState(""),
    [newSection, setNewSection] = useState(false),
    [sectionName, setSectionName] = useState("");
  const formMode = Boolean(state?.modId?.startsWith("form:"));
  const dirty = Boolean(
    state &&
    data &&
    (formMode
      ? JSON.stringify(state.form?.values || {}) !== JSON.stringify(formValues)
      : JSON.stringify(state.data) !== JSON.stringify(data)),
  );
  function accept(next: CvState) {
    setState(next);
    setData(next.data);
    setFormValues(next.form?.values || {});
  }
  useDocumentDraftGuard(dirty);
  const disabled = busy || loading || app.harness.busy,
    readonly = reading || disabled;
  async function load() {
    setLoading(true);
    setError("");
    try {
      const next = await api<CvState>(`/applications/${app.id}/cv-data`);
      accept(next);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- loads the selected application's revisioned CV and cancels stale responses when switching applications
  useEffect(() => {
    const abort = new AbortController();
    void api<CvState>(`/applications/${app.id}/cv-data`, "GET", undefined, abort.signal)
      .then((next) => {
        setState(next);
        setData(next.data);
        setFormValues(next.form?.values || {});
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(errorMessage(e));
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    void api<Omit<FormMod, "files">[]>("/cv-form-mods", "GET", undefined, abort.signal)
      .then(setFormMods)
      .catch(() => {});
    void api<CvModJob[]>("/cv-mods/jobs", "GET", undefined, abort.signal)
      .then(setMods)
      .catch(() => {});
    return () => abort.abort();
  }, [app.id]);
  function change(next: CvData) {
    setData(next);
    setNotice("");
  }
  function person(key: string, value: string) {
    if (!data) return;
    const next = { ...data.person, [key]: value };
    if (key === "firstName" || key === "lastName")
      next.displayName = [next.firstName, next.lastName].filter(Boolean).join(" ");
    change({ ...data, person: next });
  }
  function entryChange(id: string, update: (entry: CvEntry) => CvEntry) {
    if (!data) return;
    setData((current) =>
      current
        ? {
            ...current,
            sections: current.sections.map((s) => ({
              ...s,
              entries: s.entries.map((entry) => (entry.id === id ? update(entry) : entry)),
            })),
          }
        : current,
    );
    setNotice("");
  }
  function field(id: string, key: string, value: string) {
    entryChange(id, (e) => ({ ...e, fields: { ...e.fields, [key]: value } }));
  }
  function addEntry(kind: string, label?: string) {
    if (!data) return;
    const id = randomUUID(),
      entry: CvEntry = {
        id,
        fields: kind === "skills" ? { label: "" } : { title: "", organization: "", period: "" },
        included: true,
        content: [],
      };
    const existing = data.sections.find((s) => s.kind === kind);
    change({
      ...data,
      sections: existing
        ? data.sections.map((s) => (s.kind === kind ? { ...s, entries: [...s.entries, entry] } : s))
        : [
            ...data.sections,
            {
              id: randomUUID(),
              kind,
              label: label || kinds.find((x) => x.kind === kind)?.label || kind,
              entries: [entry],
            },
          ],
    });
    setFocus(id + "-" + (kind === "skills" ? "label" : "title"));
  }
  async function save(build: boolean) {
    if (!state || !data || disabled) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (dirty) {
        const next = await api<CvState>(`/applications/${app.id}/cv-data`, "PUT", {
          revision: state.revision,
          fingerprint: state.fingerprint,
          ...(formMode ? { formValues } : { data }),
        });
        accept(next);
      }
      if (build || (autoBuild && dirty))
        await api(`/applications/${app.id}/builds`, "POST", { kind: "cv" });
      await onRefresh();
      setNotice(build ? "Gespeichert. PDF-Build gestartet." : "Lebenslauf gespeichert.");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function bind(id: string) {
    if (!state || disabled) return;
    if (dirty && !confirm("Ungespeicherte CV-Änderungen verwerfen und Vorlage wechseln?")) return;
    if (
      id.startsWith("form:") &&
      !formMode &&
      !confirm(
        "Zum formularbasierten Mod wechseln? Die bisherigen CV-Daten bleiben erhalten, werden aber nicht automatisch in das neue Formular übertragen. Zur bisherigen Vorlage kannst du zurückwechseln.",
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      const next = await api<CvState>(`/applications/${app.id}/cv-mod`, "PUT", {
        revision: state.revision,
        modId: id || null,
      });
      accept(next);
      await onRefresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const selectedMod = state?.mod;
  function extraFields(entry: CvEntry, kind: string) {
    const fields = { ...entry.fields };
    for (const definition of selectedMod?.fields || []) {
      const prefix = definition.key.startsWith("entry.") ? "entry." : kind + ".";
      if (definition.key.startsWith(prefix)) fields[definition.key.slice(prefix.length)] ??= "";
    }
    return Object.entries(fields);
  }
  function fieldLabel(key: string, kind: string) {
    return (
      selectedMod?.fields.find((f) => f.key === kind + "." + key || f.key === "entry." + key)
        ?.label ||
      names[key] ||
      key
    );
  }
  const personLabel = (key: string) =>
    selectedMod?.fields.find((f) => f.key === "person." + key)?.label || names[key] || key;
  const modOptions = mods
    .filter((m) => m.versionId)
    .map((m) => ({
      value: m.versionId!,
      label:
        (m.versionId!.startsWith("form:") ? "Formular · " : "") +
        m.name +
        (m.status === "review" ? "" : " · letzte geprüfte Version"),
    }));
  for (const m of formMods)
    if (!modOptions.some((option) => option.value === m.id))
      modOptions.push({ value: m.id, label: `Formular · ${m.name} · ${m.id.slice(5, 13)}` });
  if (state?.modId && !modOptions.some((m) => m.value === state.modId))
    modOptions.push({ value: state.modId, label: state.mod?.name || "Gesicherte Mod-Version" });
  const personFields = data
    ? Object.keys(data.person).filter(
        (k) => !["firstName", "lastName", "displayName", "photo", "signature"].includes(k),
      )
    : [];
  for (const def of selectedMod?.fields || []) {
    if (def.key.startsWith("person.")) {
      const key = def.key.slice(7);
      if (!personFields.includes(key)) personFields.push(key);
    }
  }
  return (
    <section className="mx-auto min-w-0 max-w-4xl space-y-4" data-cv-document-editor>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-medium">Lebenslauf anpassen</h2>
        <div className="flex flex-wrap items-center gap-2">
          {!formMode && (
            <Menu>
              <MenuTrigger
                disabled={readonly || !data}
                render={<Button variant="outline" size="sm" />}
              >
                <Plus />
                Hinzufügen
              </MenuTrigger>
              <MenuPopup align="end">
                {kinds.map((k) => (
                  <MenuItem key={k.kind} onClick={() => addEntry(k.kind)}>
                    {k.label}
                  </MenuItem>
                ))}
                <MenuSeparator />
                <MenuItem
                  onClick={() => {
                    setSectionName("");
                    setNewSection(true);
                  }}
                >
                  Eigener Abschnitt…
                </MenuItem>
              </MenuPopup>
            </Menu>
          )}
          <Button
            size="sm"
            variant={reading ? "ghost" : "secondary"}
            aria-pressed={!reading}
            disabled={disabled}
            onClick={() => setReading(false)}
          >
            <Pencil />
            Bearbeiten
          </Button>
          <Button
            size="sm"
            variant={reading ? "secondary" : "ghost"}
            aria-pressed={reading}
            disabled={disabled}
            onClick={() => setReading(true)}
          >
            Lesen
          </Button>
          <Button size="sm" disabled={!dirty || disabled} onClick={() => void save(false)}>
            <Save />
            Speichern
          </Button>
        </div>
      </div>
      <ErrorNotice error={error} onClose={() => setError("")} />
      {state?.modWarning && <ErrorNotice error={state.modWarning} />}
      {error && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            if (!dirty || confirm("Ungespeicherte Änderungen verwerfen?")) void load();
          }}
        >
          CV neu laden
        </Button>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 max-w-lg flex-1">
          <Choice
            label="LaTeX-Vorlage für diesen Lebenslauf"
            value={state?.modId || ""}
            disabled={disabled || !state}
            onChange={(id) => void bind(id)}
            options={[{ value: "", label: "Bestehende LaTeX-Vorlage" }, ...modOptions]}
          />
        </div>
        <Button size="sm" variant="ghost" onClick={onAdvanced}>
          <FileCode />
          Erweiterte Quellen
        </Button>
      </div>
      {!reading && (
        <p className="text-xs text-muted-foreground">
          Feldnamen und Bedienelemente sind nicht Teil des CV-Textes. „Im PDF“ bestimmt die Auswahl;
          das Aussehen liefert die LaTeX-Vorlage.
        </p>
      )}
      {loading && <p className="text-sm text-muted-foreground">Lebenslauf wird geladen…</p>}
      {formMode && state?.form && (
        <FormModRenderer
          spec={state.form.spec}
          values={formValues}
          onChange={setFormValues}
          reading={reading}
          disabled={disabled}
        />
      )}
      {data && !formMode && (
        <article
          className={`${styles["cv-document"]} rounded-lg border bg-card p-4 sm:p-6`}
          data-reading={reading}
          aria-label="Direkt bearbeitbarer Lebenslauf"
        >
          <header className="space-y-2">
            <h3 className="flex flex-wrap gap-x-2 text-2xl font-semibold tracking-tight">
              {"firstName" in data.person || "lastName" in data.person ? (
                <>
                  <Editable
                    label="Vorname"
                    value={data.person.firstName || ""}
                    onChange={(v) => person("firstName", v)}
                    readonly={readonly}
                  />
                  <Editable
                    label="Nachname"
                    value={data.person.lastName || ""}
                    onChange={(v) => person("lastName", v)}
                    readonly={readonly}
                  />
                </>
              ) : (
                <Editable
                  label="Name"
                  value={data.person.displayName || ""}
                  onChange={(v) => person("displayName", v)}
                  readonly={readonly}
                />
              )}
            </h3>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {personFields.map((key) => (
                <div key={key} className="min-w-0">
                  <span className="sr-only">{personLabel(key)}</span>
                  <Editable
                    label={personLabel(key)}
                    value={data.person[key] || ""}
                    readonly={readonly}
                    onChange={(v) => person(key, v)}
                  />
                </div>
              ))}
            </div>
          </header>
          {data.sections
            .filter(
              (section) => !reading || section.entries.some((entry) => entry.included !== false),
            )
            .map((section) => (
              <section key={section.id} className="mt-6 space-y-3" data-cv-section={section.kind}>
                <h3 className="border-b pb-1 text-xs font-medium uppercase tracking-widest text-muted-foreground">
                  <Editable
                    label="Abschnittsüberschrift"
                    value={section.label}
                    readonly={readonly}
                    onChange={(v) =>
                      change({
                        ...data,
                        sections: data.sections.map((s) =>
                          s.id === section.id ? { ...s, label: v } : s,
                        ),
                      })
                    }
                  />
                </h3>
                {section.entries
                  .filter((entry) => !reading || entry.included !== false)
                  .map((entry) => (
                    <article
                      key={entry.id}
                      className={`${styles["cv-entry"]} space-y-1`}
                      data-cv-entry={entry.id}
                      data-included={entry.included !== false}
                    >
                      {!reading && (
                        <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
                          <label className="flex items-center gap-2" htmlFor={"cv-pdf-" + entry.id}>
                            <Checkbox
                              id={"cv-pdf-" + entry.id}
                              checked={entry.included !== false}
                              disabled={disabled}
                              onCheckedChange={(checked) =>
                                entryChange(entry.id, (e) => ({ ...e, included: checked }))
                              }
                            />
                            {entry.included === false ? "Nicht im PDF" : "Im PDF"}
                          </label>
                          <Button
                            size="icon-xs"
                            variant="ghost-muted"
                            disabled={disabled}
                            aria-label="Eintrag entfernen"
                            onClick={() => {
                              if (confirm("Diesen Eintrag dauerhaft aus dem Lebenslauf entfernen?"))
                                change({
                                  ...data,
                                  sections: data.sections.map((s) => ({
                                    ...s,
                                    entries: s.entries.filter((e) => e.id !== entry.id),
                                  })),
                                });
                            }}
                          >
                            <Trash2 />
                          </Button>
                        </div>
                      )}
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                        <h4 className="min-w-0 text-sm font-medium">
                          <Editable
                            label={
                              section.kind === "skills"
                                ? "Kategorie"
                                : section.kind === "education"
                                  ? "Abschluss"
                                  : "Position"
                            }
                            value={
                              entry.fields[section.kind === "skills" ? "label" : "title"] || ""
                            }
                            onChange={(v) =>
                              field(entry.id, section.kind === "skills" ? "label" : "title", v)
                            }
                            readonly={readonly}
                            focus={
                              focus ===
                              entry.id + "-" + (section.kind === "skills" ? "label" : "title")
                            }
                          />
                        </h4>
                        {section.kind !== "skills" && (
                          <span className="text-xs text-muted-foreground">
                            <Editable
                              label="Zeitraum"
                              value={entry.fields.period || ""}
                              readonly={readonly}
                              onChange={(v) => field(entry.id, "period", v)}
                            />
                          </span>
                        )}
                      </div>
                      {section.kind !== "skills" && (
                        <p className="text-xs text-muted-foreground">
                          <Editable
                            label="Organisation"
                            value={entry.fields.organization || ""}
                            onChange={(v) => field(entry.id, "organization", v)}
                            readonly={readonly}
                          />
                        </p>
                      )}
                      {extraFields(entry, section.kind)
                        .filter(
                          ([key]) =>
                            !["title", "organization", "period", "label", "text"].includes(key),
                        )
                        .map(([key, value]) => (
                          <div
                            key={key}
                            className="flex flex-wrap gap-x-2 text-xs text-muted-foreground"
                          >
                            <Editable
                              label={fieldLabel(key, section.kind)}
                              value={value}
                              onChange={(v) => field(entry.id, key, v)}
                              readonly={readonly}
                            />
                          </div>
                        ))}
                      <CvContentEditor
                        value={entry.content}
                        readonly={readonly}
                        inlineList={
                          section.kind === "skills" &&
                          entry.content.length === 1 &&
                          entry.content[0]?.type === "bulletList"
                        }
                        onChange={(content) => entryChange(entry.id, (e) => ({ ...e, content }))}
                      />
                    </article>
                  ))}
              </section>
            ))}
        </article>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={disabled || !data} onClick={() => void save(true)}>
            {dirty ? "Speichern & PDF bauen" : "PDF bauen"}
          </Button>
          <Button variant="ghost" aria-pressed={preview} onClick={() => setPreview((v) => !v)}>
            <Eye />
            PDF-Vorschau
          </Button>
        </div>
        {dirty && <Badge variant="outline">Ungespeicherte Änderungen</Badge>}
      </div>
      {notice && (
        <p role="status" className="text-xs text-muted-foreground">
          {notice}
        </p>
      )}
      {preview && <DocumentPreview app={app} kind="cv" dirty={dirty} onRefresh={onRefresh} />}
      <details className="rounded-lg border p-3">
        <summary className="cursor-pointer text-sm">LaTeX-Vorlage hochladen</summary>
        <div className="mt-4">
          <CvModImportPanel onJobs={setMods} onSelect={(id) => void bind(id)} />
        </div>
      </details>
      <Dialog open={newSection} onOpenChange={setNewSection}>
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>Neuer Lebenslaufabschnitt</DialogTitle>
          </DialogHeader>
          <DialogPanel>
            <Input
              aria-label="Name des neuen Abschnitts"
              value={sectionName}
              onChange={(e) => setSectionName(e.target.value)}
              maxLength={80}
            />
          </DialogPanel>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setNewSection(false)}>
              Abbrechen
            </Button>
            <Button
              disabled={!sectionName.trim()}
              onClick={() => {
                addEntry("custom-" + randomUUID(), sectionName.trim());
                setNewSection(false);
              }}
            >
              Hinzufügen
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </section>
  );
}
