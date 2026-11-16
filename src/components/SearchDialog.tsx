import { useEffect, useState } from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { APPLICATION_STATUSES, type SearchResult } from "../../shared/api";
import { api, errorMessage } from "../api";
import {
  Command,
  CommandDialog,
  CommandDialogPopup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandPanel,
  CommandFooter,
} from "./ui/command";
import { Choice, ErrorNotice } from "./Controls";
import { Button } from "./ui/button";
export function SearchDialog({
  onClose,
  onOpen,
}: {
  onClose: () => void;
  onOpen: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setResults([]);
    const timer = setTimeout(
      () => {
        void api<SearchResult[]>(
          `/search?q=${encodeURIComponent(query)}${status ? `&status=${encodeURIComponent(status)}` : ""}`,
          "GET",
          undefined,
          controller.signal,
        )
          .then(setResults)
          .catch((e) => {
            if (!controller.signal.aborted) setError(errorMessage(e));
          })
          .finally(() => {
            if (!controller.signal.aborted) setLoading(false);
          });
      },
      query ? 150 : 0,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, status, retry]);
  return (
    <CommandDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <CommandDialogPopup className="max-h-[min(38rem,85dvh)]">
        <DialogPrimitive.Title className="sr-only">
          Bewerbungen suchen
        </DialogPrimitive.Title>
        <DialogPrimitive.Description className="sr-only">
          Unternehmen, Rolle, Notizen und Chat durchsuchen.
        </DialogPrimitive.Description>
        <Command
          items={results.map((r) => r.id)}
          mode="none"
          value={query}
          onValueChange={setQuery}
        >
          <CommandInput
            aria-label="Bewerbungen durchsuchen"
            placeholder="Unternehmen, Rolle oder Chat durchsuchen…"
          />
          <div className="flex items-center gap-2 border-t border-border/50 px-4 py-2">
            <span className="text-xs text-muted-foreground">Status</span>
            <div className="w-40">
              <Choice
                label="Suchstatus"
                value={status}
                onChange={setStatus}
                options={[
                  { value: "", label: "Alle Status" },
                  ...APPLICATION_STATUSES.map((s) => ({ value: s, label: s })),
                ]}
              />
            </div>
          </div>
          <CommandPanel>
            <CommandList aria-label="Suchergebnisse">
              {results.map((result) => (
                <CommandItem
                  key={result.id}
                  value={result.id}
                  onClick={() => {
                    onOpen(result.id);
                    onClose();
                  }}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-medium">
                        {result.company}
                      </span>
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                        {result.status}
                      </span>
                    </div>
                    <p className="truncate text-sm text-foreground/80">
                      {result.role}
                    </p>
                    {result.preview && (
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                        {result.preview}
                      </p>
                    )}
                  </div>
                </CommandItem>
              ))}
            </CommandList>
          </CommandPanel>
        </Command>
        {loading && (
          <p
            role="status"
            className="p-6 text-center text-sm text-muted-foreground"
          >
            Suchen…
          </p>
        )}
        {!loading && !error && !results.length && (
          <p
            role="status"
            className="p-6 text-center text-sm text-muted-foreground"
          >
            Keine Bewerbungen gefunden.
          </p>
        )}
        {error && (
          <div className="space-y-2 p-4">
            <ErrorNotice error={error} />
            <Button variant="outline" onClick={() => setRetry((n) => n + 1)}>
              Erneut versuchen
            </Button>
          </div>
        )}
        <CommandFooter>
          <span className="text-xs">↑ ↓ Auswählen · Enter Öffnen</span>
          <Button variant="ghost" size="xs" onClick={onClose}>
            Esc Schließen
          </Button>
        </CommandFooter>
      </CommandDialogPopup>
    </CommandDialog>
  );
}
