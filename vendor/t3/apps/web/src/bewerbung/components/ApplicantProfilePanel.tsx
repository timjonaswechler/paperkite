import { useEffect, useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import { useApplications } from "../ApplicationsProvider";
import { api, base, errorMessage } from "../api";
import type {
  ApplicantBindings,
  ApplicationApplicantProfile,
  ApplicationDetail,
} from "../shared/api";
import { applicantVariables, sameApplicantProfile } from "../shared/applicant-profile";
import { ApplicantProfileEditor } from "./ApplicantProfileEditor";
import { ErrorNotice } from "./Controls";

export function ApplicantProfilePanel({
  app,
  bindings,
  dirty,
  busy: documentBusy = false,
  onApplied,
}: {
  app: ApplicationDetail;
  bindings: ApplicantBindings | undefined;
  dirty: boolean;
  busy?: boolean;
  onApplied: (signal: AbortSignal) => Promise<void>;
}) {
  const applications = useApplications();
  const [state, setState] = useState<ApplicationApplicantProfile | null>(null);
  const [editing, setEditing] = useState(false);
  const [signatureFocus, setSignatureFocus] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const action = useRef<AbortController | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- loads the selected application's frozen profile without changing its document draft
  useEffect(() => {
    const controller = new AbortController();
    void api<ApplicationApplicantProfile>(
      `/applications/${app.id}/applicant-profile`,
      "GET",
      undefined,
      controller.signal,
    )
      .then(setState)
      .catch((e) => {
        if (!controller.signal.aborted) setError(errorMessage(e));
      });
    return () => {
      controller.abort();
      action.current?.abort();
    };
  }, [app.id]);
  const current = applications.settings?.applicantProfile || state?.current;
  const missingSignature = Boolean(
    state && bindings?.signature === "required" && !state.profile?.signatureId,
  );
  const changed = Boolean(
    state && current && (!state.profile || !sameApplicantProfile(state.profile, current)),
  );
  const readonly = app.status === "Gesendet" || app.harness.busy;
  const disabled = busy || documentBusy || dirty || readonly || !state;
  async function adopt(signatureOnly: boolean) {
    if (disabled) return;
    if (
      !signatureOnly &&
      state?.profile &&
      !confirm(
        "Aktuelles Bewerberprofil für diese Bewerbung übernehmen? Name, Adresse und Unterschrift werden bewusst aktualisiert. Bestehende PDFs bleiben unverändert; anschließend bei Bedarf neu bauen.",
      )
    )
      return;
    const controller = new AbortController();
    action.current = controller;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const next = await api<ApplicationApplicantProfile>(
        `/applications/${app.id}/applicant-profile`,
        "POST",
        { revision: app.revision, signatureOnly },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setState(next);
      await onApplied(controller.signal);
      setNotice(
        signatureOnly
          ? "Gespeicherte Unterschrift übernommen. Dokument bei Bedarf neu bauen."
          : "Bewerberprofil übernommen. Dokument bei Bedarf neu bauen.",
      );
    } catch (e) {
      if (!controller.signal.aborted) setError(errorMessage(e));
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  const variables = state?.profile ? applicantVariables(state.profile) : null;
  return (
    <section
      aria-label="Bewerberprofil dieser Bewerbung"
      className="min-w-0 space-y-3 rounded-lg border p-3"
    >
      <h3 className="text-sm font-medium">Bewerberprofil dieser Bewerbung</h3>
      <ErrorNotice error={error} onClose={() => setError("")} />
      {variables ? (
        <p className="whitespace-pre-wrap text-sm">
          {variables.sender || "Noch keine persönlichen Daten erfasst."}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">Noch kein Bewerberprofil übernommen.</p>
      )}
      {!bindings && (
        <p className="text-xs text-muted-foreground">
          Dieses Layout hat noch keine zentralen Profilbindungen. Die persönlichen Angaben im
          Dokument prüfen; für automatische Platzierung einen entsprechend angebundenen Layout-Mod
          verwenden.
        </p>
      )}
      {changed && (
        <p className="text-xs text-muted-foreground">
          Das zentrale Profil hat einen anderen Stand. Diese Bewerbung wurde nicht automatisch
          geändert.
        </p>
      )}
      {bindings && bindings.signature !== "none" && state?.signature && (
        <img
          src={`${base}/applicant-signatures/${state.signature.id}`}
          alt="Unterschrift dieser Bewerbung"
          className="max-h-20 max-w-full rounded-md border bg-white p-2"
        />
      )}
      {missingSignature && (
        <p role="status" className="text-sm">
          Diese Vorlage benötigt eine Unterschrift. Eine gespeicherte Unterschrift übernehmen oder
          sie jetzt hochladen bzw. selbst zeichnen.
        </p>
      )}
      {dirty && (
        <p className="text-xs text-muted-foreground">
          Dokumentänderungen zuerst speichern. Deine Eingaben bleiben erhalten; anschließend kannst
          du Profil oder Unterschrift übernehmen.
        </p>
      )}
      {!readonly && (
        <div className="flex flex-wrap gap-2">
          {changed && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={disabled}
              onClick={() => void adopt(false)}
            >
              {state?.profile ? "Aktuelles Bewerberprofil übernehmen" : "Bewerberprofil übernehmen"}
            </Button>
          )}
          {current?.signatureId && current.signatureId !== state?.profile?.signatureId && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={disabled}
              onClick={() => void adopt(true)}
            >
              Gespeicherte Unterschrift übernehmen
            </Button>
          )}
          {!editing && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy || documentBusy}
              onClick={() => {
                setSignatureFocus(missingSignature);
                setEditing(true);
              }}
            >
              {missingSignature
                ? "Unterschrift hochladen oder zeichnen"
                : "Zentrales Profil bearbeiten"}
            </Button>
          )}
        </div>
      )}
      {editing && applications.settings && (
        <ApplicantProfileEditor
          settings={applications.settings}
          focusSignature={signatureFocus}
          onClose={() => setEditing(false)}
          onSaved={async () => {
            const fresh = await api<ApplicationApplicantProfile>(
              `/applications/${app.id}/applicant-profile`,
            );
            setState(fresh);
            setNotice(
              "Zentrales Profil gespeichert. Für diese Bewerbung anschließend bewusst übernehmen.",
            );
          }}
        />
      )}
      <p role="status" className="text-xs text-muted-foreground">
        {notice}
      </p>
    </section>
  );
}
