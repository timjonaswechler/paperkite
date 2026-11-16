import { useEffect, useRef, useState } from "react";
import { Download, Eye, FileText, Pencil, Trash2, Upload } from "lucide-react";
import type { LibraryDocument } from "../../shared/api";
import { api, base, errorMessage } from "../api";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Checkbox } from "./ui/checkbox";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogPanel,
} from "./ui/dialog";
import { ErrorNotice, IconButton } from "./Controls";

export const formatBytes = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${Math.ceil(bytes / 1024)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
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
                <a
                  href={`${base}/documents/${document.id}/file`}
                  target="_blank"
                  rel="noreferrer"
                >
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
            render={
              <a href={`${base}/documents/${document?.id}/file?download=1`} />
            }
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
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<LibraryDocument | null>(null);
  const [renaming, setRenaming] = useState<LibraryDocument | null>(null);
  const [label, setLabel] = useState("");
  const [removing, setRemoving] = useState<LibraryDocument | null>(null);
  const [reload, setReload] = useState(0);
  const uploadRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void api<LibraryDocument[]>(
      "/documents",
      "GET",
      undefined,
      controller.signal,
    )
      .then(setDocuments)
      .catch((e) => {
        if (!controller.signal.aborted) setError(errorMessage(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [reload, refreshKey]);
  async function upload(files: File[]) {
    setError("");
    setBusy(true);
    try {
      const added: string[] = [];
      for (const file of files) {
        if (file.size > 25 * 1024 * 1024)
          throw new Error(`${file.name}: maximal 25 MiB je Datei.`);
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
        if (!response.ok)
          throw new Error(document.error || response.statusText);
        added.push(document.id);
        setDocuments((previous) => [
          document,
          ...previous.filter((item) => item.id !== document.id),
        ]);
      }
      if (onSelectionChange)
        onSelectionChange([...new Set([...(selected ?? []), ...added])]);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
      setReload((n) => n + 1);
    }
  }
  const matching = documents.filter((d) =>
    `${d.label} ${d.name}`
      .toLocaleLowerCase()
      .includes(query.toLocaleLowerCase()),
  );
  return (
    <div className="space-y-3" data-document-library>
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-40 flex-1">
          <Input
            type="search"
            aria-label="Eigene Dateien durchsuchen"
            placeholder="Zeugnisse und Anlagen durchsuchen…"
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
      <ErrorNotice error={error} onClose={() => setError("")} />
      {loading ? (
        <p className="text-sm text-muted-foreground" role="status">
          Dateien werden geladen…
        </p>
      ) : !matching.length ? (
        <p className="py-4 text-sm text-muted-foreground">
          {query
            ? "Keine passenden Dateien."
            : "Noch keine Zeugnisse oder Anlagen. Einmal hochladen, in mehreren Bewerbungen verwenden."}
        </p>
      ) : (
        <ul className="max-h-72 overflow-auto divide-y divide-border/50 rounded-lg border border-border/60">
          {matching.map((document) => (
            <li key={document.id} className="flex items-center gap-3 px-3 py-2">
              {onSelectionChange && (
                <Checkbox
                  aria-label={`${document.label} auswählen`}
                  disabled={busy}
                  checked={selected?.includes(document.id) ?? false}
                  onCheckedChange={(checked) =>
                    onSelectionChange(
                      checked
                        ? [...new Set([...(selected ?? []), document.id])]
                        : (selected ?? []).filter((id) => id !== document.id),
                    )
                  }
                />
              )}
              <FileText className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm" title={document.label}>
                  {document.label}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatBytes(document.bytes)} ·{" "}
                  {document.mime === "application/pdf"
                    ? "PDF"
                    : document.mime === "image/png"
                      ? "PNG"
                      : "JPG"}
                  {!onSelectionChange && ` · ${document.usedBy} Bewerbungen`}
                </p>
              </div>
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
                    render={
                      <a
                        href={`${base}/documents/${document.id}/file?download=1`}
                      />
                    }
                  >
                    <Download />
                  </IconButton>
                  <IconButton
                    label={`${document.label} umbenennen`}
                    onClick={() => {
                      setRenaming(document);
                      setLabel(document.label);
                    }}
                  >
                    <Pencil />
                  </IconButton>
                  <IconButton
                    label={`${document.label} entfernen`}
                    onClick={() => setRemoving(document)}
                  >
                    <Trash2 />
                  </IconButton>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">
        PDF, JPG oder PNG · maximal 25 MiB je Datei
        {onSelectionChange &&
          ` · ${selected?.length ?? 0} ausgewählt (maximal 100 MiB je Bewerbung)`}
      </p>
      <DocumentPreview document={preview} onClose={() => setPreview(null)} />
      <Dialog
        open={Boolean(renaming)}
        onOpenChange={(open) => {
          if (!open) setRenaming(null);
        }}
      >
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>Dateibezeichnung ändern</DialogTitle>
            <DialogDescription>
              Der Inhalt und bestehende Build-Snapshots bleiben unverändert.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <Input
              aria-label="Dateibezeichnung"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </DialogPanel>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRenaming(null)}>
              Abbrechen
            </Button>
            <Button
              disabled={!label.trim() || busy}
              onClick={async () => {
                if (!renaming) return;
                setBusy(true);
                try {
                  await api(`/documents/${renaming.id}`, "PATCH", {
                    label: label.trim(),
                  });
                  setRenaming(null);
                  setReload((n) => n + 1);
                } catch (e) {
                  setRenaming(null);
                  setError(errorMessage(e));
                } finally {
                  setBusy(false);
                }
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
              „{removing?.label}“ wird aus der zentralen Bibliothek entfernt.
              Verwendete Dateien können nicht entfernt werden.
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
                setBusy(true);
                try {
                  await api(`/documents/${removing.id}`, "DELETE", {});
                  setRemoving(null);
                  setReload((n) => n + 1);
                } catch (e) {
                  setRemoving(null);
                  setError(errorMessage(e));
                } finally {
                  setBusy(false);
                }
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
            Zentrale Zeugnisse und Anlagen. Einmal hochladen, pro Bewerbung
            auswählen.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>{open && <DocumentLibrary />}</DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
