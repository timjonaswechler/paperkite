import { useEffect, useState } from "react";
import { Download, FileCode, Plus, Save, Trash2 } from "lucide-react";
import type { ApplicationDetail, Build, CoverLetter, ProfileValue } from "../shared/api";
import { api, base, errorMessage, textFile } from "../api";
import { registerNavigationGuard } from "../navigation";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { Switch } from "~/components/ui/switch";
import { Checkbox } from "~/components/ui/checkbox";
import { Badge } from "~/components/ui/badge";
import { ErrorNotice, Field } from "./Controls";

export function useDocumentDraftGuard(dirty: boolean) {
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- protects an unsaved document when navigating to another application or work area
  useEffect(() => registerNavigationGuard(() => !dirty || confirm("Ungespeicherte Dokumentänderungen verwerfen?")), [dirty]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- protects document input before a browser reload
  useEffect(() => { const warn = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); }; window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn); }, [dirty]);
}

type EditorProps = { app: ApplicationDetail; autoBuild: boolean; onRefresh: () => Promise<void>; onAdvanced: () => void };

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
    void api<{ fields: CoverLetter; revision: number; requiresConversion: boolean }>(`/applications/${app.id}/cover-letter`, "GET", undefined, controller.signal).then(result => { setFields(result.fields); setRevision(result.revision); setConversion(result.requiresConversion); }).catch(error => { if (!controller.signal.aborted) setError(errorMessage(error)); });
    return () => controller.abort();
  }, [app.id]);
  async function save(build: boolean) {
    if (!fields || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      if (dirty) {
        const saved = await api<{ revision: number }>(`/applications/${app.id}/cover-letter`, "PUT", { revision, fields, replaceExisting: replace });
        setRevision(saved.revision); setDirty(false); setConversion(false); setReplace(false);
      }
      if (build || autoBuild && dirty) await api(`/applications/${app.id}/builds`, "POST", { kind: "cover" });
      await onRefresh(); setNotice(build ? "Gespeichert. PDF-Build gestartet." : "Anschreiben gespeichert.");
    } catch (error) { setError(errorMessage(error)); }
    setBusy(false);
  }
  const editable = fields && (!conversion || replace);
  const names: { key: keyof CoverLetter; label: string; rows: number }[] = [{ key: "sender", label: "Absender", rows: 3 }, { key: "recipient", label: "Empfänger", rows: 3 }, { key: "subject", label: "Betreff", rows: 1 }, { key: "salutation", label: "Anrede", rows: 1 }, { key: "body", label: "Anschreibentext", rows: 14 }, { key: "closing", label: "Grußformel", rows: 1 }];
  return <div className="grid min-w-0 gap-6 xl:grid-cols-2">
    <section className="min-w-0 space-y-4">
      <div><h2 className="text-lg font-medium">Anschreiben verfassen</h2><p className="text-sm text-muted-foreground">Text bearbeiten, speichern und als PDF bauen. KI-Unterstützung ist optional im Bereich Chats verfügbar.</p></div>
      <ErrorNotice error={error} onClose={() => setError("")} />
      {conversion && <div className="space-y-3 rounded-lg border p-4 text-sm"><p>Diese Bewerbung enthält eine individuelle TeX-Vorlage. Sie bleibt unverändert, solange du sie nicht ausdrücklich ersetzt. Du kannst sie weiterhin in den erweiterten Quellen bearbeiten.</p><label className="flex items-start gap-2"><Checkbox aria-label="Individuelle Vorlage durch Texteditor ersetzen" checked={replace} onCheckedChange={value => setReplace(value)} /><span>Stattdessen einen neuen Entwurf im Texteditor beginnen und die vorhandene Vorlage beim Speichern ersetzen.</span></label></div>}
      {fields && names.map(({ key, label, rows }) => <Field key={key} label={label}>{rows === 1 ? <Input aria-label={label} value={fields[key]} disabled={!editable || busy || app.harness.busy} maxLength={2000} onChange={event => { setFields({ ...fields, [key]: event.target.value }); setDirty(true); }} /> : <Textarea aria-label={label} rows={rows} value={fields[key]} disabled={!editable || busy || app.harness.busy} maxLength={key === "body" ? 40000 : 2000} onChange={event => { setFields({ ...fields, [key]: event.target.value }); setDirty(true); }} />}</Field>)}
      <div className="flex flex-wrap gap-2"><Button disabled={!dirty || !editable || busy || app.harness.busy} onClick={() => void save(false)}><Save />Speichern{dirty ? " *" : ""}</Button><Button variant="outline" disabled={!editable || busy || app.harness.busy} onClick={() => void save(true)}>Speichern & PDF bauen</Button><Button variant="ghost" onClick={onAdvanced}><FileCode />Erweiterte Quellen</Button></div>
      <p role="status" className="text-sm text-muted-foreground">{notice}</p>
    </section>
    <DocumentPreview app={app} kind="cover" dirty={dirty} onRefresh={onRefresh} />
  </div>;
}

