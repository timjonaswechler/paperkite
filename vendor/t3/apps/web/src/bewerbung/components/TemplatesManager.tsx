import { useState } from "react";
import { Copy, Download, Pencil, Plus, Star, Trash2 } from "lucide-react";
import type { Application, TemplateSummary } from "~/bewerbung/shared/api";
import { api, base, errorMessage } from "../api";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import { Input } from "~/components/ui/input";
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

type Action =
  | { kind: "rename" | "copy" | "delete"; template: TemplateSummary }
  | { kind: "snapshot" };
export function TemplatesManager({
  templates,
  applications,
  onChanged,
}: {
  templates: TemplateSummary[];
  applications: Application[];
  onChanged: () => Promise<void>;
}) {
  const [action, setAction] = useState<Action | null>(null);
  const [label, setLabel] = useState("");
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dialogError, setDialogError] = useState("");
  const [notice, setNotice] = useState("");
  function start(next: Action) {
    setAction(next);
    setDialogError("");
    setLabel(
      next.kind === "snapshot"
        ? ""
        : next.kind === "copy"
          ? `${next.template.label} – Kopie`
          : next.template.label,
    );
    setSource("");
  }
  async function save() {
    if (!action || busy) return;
    setBusy(true);
    setDialogError("");
    setNotice("");
    try {
      if (action.kind === "snapshot")
        await api("/templates/from-application", "POST", {
          source,
          label: label.trim(),
        });
      else if (action.kind === "delete")
        await api(`/templates/${action.template.id}`, "DELETE", {
          digest: action.template.digest,
        });
      else if (action.kind === "copy")
        await api(`/templates/${action.template.id}/copy`, "POST", {
          label: label.trim(),
        });
      else
        await api(`/templates/${action.template.id}`, "PATCH", {
          label: label.trim(),
        });
      setAction(null);
      await onChanged();
      setNotice("Vorlagen aktualisiert. Bestehende Bewerbungen bleiben unverändert.");
    } catch (e) {
      setDialogError(errorMessage(e));
      setError(errorMessage(e));
    }

    setBusy(false);
  }
  return (
    <section className="space-y-4" aria-label="Vorlagen verwalten">
      <ErrorNotice error={error} onClose={() => setError("")} />
      <div className="space-y-2">
        <Button
          variant="outline"
          className="h-auto min-h-8 max-w-full whitespace-normal"
          disabled={busy || !applications.length}
          onClick={() => start({ kind: "snapshot" })}
        >
          <Plus />
          Aus Bewerbung als Vorlage speichern
        </Button>
        <p className="text-xs text-muted-foreground">
          Quellen zuerst in einer Bewerbung bearbeiten, dann einen neuen unveränderlichen Master
          speichern. Vorhandene Bewerbungen bleiben unabhängig. Chat, KI-Sitzungen und Status werden
          nicht übernommen.
        </p>
      </div>
      <ul className="space-y-3">
        {templates.map((template) => (
          <li
            key={template.id}
            className="space-y-3 rounded-xl border border-border/60 p-4 text-sm"
          >
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="min-w-0 break-words font-medium">{template.label}</h3>
              {template.isDefault && <Badge variant="secondary">Standard</Badge>}
            </div>
            <p className="text-xs text-muted-foreground">
              {new Date(template.created).toLocaleString("de-DE")} · Gesicherte LaTeX-Quellen
            </p>
            <div className="flex flex-wrap gap-1">
              <Button
                size="xs"
                variant="ghost"
                disabled={busy}
                aria-label={`${template.label} umbenennen`}
                onClick={() => start({ kind: "rename", template })}
              >
                <Pencil />
                Umbenennen
              </Button>
              <Button
                size="xs"
                variant="ghost"
                disabled={busy || template.isDefault}
                aria-label={`${template.label} als Standard setzen`}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  setNotice("");
                  try {
                    await api(`/templates/${template.id}/default`, "POST", {});
                    await onChanged();
                    setNotice("Standardvorlage für neue Bewerbungen gesetzt.");
                  } catch (e) {
                    setError(errorMessage(e));
                  }

                  setBusy(false);
                }}
              >
                <Star />
                Als Standard
              </Button>
              <Button
                size="xs"
                variant="ghost"
                disabled={busy}
                aria-label={`${template.label} duplizieren`}
                onClick={() => start({ kind: "copy", template })}
              >
                <Copy />
                Duplizieren
              </Button>
              <Button
                size="xs"
                variant="ghost"
                render={<a href={`${base}/templates/${template.id}/export`} />}
                aria-label={`${template.label} als JSON exportieren`}
              >
                <Download />
                Quell-JSON
              </Button>
              <Button
                size="xs"
                variant="destructive-outline"
                disabled={busy}
                aria-label={`${template.label} löschen`}
                onClick={() => start({ kind: "delete", template })}
              >
                <Trash2 />
                Löschen
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {!templates.length && (
        <p className="text-sm text-muted-foreground">
          Noch keine Vorlage. Speichere eine Bewerbung als Master oder importiere eine JSON-Datei.
        </p>
      )}
      {notice && (
        <p role="status" className="text-xs text-muted-foreground">
          {notice}
        </p>
      )}
      <Dialog
        open={Boolean(action)}
        onOpenChange={(open) => {
          if (!open && !busy) setAction(null);
        }}
      >
        <DialogPopup showCloseButton={!busy}>
          <DialogHeader>
            <DialogTitle>
              {action?.kind === "snapshot"
                ? "Neue Vorlage aus Bewerbung"
                : action?.kind === "delete"
                  ? "Vorlage löschen"
                  : action?.kind === "copy"
                    ? "Vorlage duplizieren"
                    : "Vorlage umbenennen"}
            </DialogTitle>
            <DialogDescription>
              {action?.kind === "delete"
                ? `„${action.template.label}“ dauerhaft löschen? Bestehende Bewerbungen und deren Quellen bleiben erhalten.`
                : "Ein Master ist ein unveränderlicher Quell-Snapshot. Nur seine Bezeichnung und die Standardauswahl sind veränderbar."}
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <ErrorNotice error={dialogError} />
            {action?.kind === "snapshot" && (
              <Field label="Quellbewerbung">
                <Choice
                  label="Quellbewerbung"
                  value={source}
                  disabled={busy}
                  onChange={setSource}
                  options={[
                    { value: "", label: "Bewerbung wählen…" },
                    ...applications.map((app) => ({
                      value: app.id,
                      label: `${app.company} · ${app.role}`,
                    })),
                  ]}
                />
              </Field>
            )}
            {action?.kind !== "delete" && (
              <Field label="Vorlagenname">
                <Input
                  aria-label="Vorlagenname"
                  maxLength={200}
                  autoFocus
                  disabled={busy}
                  value={label}
                  onChange={(event) => setLabel(event.target.value)}
                />
              </Field>
            )}
            {action?.kind === "snapshot" && (
              <p className="text-xs text-muted-foreground">
                Die Quellbewerbung darf gerade keine aktiven Arbeiten ausführen. Für andere Inhalte
                erst die Quellen dort bearbeiten und danach einen weiteren Master speichern.
              </p>
            )}
          </DialogPanel>
          <DialogFooter>
            <Button variant="ghost" disabled={busy} onClick={() => setAction(null)}>
              Abbrechen
            </Button>
            <Button
              variant={action?.kind === "delete" ? "destructive-outline" : "default"}
              disabled={
                busy ||
                (action?.kind !== "delete" && !label.trim()) ||
                (action?.kind === "snapshot" && !source)
              }
              onClick={() => void save()}
            >
              {busy
                ? "Speichern…"
                : action?.kind === "delete"
                  ? "Vorlage löschen"
                  : "Vorlage speichern"}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </section>
  );
}
