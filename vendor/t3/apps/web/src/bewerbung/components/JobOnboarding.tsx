import { useEffect, useRef, useState } from "react";
import { Link2 } from "lucide-react";
import type {
  ApplicationDetail,
  JobAnalysis,
  NewApplication,
  TemplateSummary,
} from "../shared/api";
import { api, errorMessage } from "../api";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogPanel,
  DialogFooter,
} from "~/components/ui/dialog";
import { Choice, ErrorNotice, Field } from "./Controls";
import { useLayoutLibrary, layoutOptions } from "./LayoutLibrary";
import { normalizeJobLink } from "./job-link";
import { useApplications } from "../ApplicationsProvider";
import { ApplicantProfileEditor } from "./ApplicantProfileEditor";

export function JobOnboarding({
  templates,
  onClose,
  onSaved,
}: {
  templates: TemplateSummary[];
  onClose: () => void;
  onSaved: (app: ApplicationDetail) => Promise<void>;
}) {
  const applications = useApplications();
  const library = useLayoutLibrary();
  const [cvChoice, setCvChoice] = useState<string | null | undefined>(undefined);
  const [coverChoice, setCoverChoice] = useState<string | null | undefined>(undefined);
  const cvModId = cvChoice === undefined ? (library.data?.defaults.cv ?? null) : cvChoice;
  const coverModId =
    coverChoice === undefined ? (library.data?.defaults.cover ?? null) : coverChoice;
  const layoutsReady =
    Boolean(library.data) &&
    !library.loading &&
    !library.error &&
    [
      ["cv", cvModId],
      ["cover", coverModId],
    ].every(
      ([kind, id]) =>
        !id ||
        library.data!.layouts.some(
          (layout) => layout.kind === kind && layout.versionId === id && layout.available,
        ),
    );
  const [profileOpen, setProfileOpen] = useState(false);
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
  useEffect(
    () => () => {
      sequence.current++;
      request.current?.abort();
    },
    [],
  );
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
    if (!nextUrl.trim()) return;
    const link = normalizeJobLink(nextUrl);
    if (!link) {
      setError(
        "Bitte einen vollständigen Stellen-Link mit https:// oder http:// eingeben – ohne zusätzlichen Text.",
      );
      return;
    }
    setUrl(link);
    const fingerprint = link + "\n" + nextText;
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
      const result = await api<JobAnalysis>(
        "/job-analysis",
        "POST",
        { url: link, ...(nextText.trim() ? { text: nextText } : {}) },
        controller.signal,
      );
      if (token === sequence.current) {
        setAnalysis(result);
        setCompany(result.company);
        setRole(result.role);
        if (!result.company || !result.role) {
          setManual(true);
          setError("Unternehmen oder Stelle nicht eindeutig erkannt. Bitte ergänzen.");
        }
      }
    } catch (error) {
      if (token === sequence.current && !controller.signal.aborted) {
        setError(errorMessage(error));
        setManual(true);
      }
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
    if (saving || analyzing || !company.trim() || !role.trim() || !layoutsReady) return;
    setSaving(true);
    setError("");
    try {
      const master = templates.find((template) => template.isDefault) ?? templates[0];
      const posting = analysis
        ? [
            `Quelle: ${analysis.url}`,
            `Erfasst: ${analysis.capturedAt}`,
            "",
            analysis.text,
            ...(analysis.requirements.length
              ? [
                  "",
                  "Erkannte Anforderungen:",
                  ...analysis.requirements.map((value) => "• " + value),
                ]
              : []),
          ].join("\n")
        : [url.trim() ? "Quelle: " + url.trim() : "", text].filter(Boolean).join("\n\n");
      const body: NewApplication = {
        company: company.trim(),
        role: role.trim(),
        posting,
        cvModId,
        coverModId,
        ...(master
          ? {
              template: master.id,
              ...(master.defaultProfile ? { profile: master.defaultProfile } : {}),
            }
          : {}),
      };
      const created = await api<ApplicationDetail>("/applications", "POST", body);
      await onSaved(created);
      onClose();
    } catch (error) {
      setError(errorMessage(error));
    }
    setSaving(false);
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving && !profileOpen) onClose();
      }}
    >
      <DialogPopup className="max-w-2xl" showCloseButton={!saving && !profileOpen}>
        <DialogHeader>
          <DialogTitle>{profileOpen ? "Bewerberprofil" : "Neue Bewerbung"}</DialogTitle>
          <DialogDescription>
            {profileOpen
              ? "Name, Adresse und eigene Unterschrift einmal speichern. Anschließend mit der Bewerbung fortfahren; deine bisherigen Eingaben bleiben erhalten."
              : "Stellen-Link einfügen. Die Anzeige wird automatisch gelesen und analysiert; anschließend prüfst du Unternehmen und Stelle."}
          </DialogDescription>
        </DialogHeader>
        {profileOpen && applications.settings ? (
          <DialogPanel>
            <ApplicantProfileEditor
              settings={applications.settings}
              onSaved={() => setProfileOpen(false)}
              onClose={() => setProfileOpen(false)}
            />
          </DialogPanel>
        ) : (
          <form onSubmit={(event) => void submit(event)} className="flex min-h-0 flex-col">
            <DialogPanel>
              <div className="space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm text-muted-foreground">
                    Bewerberprofil:{" "}
                    {applications.settings?.applicantName || "Noch kein Name erfasst"}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={saving || !applications.settings}
                    onClick={() => setProfileOpen(true)}
                  >
                    Bewerberprofil bearbeiten
                  </Button>
                </div>
                <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                  <Field label="Lebenslauf-Vorlage">
                    <Choice
                      label="Lebenslauf-Vorlage für neue Bewerbung"
                      value={cvModId || ""}
                      disabled={saving || library.loading}
                      onChange={(value) => setCvChoice(value || null)}
                      options={[
                        { value: "", label: "Bestehende Quellen / kein importiertes Layout" },
                        ...layoutOptions(library.data, "cv", cvModId),
                      ]}
                    />
                  </Field>
                  <Field label="Anschreiben-Vorlage">
                    <Choice
                      label="Anschreiben-Vorlage für neue Bewerbung"
                      value={coverModId || ""}
                      disabled={saving || library.loading}
                      onChange={(value) => setCoverChoice(value || null)}
                      options={[
                        { value: "", label: "Bestehende Quellen / kein importiertes Layout" },
                        ...layoutOptions(library.data, "cover", coverModId),
                      ]}
                    />
                  </Field>
                </div>
                <ErrorNotice
                  error={
                    library.error ||
                    (!library.loading && library.data && !layoutsReady
                      ? "Eine gewählte Vorlage ist nicht verfügbar. Andere Vorlage oder bestehende Quellen wählen."
                      : "")
                  }
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={saving || library.loading}
                    onClick={library.reload}
                  >
                    Vorlagen neu laden
                  </Button>
                  <a
                    className="text-xs underline"
                    href="/bewerbungen#vorlagenimporte"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Vorlagen verwalten oder importieren
                  </a>
                </div>
                {!library.loading && library.data?.layouts.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    Noch keine freigegebenen Layouts. Du kannst mit vorhandenen Quellen fortfahren
                    und später ein Layout wählen.
                  </p>
                )}
                {applications.settings?.prepareCoverLetter === false && (
                  <p className="text-xs text-muted-foreground">
                    Die Anschreiben-Vorlage wird nur vorgemerkt. Die ausgeschaltete Vorbereitung
                    bleibt ausgeschaltet.
                  </p>
                )}
                <Field label="Stellen-Link">
                  <Input
                    autoFocus
                    type="url"
                    aria-label="Stellen-Link"
                    placeholder="https://…"
                    value={url}
                    disabled={saving}
                    onChange={(event) => changeUrl(event.target.value)}
                    onBlur={() => {
                      if (!manual) void analyze(url);
                    }}
                    onPaste={(event) => {
                      const next = normalizeJobLink(event.clipboardData.getData("text"));
                      if (next) {
                        event.preventDefault();
                        changeUrl(next);
                        void analyze(next);
                      }
                    }}
                  />
                </Field>
                <p className="text-xs text-muted-foreground">
                  Die Ausschreibung wird an das Modell für Stellenanalysen übermittelt. Die
                  Modellwahl findest du unter Settings → Bewerbungen. Es wird kein Chat gestartet.
                </p>
                <p role="status" className="text-sm">
                  {analyzing
                    ? "Stellenanzeige wird gelesen und analysiert…"
                    : analysis
                      ? "Analyse abgeschlossen. Bitte Angaben prüfen."
                      : ""}
                </p>
                <ErrorNotice error={error} onClose={() => setError("")} />
                <details open={Boolean(error && !analysis)}>
                  <summary className="cursor-pointer text-sm text-muted-foreground">
                    Seite nicht lesbar? Ausschreibungstext einfügen
                  </summary>
                  <div className="mt-3 space-y-2">
                    <Textarea
                      aria-label="Ausschreibungstext"
                      rows={6}
                      maxLength={60000}
                      value={text}
                      disabled={saving}
                      placeholder="Bei Login, abgelaufener Anzeige oder Zugriffssperre hier den Text einfügen."
                      onChange={(event) => setText(event.target.value)}
                      onPaste={(event) => {
                        const next = event.clipboardData.getData("text");
                        if (next.trim().length >= 80) {
                          event.preventDefault();
                          setText(next);
                          void analyze(url, next);
                        }
                      }}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      disabled={analyzing || saving || text.trim().length < 80 || !url.trim()}
                      onClick={() => void analyze(url, text, true)}
                    >
                      Text analysieren
                    </Button>
                  </div>
                </details>
                {(analysis || manual) && (
                  <div className="space-y-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label="Unternehmen *">
                        <Input
                          aria-label="Unternehmen"
                          required
                          maxLength={200}
                          value={company}
                          disabled={analyzing || saving}
                          onChange={(event) => setCompany(event.target.value)}
                        />
                      </Field>
                      <Field label="Rolle / Stelle *">
                        <Input
                          aria-label="Rolle / Stelle"
                          required
                          maxLength={200}
                          value={role}
                          disabled={analyzing || saving}
                          onChange={(event) => setRole(event.target.value)}
                        />
                      </Field>
                    </div>
                    {analysis && analysis.requirements.length > 0 && (
                      <section className="space-y-2">
                        <h3 className="text-sm font-medium">Erkannte Anforderungen</h3>
                        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                          {[...new Set(analysis.requirements)].map((value) => (
                            <li key={value}>{value}</li>
                          ))}
                        </ul>
                      </section>
                    )}
                  </div>
                )}
                <Button type="button" variant="ghost" disabled={saving} onClick={enterManually}>
                  {analyzing
                    ? "Analyse abbrechen und manuell eingeben"
                    : "Angaben manuell eingeben"}
                </Button>
              </div>
            </DialogPanel>
            <DialogFooter>
              <Button type="button" variant="ghost" disabled={saving} onClick={onClose}>
                Abbrechen
              </Button>
              <Button
                type="submit"
                disabled={analyzing || saving || !company.trim() || !role.trim() || !layoutsReady}
              >
                <Link2 />
                {saving ? "Wird angelegt…" : "Bewerbung anlegen"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogPopup>
    </Dialog>
  );
}
