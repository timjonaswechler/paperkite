import { useEffect, useRef, useState } from "react";
import { Download, Eye, FileText, Pencil, Trash2, Upload, Files } from "lucide-react";
import type { LibraryDocument } from "~/bewerbung/shared/api";
import { api, base, errorMessage, requireBusiness } from "../api";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Checkbox } from "~/components/ui/checkbox";
import { Badge } from "~/components/ui/badge";
import { PdfCompositionDialog } from "./PdfCompositionDialog";
import { DocumentTags, parseTags, tagsError } from "./DocumentTags";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogPanel,
} from "~/components/ui/dialog";
import { Choice, ErrorNotice, IconButton } from "./Controls";

export async function uploadLibraryDocument(file: File): Promise<LibraryDocument> {
  requireBusiness(file.size <= 25 * 1024 * 1024, `${file.name}: maximal 25 MiB je Datei.`);
  const response = await fetch(base + "/documents", {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "X-Bewerbung-Request": "1",
      "X-Bewerbung-Filename": encodeURIComponent(file.name),
    },
    body: file,
  });
  const document = await response.json();
  requireBusiness(response.ok, document.error || response.statusText);
  return document as LibraryDocument;
}
export const formatBytes = (bytes: number) =>
  bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
export function DocumentPreview({
  document,
  onClose,
}: {
  document: LibraryDocument | null;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={Boolean(document)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPopup className="max-w-4xl h-[85dvh]">
        <DialogHeader>
          <DialogTitle>{document?.label}</DialogTitle>
          <DialogDescription>
            Eigene Datei · {document && formatBytes(document.bytes)}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 px-6 pb-6">
          {document &&
            (document.mime === "application/pdf" ? (
              <object
                className="h-full w-full rounded-lg"
                aria-label="Dokumentvorschau"
                type="application/pdf"
                data={`${base}/documents/${document.id}/file`}
              >
                <a href={`${base}/documents/${document.id}/file`} target="_blank" rel="noreferrer">
                  Vorschau öffnen
                </a>
              </object>
            ) : (
              <img
                className="h-full w-full object-contain"
                src={`${base}/documents/${document.id}/file`}
                alt={document.label}
              />
            ))}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            render={<a href={`${base}/documents/${document?.id}/file?download=1`} />}
          >
            <Download />
            Herunterladen
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
export function DocumentLibrary({
  selected,
  onSelectionChange,
  onLibrary,
  onBusyChange,
  refreshKey = 0,
}: {
  selected?: string[];
  onSelectionChange?: (ids: string[]) => void;
  onLibrary?: () => void;
  onBusyChange?: (busy: boolean) => void;
  refreshKey?: number;
}) {
  const [documents, setDocuments] = useState<LibraryDocument[]>([]);
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState("");
  const [tags, setTags] = useState("");
  const [composeIds, setComposeIds] = useState<string[]>([]);
  const [composing, setComposing] = useState<LibraryDocument[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<LibraryDocument | null>(null);
  const [renaming, setRenaming] = useState<LibraryDocument | null>(null);
  const [label, setLabel] = useState("");
  const [removing, setRemoving] = useState<LibraryDocument | null>(null);
  const [reload, setReload] = useState(0);
  const uploadRef = useRef<HTMLInputElement>(null);
  function changeBusy(next: boolean) {
    setBusy(next);
    onBusyChange?.(next);
  }
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- fetches the central document library with cancellation on reload or unmount
  useEffect(() => {
    void reload;
    void refreshKey;
    const controller = new AbortController();
    void api<LibraryDocument[]>("/documents", "GET", undefined, controller.signal)
      .then(setDocuments)
      .catch((e) => {
        if (!controller.signal.aborted) setError(errorMessage(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- explicit reload tokens invalidate the external API snapshot
  }, [reload, refreshKey]);
  async function upload(files: File[]) {
    setError("");
    changeBusy(true);
    try {
      const added: string[] = [];
      for (const file of files) {
        const document = await uploadLibraryDocument(file);
        added.push(document.id);
        setDocuments((previous) => [
          document,
          ...previous.filter((item) => item.id !== document.id),
        ]);
      }
      if (onSelectionChange) onSelectionChange([...new Set([...(selected ?? []), ...added])]);
    } catch (e) {
      setError(errorMessage(e));
    }

    changeBusy(false);
    setReload((n) => n + 1);
  }
  const allTags = [...new Set(documents.flatMap((document) => document.tags))].sort();
  const matching = documents.filter(
    (d) =>
      (!tag || d.tags.includes(tag)) &&
      `${d.label} ${d.name} ${d.tags.join(" ")}`
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase()),
  );
  const selection = onSelectionChange ? (selected ?? []) : composeIds;
  const changeSelection = onSelectionChange ?? setComposeIds;
  return (
    <div className="space-y-3" data-document-library>
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-40 flex-1">
          <Input
            type="search"
            aria-label="Eigene Dateien durchsuchen"
            placeholder="Dateien oder Tags durchsuchen…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => uploadRef.current?.click()}
        >
          <Upload />
          {busy ? "Hochladen…" : "Hochladen"}
        </Button>
        {onLibrary && (
          <Button type="button" variant="ghost" size="sm" onClick={onLibrary}>
            Bibliothek
          </Button>
        )}
        <input
          ref={uploadRef}
          type="file"
          className="hidden"
          aria-label="Zeugnisse hochladen"
          accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
          multiple
          onChange={(e) => {
            void upload(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Choice
          label="Nach Tag filtern"
          value={tag}
          onChange={setTag}
          options={[
            { value: "", label: "Alle Tags" },
            ...[...new Set([...allTags, ...(tag ? [tag] : [])])].map((value) => ({
              value,
              label: value,
            })),
          ]}
        />
        {!onSelectionChange && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-auto min-h-8 max-w-full whitespace-normal"
            disabled={busy || !documents.some((document) => composeIds.includes(document.id))}
            onClick={() =>
              setComposing(documents.filter((document) => composeIds.includes(document.id)))
            }
          >
            <Files />
            Zusammenfügen / optimieren (
            {documents.filter((document) => composeIds.includes(document.id)).length})
          </Button>
        )}
      </div>
      {!onSelectionChange && (
        <Button variant="ghost" size="sm" onClick={() => setComposing([])}>
          Bisherige PDF-Aufträge
        </Button>
      )}
      <ErrorNotice error={error} onClose={() => setError("")} />
      {loading ? (
        <p className="text-sm text-muted-foreground" role="status">
          Dateien werden geladen…
        </p>
      ) : !matching.length ? (
        <p className="py-4 text-sm text-muted-foreground">
          {query || tag
            ? "Keine passenden Dateien."
            : "Noch keine Zeugnisse oder Anlagen. Einmal hochladen, in mehreren Bewerbungen verwenden."}
        </p>
      ) : (
        <ul className="max-h-72 overflow-auto divide-y divide-border/50 rounded-lg border border-border/60">
          {matching.map((document) => (
            <li key={document.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
              <Checkbox
                aria-label={`${document.label} auswählen`}
                disabled={busy}
                checked={selection.includes(document.id)}
                onCheckedChange={(checked) =>
                  changeSelection(
                    checked
                      ? [...new Set([...selection, document.id])]
                      : selection.filter((id) => id !== document.id),
                  )
                }
              />
              <FileText className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{document.label}</p>
                <p className="text-xs text-muted-foreground">
                  {formatBytes(document.bytes)} ·{" "}
                  {document.mime === "application/pdf"
                    ? "PDF"
                    : document.mime === "image/png"
                      ? "PNG"
                      : "JPG"}
                  {!onSelectionChange && ` · ${document.usedBy} Bewerbungen`}
                </p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {document.tags.map((value) => (
                    <Badge key={value} variant="secondary" size="sm">
                      {value}
                    </Badge>
                  ))}
                </div>
              </div>
              <div
                className={
                  onSelectionChange
                    ? "flex shrink-0 items-center"
                    : "flex shrink-0 items-center gap-1 max-sm:w-full max-sm:justify-end"
                }
              >
                <IconButton
                  label={`${document.label} ansehen`}
                  onClick={() => setPreview(document)}
                >
                  <Eye />
                </IconButton>
                {!onSelectionChange && (
                  <>
                    <IconButton
                      label={`${document.label} herunterladen`}
                      render={<a href={`${base}/documents/${document.id}/file?download=1`} />}
                    >
                      <Download />
                    </IconButton>
                    <IconButton
                      label={`${document.label} umbenennen`}
                      onClick={() => {
                        setRenaming(document);
                        setLabel(document.label);
                        setTags(document.tags.join(", "));
                      }}
                    >
                      <Pencil />
                    </IconButton>
                    <IconButton
                      label={`${document.label} optimieren`}
                      disabled={busy}
                      onClick={() => setComposing([document])}
                    >
                      <Files />
                    </IconButton>
                    <IconButton
                      label={`${document.label} entfernen`}
                      onClick={() => setRemoving(document)}
                    >
                      <Trash2 />
                    </IconButton>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">
        PDF, JPG oder PNG · maximal 25 MiB je Datei
        {onSelectionChange &&
          ` · ${selected?.length ?? 0} ausgewählt (maximal 100 MiB je Bewerbung)`}
      </p>
      {composing && (
        <PdfCompositionDialog
          documents={composing}
          onClose={() => setComposing(null)}
          onSaved={() => setReload((n) => n + 1)}
        />
      )}
      <DocumentPreview document={preview} onClose={() => setPreview(null)} />
      <Dialog
        open={Boolean(renaming)}
        onOpenChange={(open) => {
          if (!open && !busy) setRenaming(null);
        }}
      >
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>Dateibezeichnung und Tags ändern</DialogTitle>
            <DialogDescription>
              Der Inhalt und bestehende Build-Snapshots bleiben unverändert.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <Input
              aria-label="Dateibezeichnung"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              disabled={busy}
            />
            <DocumentTags value={tags} onChange={setTags} disabled={busy} />
          </DialogPanel>
          <DialogFooter>
            <Button variant="ghost" disabled={busy} onClick={() => setRenaming(null)}>
              Abbrechen
            </Button>
            <Button
              disabled={!label.trim() || busy || Boolean(tagsError(tags))}
              onClick={async () => {
                if (!renaming) return;
                changeBusy(true);
                try {
                  await api(`/documents/${renaming.id}`, "PATCH", {
                    label: label.trim(),
                    tags: parseTags(tags),
                  });
                  setRenaming(null);
                  setReload((n) => n + 1);
                } catch (e) {
                  setRenaming(null);
                  setError(errorMessage(e));
                }

                changeBusy(false);
              }}
            >
              Speichern
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
      <Dialog
        open={Boolean(removing)}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
      >
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>Datei entfernen?</DialogTitle>
            <DialogDescription>
              „{removing?.label}“ wird aus der zentralen Bibliothek entfernt. Verwendete Dateien
              können nicht entfernt werden.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRemoving(null)}>
              Abbrechen
            </Button>
            <Button
              variant="destructive-outline"
              disabled={busy}
              onClick={async () => {
                if (!removing) return;
                changeBusy(true);
                try {
                  await api(`/documents/${removing.id}`, "DELETE", {});
                  setRemoving(null);
                  setReload((n) => n + 1);
                } catch (e) {
                  setRemoving(null);
                  setError(errorMessage(e));
                }

                changeBusy(false);
              }}
            >
              Datei entfernen
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </div>
  );
}
export function LibraryDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Eigene Dateien</DialogTitle>
          <DialogDescription>
            Zentrale Zeugnisse und Anlagen. Einmal hochladen, pro Bewerbung auswählen.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>{open && <DocumentLibrary />}</DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
