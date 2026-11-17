import { useEffect, useState } from "react";
import {
  type Application,
  type ApplicationDetail,
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
  const [posting, setPosting] = useState(original?.posting ?? "");
  const [notes, setNotes] = useState(original?.notes ?? "");
  const master =
    templates.find((template) => template.isDefault) ?? templates[0];
  const [profile, setProfile] = useState(
    original?.profile ??
      preferredProfile(master?.profiles ?? [], master?.defaultProfile),
  );
  const [cvSource, setCvSource] = useState(
    request.mode === "copy" ? "copy" : "master",
  );
  const [coverSource, setCoverSource] = useState(
    request.mode === "copy" ? "copy" : "neutral",
  );
  const [profiles, setProfiles] = useState<string[]>(master?.profiles ?? []);
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
      setProfile(preferredProfile(names, preferred));
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
      applyProfiles(master?.profiles ?? [], master?.defaultProfile);
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
  }, [cvSource, request.mode, original, master]);
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
        posting,
        notes,
        ...(request.mode === "edit"
          ? { documentIds }
          : {
              status: "Entwurf" as const,
              profile: profiles.includes(profile) ? profile : undefined,
              ...(cvSource === "copy" ? { documentIds } : {}),
            }),
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
              : master
                ? { template: master.id }
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
              <details>
                <summary className="cursor-pointer text-sm text-muted-foreground">
                  Ausgangsbasis (optional)
                </summary>
                <div className="mt-3 grid gap-4 sm:grid-cols-2">
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
                        {
                          value: "master",
                          label: master?.label ?? "Standard-Master",
                        },
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
              </details>
            )}
            {request.mode === "edit" && (
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
            )}
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
