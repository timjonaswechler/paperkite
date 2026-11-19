import { useEffect, useRef, useState } from "react";
import { Link2 } from "lucide-react";
import type { ApplicationDetail, JobAnalysis, NewApplication, TemplateSummary } from "../shared/api";
import { api, errorMessage } from "../api";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { Dialog, DialogPopup, DialogHeader, DialogTitle, DialogDescription, DialogPanel, DialogFooter } from "~/components/ui/dialog";
import { ErrorNotice, Field } from "./Controls";

export function JobOnboarding({ templates, onClose, onSaved }: { templates: TemplateSummary[]; onClose: () => void; onSaved: (app: ApplicationDetail) => Promise<void> }) {
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [company, setCompany] = useState("");
  const [role, setRole] = useState("");
  const [analysis, setAnalysis] = useState<JobAnalysis | null>(null);
  const [manual, setManual] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  const lastInput = useRef("");
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- cancels the owned background analysis when this onboarding closes
  useEffect(() => () => { sequence.current++; request.current?.abort(); }, []);
  function changeUrl(next: string) {
    sequence.current++;
    request.current?.abort();
    setUrl(next);
    setAnalyzing(false);
    setAnalysis(null);
    setCompany("");
    setRole("");
    setError("");
    lastInput.current = "";
  }
  async function analyze(nextUrl: string, nextText = text, force = false) {
    if (!/^https?:\/\//i.test(nextUrl.trim())) return;
    const fingerprint = nextUrl.trim() + "\n" + nextText;
    if (!force && fingerprint === lastInput.current) return;
    lastInput.current = fingerprint;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const token = ++sequence.current;
    setAnalyzing(true);
    setAnalysis(null);
    setError("");
    try {
      const result = await api<JobAnalysis>("/job-analysis", "POST", { url: nextUrl.trim(), ...(nextText.trim() ? { text: nextText } : {}) }, controller.signal);
      if (token === sequence.current) {
        setAnalysis(result);
        setCompany(result.company);
        setRole(result.role);
        if (!result.company || !result.role) { setManual(true); setError("Unternehmen oder Stelle nicht eindeutig erkannt. Bitte ergänzen."); }
      }
    } catch (error) {
      if (token === sequence.current && !controller.signal.aborted) { setError(errorMessage(error)); setManual(true); }
    }
    if (token === sequence.current) setAnalyzing(false);
  }
  function enterManually() {
    sequence.current++;
    request.current?.abort();
    setAnalyzing(false);
    setManual(true);
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (saving || analyzing || !company.trim() || !role.trim()) return;
    setSaving(true);
    setError("");
    try {
      const master = templates.find(template => template.isDefault) ?? templates[0];
      const posting = analysis
        ? [`Quelle: ${analysis.url}`, `Erfasst: ${analysis.capturedAt}`, "", analysis.text, ...(analysis.requirements.length ? ["", "Erkannte Anforderungen:", ...analysis.requirements.map(value => "• " + value)] : [])].join("\n")
        : [url.trim() ? "Quelle: " + url.trim() : "", text].filter(Boolean).join("\n\n");
      const body: NewApplication = { company: company.trim(), role: role.trim(), posting, ...(master ? { template: master.id, ...(master.defaultProfile ? { profile: master.defaultProfile } : {}) } : {}) };
      const created = await api<ApplicationDetail>("/applications", "POST", body);
      await onSaved(created);
      onClose();
    } catch (error) { setError(errorMessage(error)); }
    setSaving(false);
  }
  return <Dialog open onOpenChange={open => { if (!open && !saving) onClose(); }}>
    <DialogPopup className="max-w-2xl" showCloseButton={!saving}>
      <DialogHeader><DialogTitle>Neue Bewerbung</DialogTitle><DialogDescription>Stellen-Link einfügen. Die Anzeige wird automatisch gelesen und analysiert; anschließend prüfst du Unternehmen und Stelle.</DialogDescription></DialogHeader>
      <form onSubmit={event => void submit(event)} className="flex min-h-0 flex-col">
        <DialogPanel>
          <div className="space-y-5">
            <Field label="Stellen-Link">
              <Input autoFocus type="url" aria-label="Stellen-Link" placeholder="https://…" value={url} disabled={saving} onChange={event => changeUrl(event.target.value)} onBlur={() => { if (!manual) void analyze(url); }} onPaste={event => { const next = event.clipboardData.getData("text").trim(); if (/^https?:\/\//i.test(next)) { event.preventDefault(); changeUrl(next); void analyze(next); } }} />
            </Field>
            <p className="text-xs text-muted-foreground">Die Ausschreibung wird an das Modell für Stellenanalysen übermittelt. Die Modellwahl findest du unter Settings → Bewerbungen. Es wird kein Chat gestartet.</p>
            <p role="status" className="text-sm">{analyzing ? "Stellenanzeige wird gelesen und analysiert…" : analysis ? "Analyse abgeschlossen. Bitte Angaben prüfen." : ""}</p>
            <ErrorNotice error={error} onClose={() => setError("")} />
            <details open={Boolean(error && !analysis)}>
              <summary className="cursor-pointer text-sm text-muted-foreground">Seite nicht lesbar? Ausschreibungstext einfügen</summary>
              <div className="mt-3 space-y-2">
                <Textarea aria-label="Ausschreibungstext" rows={6} maxLength={60000} value={text} disabled={saving} placeholder="Bei Login, abgelaufener Anzeige oder Zugriffssperre hier den Text einfügen." onChange={event => setText(event.target.value)} onPaste={event => { const next = event.clipboardData.getData("text"); if (next.trim().length >= 80) { event.preventDefault(); setText(next); void analyze(url, next); } }} />
                <Button type="button" variant="outline" disabled={analyzing || saving || text.trim().length < 80 || !url.trim()} onClick={() => void analyze(url, text, true)}>Text analysieren</Button>
              </div>
            </details>
            {(analysis || manual) && <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Unternehmen *"><Input aria-label="Unternehmen" required maxLength={200} value={company} disabled={analyzing || saving} onChange={event => setCompany(event.target.value)} /></Field>
                <Field label="Rolle / Stelle *"><Input aria-label="Rolle / Stelle" required maxLength={200} value={role} disabled={analyzing || saving} onChange={event => setRole(event.target.value)} /></Field>
              </div>
              {analysis && analysis.requirements.length > 0 && <section className="space-y-2"><h3 className="text-sm font-medium">Erkannte Anforderungen</h3><ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">{analysis.requirements.map((value, index) => <li key={index}>{value}</li>)}</ul></section>}
            </div>}
            <Button type="button" variant="ghost" disabled={saving} onClick={enterManually}>{analyzing ? "Analyse abbrechen und manuell eingeben" : "Angaben manuell eingeben"}</Button>
          </div>
        </DialogPanel>
        <DialogFooter><Button type="button" variant="ghost" disabled={saving} onClick={onClose}>Abbrechen</Button><Button type="submit" disabled={analyzing || saving || !company.trim() || !role.trim()}><Link2 />{saving ? "Wird angelegt…" : "Bewerbung anlegen"}</Button></DialogFooter>
      </form>
    </DialogPopup>
  </Dialog>;
}
