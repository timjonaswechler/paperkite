import { useEffect, useState } from "react";
import {
  APPLICATION_STATUSES,
  type Application,
  type ApplicationDetail,
  type ApplicationStatus,
  type NewApplication,
  type TemplateSummary,
} from "../../shared/api";
import { api, errorMessage } from "../api";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogPanel,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Choice, ErrorNotice, Field } from "./Controls";
import { DocumentLibrary, LibraryDialog } from "./DocumentLibrary";

const preferredProfile = (names: string[], preferred = "general") =>
  names.includes(preferred)
    ? preferred
    : names.includes("general")
      ? "general"
      : (names[0] ?? "");

export type ApplicationFormRequest =
  | { mode: "new" }
  | { mode: "edit" | "copy"; application: ApplicationDetail };
export function ApplicationDialog({
  request,
  applications,
  templates,
  onClose,
  onSaved,
}: {
  request: ApplicationFormRequest;
  applications: Application[];
  templates: TemplateSummary[];
  onClose: () => void;
  onSaved: (app: ApplicationDetail) => Promise<void>;
}) {
  const original = request.mode === "new" ? null : request.application;
  const [company, setCompany] = useState(original?.company ?? "");
  const [role, setRole] = useState(original?.role ?? "");
  const [status, setStatus] = useState<ApplicationStatus>(
    request.mode === "edit" ? request.application.status : "Entwurf",
  );
  const [posting, setPosting] = useState(original?.posting ?? "");
  const [notes, setNotes] = useState(original?.notes ?? "");
  const [profile, setProfile] = useState(
    original?.profile ?? preferredProfile(templates[0]?.profiles ?? []),
  );
  const [cvSource, setCvSource] = useState(
    request.mode === "copy" ? "copy" : "master",
  );
  const [coverSource, setCoverSource] = useState(
    request.mode === "copy" ? "copy" : "neutral",
  );
  const [profiles, setProfiles] = useState<string[]>(
    templates[0]?.profiles ?? [],
  );
  const [documentIds, setDocumentIds] = useState(
    original?.documents.map((d) => d.id) ?? [],
  );
  const [library, setLibrary] = useState(false);
  const [libraryRevision, setLibraryRevision] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [documentBusy, setDocumentBusy] = useState(false);
  const [sourceLoading, setSourceLoading] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    const applyProfiles = (names: string[], preferred?: string) => {
      if (controller.signal.aborted) return;
      setProfiles(names);
      setProfile((current) =>
        names.includes(current) ? current : preferredProfile(names, preferred),
      );
    };
    setSourceLoading(false);
    if (request.mode === "edit" || cvSource === "copy") {
      applyProfiles(
        original?.files.flatMap(
          (f) => /^cv\/profiles\/([\w-]+)\.lua$/.exec(f.name)?.[1] ?? [],
        ) ?? [],
        original?.profile,
      );
    } else if (cvSource === "master") {
      applyProfiles(templates[0]?.profiles ?? []);
    } else {
      setSourceLoading(true);
      void api<ApplicationDetail>(
        `/applications/${cvSource}`,
        "GET",
        undefined,
        controller.signal,
      )
        .then((a) =>
          applyProfiles(
            a.files.flatMap(
              (f) => /^cv\/profiles\/([\w-]+)\.lua$/.exec(f.name)?.[1] ?? [],
            ),
            a.profile,
          ),
        )
        .catch((e) => {
          if (!controller.signal.aborted) setError(errorMessage(e));
        })
        .finally(() => {
          if (!controller.signal.aborted) setSourceLoading(false);
        });
    }
    return () => controller.abort();
  }, [cvSource, request.mode, original, templates]);
  const choices = applications.map((a) => ({
    value: a.id,
    label: `${a.company} · ${a.role}`,
  }));
  const title =
    request.mode === "new"
      ? "Neue Bewerbung"
      : request.mode === "copy"
        ? "Bewerbung kopieren"
        : "Bewerbungsdetails";
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (
      busy ||
      documentBusy ||
      sourceLoading ||
      !company.trim() ||
      !role.trim()
    )
      return;
    setBusy(true);
    setError("");
    try {
      const facts = {
        company: company.trim(),
        role: role.trim(),
        status,
        posting,
        notes,
        profile:
          request.mode === "edit"
            ? profile || undefined
            : profiles.includes(profile)
              ? profile
              : undefined,
        documentIds,
      };
      let result: ApplicationDetail;
      if (request.mode === "edit") {
        result = await api<ApplicationDetail>(
          `/applications/${request.application.id}`,
          "PATCH",
          { ...facts, revision: request.application.revision },
        );
      } else {
        const body: NewApplication = {
          ...facts,
          ...(cvSource === "copy" && original
            ? { source: original.id }
            : cvSource !== "master"
              ? { cvSource }
              : templates[0]
                ? { template: templates[0].id }
                : {}),
          coverSource:
            coverSource === "copy" && original
              ? original.id
              : coverSource === "neutral"
                ? ""
                : coverSource,
        };
        result = await api<ApplicationDetail>("/applications", "POST", body);
      }
      await onSaved(result);
      onClose();
    } catch (e) {
      setError(errorMessage(e));
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
      <DialogPopup className="max-w-2xl" showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {request.mode === "edit"
              ? "Daten und ausgewählte Anlagen dieser Bewerbung bearbeiten."
              : "Erst beim Anlegen wird eine unabhängige Bewerbung erstellt. Eine Kopie übernimmt keine KI-Sitzung."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex min-h-0 flex-col">
          <DialogPanel>
            <ErrorNotice error={error} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Unternehmen *">
                <Input
                  aria-label="Unternehmen"
                  required
                  autoFocus
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                />
              </Field>
              <Field label="Rolle *">
                <Input
                  aria-label="Rolle"
                  required
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Status">
                <Choice
                  label="Status"
                  value={status}
                  onChange={(v) => setStatus(v as ApplicationStatus)}
                  options={APPLICATION_STATUSES.map((s) => ({
                    value: s,
                    label: s,
                  }))}
                />
              </Field>
              <Field label="Profil">
                <Choice
                  label="Profil"
                  value={profile}
                  onChange={setProfile}
                  options={[...new Set([profile, ...profiles])].map((p) => ({
                    value: p,
                    label: p || "Standardprofil",
                  }))}
                />
              </Field>
            </div>
            <Field label="Stellenausschreibung / URL">
              <Textarea
                aria-label="Stellenausschreibung / URL"
                rows={3}
                value={posting}
                onChange={(e) => setPosting(e.target.value)}
                placeholder="Link oder Text der Ausschreibung"
              />
            </Field>
            <Field label="Notizen (optional)">
              <Textarea
                aria-label="Notizen"
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </Field>
            {request.mode !== "edit" && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Lebenslauf als Ausgangspunkt">
                  <Choice
                    label="Lebenslauf als Ausgangspunkt"
                    value={cvSource}
                    onChange={(next) => {
                      setProfile("");
                      setCvSource(next);
                    }}
                    options={[
                      ...(request.mode === "copy"
                        ? [
                            {
                              value: "copy",
                              label: `Kopie: ${original?.company}`,
                            },
                          ]
                        : []),
                      { value: "master", label: "Neuester Master" },
                      ...choices,
                    ]}
                  />
                </Field>
                <Field label="Anschreiben als Ausgangspunkt">
                  <Choice
                    label="Anschreiben als Ausgangspunkt"
                    value={coverSource}
                    onChange={setCoverSource}
                    options={[
                      ...(request.mode === "copy"
                        ? [
                            {
                              value: "copy",
                              label: `Kopie: ${original?.company}`,
                            },
                          ]
                        : []),
                      { value: "neutral", label: "Neutraler Ausgangspunkt" },
                      ...choices,
                    ]}
                  />
                </Field>
              </div>
            )}
            <section className="space-y-2 border-t border-border/60 pt-4">
              <h2 className="text-sm font-medium">Zeugnisse und Anlagen</h2>
              <DocumentLibrary
                selected={documentIds}
                onSelectionChange={setDocumentIds}
                onLibrary={() => setLibrary(true)}
                refreshKey={libraryRevision}
                onBusyChange={setDocumentBusy}
              />
            </section>
          </DialogPanel>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={onClose}
            >
              Abbrechen
            </Button>
            <Button
              type="submit"
              disabled={
                busy ||
                documentBusy ||
                sourceLoading ||
                !company.trim() ||
                !role.trim()
              }
            >
              {busy
                ? "Speichern…"
                : request.mode === "edit"
                  ? "Änderungen speichern"
                  : "Bewerbung anlegen"}
            </Button>
          </DialogFooter>
        </form>
        <LibraryDialog
          open={library}
          onOpenChange={(open) => {
            setLibrary(open);
            if (!open) setLibraryRevision((n) => n + 1);
          }}
        />
      </DialogPopup>
    </Dialog>
  );
}