const labels: Record<string, string> = { personal: "Persönliche Daten", name: "Name", title: "Bezeichnung", date: "Zeitraum", org: "Organisation", bullets: "Aufgaben / Erfolge", items: "Kenntnisse", label: "Kategorie", experience: "Berufserfahrung", engagement: "Engagement", skills: "Kenntnisse", education: "Ausbildung", email: "E-Mail", phone: "Telefon", address: "Anschrift", location: "Ort", summary: "Kurzprofil", website: "Website" };
function blankLike(value: ProfileValue): ProfileValue {
  if (Array.isArray(value)) return [];
  if (typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, blankLike(child)]));
  return typeof value === "string" ? "" : typeof value === "boolean" ? false : 0;
}
function ProfileFields({ value, label, path, disabled, onChange }: { value: ProfileValue; label: string; path: string; disabled: boolean; onChange: (value: ProfileValue) => void }) {
  if (typeof value === "string") return <Field label={label}>{value.includes("\n") || value.length > 150 ? <Textarea aria-label={path} rows={4} value={value} disabled={disabled} onChange={event => onChange(event.target.value)} /> : <Input aria-label={path} value={value} disabled={disabled} onChange={event => onChange(event.target.value)} />}</Field>;
  if (typeof value === "number") return <Field label={label}><Input type="number" aria-label={path} value={value} disabled={disabled} onChange={event => { const next = Number(event.target.value); if (Number.isFinite(next)) onChange(next); }} /></Field>;
  if (typeof value === "boolean") return <label className="flex items-center justify-between gap-4 text-sm"><span>{label}</span><Switch aria-label={path} checked={value} disabled={disabled} onCheckedChange={onChange} /></label>;
  if (Array.isArray(value)) {
    const section = path.split(".").at(-1);
    const next: ProfileValue = value[0] !== undefined ? blankLike(value[0]) : section === "skills" ? { label: "", items: [] } : section === "experience" || section === "engagement" || section === "education" ? { date: "", title: "", org: "", bullets: [] } : "";
    return <fieldset className="min-w-0 space-y-3 rounded-lg border p-3"><legend className="px-1 text-sm font-medium">{label}</legend>{value.map((child, index) => <div key={index} className="min-w-0 space-y-2 rounded border p-3"><ProfileFields value={child} label={`${label} ${index + 1}`} path={`${path}.${index + 1}`} disabled={disabled} onChange={next => onChange(value.map((item, i) => i === index ? next : item))} /><Button size="sm" variant="ghost" disabled={disabled} aria-label={`${path} ${index + 1} entfernen`} onClick={() => { if (confirm("Diesen Eintrag aus dem Lebenslauf entfernen?")) onChange(value.filter((_, i) => i !== index)); }}><Trash2 />Entfernen</Button></div>)}<Button size="sm" variant="outline" disabled={disabled} aria-label={`${path} Eintrag hinzufügen`} onClick={() => onChange([...value, next])}><Plus />Hinzufügen</Button></fieldset>;
  }
  return <fieldset className="min-w-0 space-y-4"><legend className="mb-3 text-sm font-medium">{label}</legend>{Object.entries(value).map(([key, child]) => <ProfileFields key={key} value={child} label={labels[key] ?? key} path={`${path}.${key}`} disabled={disabled} onChange={next => onChange({ ...value, [key]: next })} />)}</fieldset>;
}

export function CvEditor({ app, autoBuild, onRefresh, onAdvanced }: EditorProps) {
  const path = `cv/profiles/${app.profile}.lua`;
  const [entries, setEntries] = useState<ProfileValue | null>(null);
  const [revision, setRevision] = useState(app.revision);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useDocumentDraftGuard(dirty);
  const hasProfile = app.files.some(file => file.name === path);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- loads the selected CV profile through the non-executing Lua literal parser
  useEffect(() => {
    if (!hasProfile) return;
    const controller = new AbortController();
    void api<{ entries: ProfileValue; revision: number }>(`/applications/${app.id}/profile?path=${encodeURIComponent(path)}`, "GET", undefined, controller.signal).then(result => { setEntries(result.entries); setRevision(result.revision); }).catch(error => { if (!controller.signal.aborted) setError(errorMessage(error)); });
    return () => controller.abort();
  }, [app.id, path, hasProfile]);
  async function save(build: boolean) {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      if (dirty && entries) {
        const saved = await api<{ revision: number }>(`/applications/${app.id}/profile`, "PUT", { path, entries, revision });
        setRevision(saved.revision); setDirty(false);
      }
      if (build || autoBuild && dirty) await api(`/applications/${app.id}/builds`, "POST", { kind: "cv" });
      await onRefresh(); setNotice(build ? "Gespeichert. PDF-Build gestartet." : "Lebenslauf gespeichert.");
    } catch (error) { setError(errorMessage(error)); }
    setBusy(false);
  }
  return <div className="grid min-w-0 gap-6 xl:grid-cols-2">
    <section className="min-w-0 space-y-4">
      <div><h2 className="text-lg font-medium">Lebenslauf anpassen</h2><p className="text-sm text-muted-foreground">Die Angaben gelten nur für diese Bewerbung. Die Standardvorlage bleibt unverändert.</p></div>
      <ErrorNotice error={error} onClose={() => setError("")} />
      {!hasProfile && <p className="rounded border p-4 text-sm">Kein bearbeitbares CV-Profil vorhanden. Eine Standardvorlage unter Settings → Bewerbungen → Vorlagen importieren oder die erweiterten Quellen verwenden.</p>}
      {entries && <ProfileFields value={entries} label="Lebenslauf" path="Profil" disabled={busy || app.harness.busy} onChange={value => { setEntries(value); setDirty(true); }} />}
      {entries && <p className="text-xs text-muted-foreground">Beim Speichern wird das Profil neu serialisiert. Literale Zusatzfelder bleiben erhalten; Lua-Kommentare und Formatierung können entfallen. Für individuelle Lua-Logik den erweiterten Editor verwenden.</p>}
      <div className="flex flex-wrap gap-2"><Button disabled={!dirty || busy || app.harness.busy} onClick={() => void save(false)}><Save />Speichern{dirty ? " *" : ""}</Button><Button variant="outline" disabled={!hasProfile || busy || app.harness.busy} onClick={() => void save(true)}>Speichern & PDF bauen</Button><Button variant="ghost" onClick={onAdvanced}><FileCode />Erweiterte Quellen</Button></div>
      <p role="status" className="text-sm text-muted-foreground">{notice}</p>
    </section>
    <DocumentPreview app={app} kind="cv" dirty={dirty} onRefresh={onRefresh} />
  </div>;
}

function DocumentPreview({ app, kind, dirty, onRefresh }: { app: ApplicationDetail; kind: "cv" | "cover"; dirty: boolean; onRefresh: () => Promise<void> }) {
  const latest = app.builds.find(build => build.kind === kind && build.status === "success");
  const running = app.builds.some(build => build.kind === kind && ["queued", "running"].includes(build.status));
  const [log, setLog] = useState("");
  const [error, setError] = useState("");
  const state = app.documentStatus?.[kind] ?? (latest ? "outdated" : "missing");
  const status = dirty ? "Ungespeicherte Änderungen" : running ? "PDF wird gebaut…" : state === "current" ? "Aktueller Quellenstand" : state === "outdated" ? "Quellen seit PDF-Erstellung geändert" : "Noch kein PDF gebaut";
  async function finalize(build: Build) {
    try { await api(`/applications/${app.id}/builds/${build.id}/finalize`, "POST", {}); await onRefresh(); } catch (error) { setError(errorMessage(error)); }
  }
  return <section className="min-w-0 space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-medium">PDF-Vorschau</h2><Badge variant="outline">{status}</Badge></div>
    <ErrorNotice error={error} onClose={() => setError("")} />
    {latest ? <><div className="h-[65vh] min-h-80 overflow-hidden rounded-lg border"><iframe title={kind === "cv" ? "Lebenslauf PDF-Vorschau" : "Anschreiben PDF-Vorschau"} src={`${base}/applications/${app.id}/builds/${latest.id}/pdf`} className="h-full w-full" /></div><Button size="sm" variant="outline" render={<a href={`${base}/applications/${app.id}/builds/${latest.id}/pdf?download=1`} />}><Download />PDF-Entwurf herunterladen</Button></> : <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">Nach dem Bauen erscheint hier die Vorschau. Ein früheres erfolgreiches PDF bleibt bei Buildfehlern erhalten.</p>}
    <details className="rounded-lg border p-3"><summary className="cursor-pointer text-sm">Buildverlauf und Logs</summary><ul className="mt-3 space-y-3">{app.builds.filter(build => build.kind === kind).map(build => <li key={build.id} className="space-y-2 text-sm"><p>{new Date(build.created).toLocaleString("de-DE")} · {build.status} · r{build.revision}{build.finalized ? " · festgehalten" : ""}</p><div className="flex flex-wrap gap-2"><Button size="sm" variant="ghost" onClick={() => { void textFile(`/applications/${app.id}/builds/${build.id}/log`).then(setLog).catch(error => setError(errorMessage(error))); }}>Log anzeigen</Button>{build.status === "success" && <><Button size="sm" variant="ghost" render={<a href={`${base}/applications/${app.id}/builds/${build.id}/pdf?download=1`} />}>PDF</Button>{!build.finalized && <Button size="sm" variant="ghost" onClick={() => void finalize(build)}>Festhalten</Button>}</>}</div></li>)}</ul></details>
    {log && <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded border p-3 text-xs">{log}</pre>}
  </section>;
}
