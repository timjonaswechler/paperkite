// T3 ProviderModelPicker trigger/popup, ModelPickerContent lane and ModelListRow presentation.
import { useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import type { Model, Provider } from "../../../shared/api";
import { api, errorMessage } from "../../api";
import { ComposerControl } from "./ComposerControl";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import {
  Command,
  CommandInput,
  CommandItem,
  CommandList,
  CommandPanel,
} from "../ui/command";
import { Button } from "../ui/button";
import { ErrorNotice } from "../Controls";

export function ProviderModelPicker({
  id,
  provider,
  model,
  reportedModel,
  disabled,
  onSelect,
  onLoadingChange,
}: {
  id: string;
  provider: Provider;
  model?: Model;
  reportedModel?: string;
  disabled: boolean;
  onSelect: (provider: Provider, model?: Model) => void;
  onLoadingChange: (loading: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [catalogs, setCatalogs] = useState<Partial<Record<Provider, Model[]>>>(
    {},
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const selectedByProvider = useRef<Partial<Record<Provider, Model>>>({
    ...(model ? { [provider]: model } : {}),
  });
  const pending = useRef(false);
  async function load(next: Provider) {
    if (pending.current) return;
    pending.current = true;
    setLoading(true);
    onLoadingChange(true);
    setError("");
    try {
      const result = await api<{ models: Model[] }>(
        `/applications/${id}/models`,
        "POST",
        { provider: next },
      );
      setCatalogs((old) => ({ ...old, [next]: result.models ?? [] }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      pending.current = false;
      setLoading(false);
      onLoadingChange(false);
    }
  }
  function chooseProvider(next: Provider) {
    if (pending.current || next === provider) return;
    if (model) selectedByProvider.current[provider] = model;
    onSelect(next, selectedByProvider.current[next]);
    setQuery("");
    // /models selects a harness on the server; never probe the other provider without this user action.
    void load(next);
  }
  const providerLabel = provider === "pi" ? "Pi" : "Codex";
  const label = model?.name || model?.id || reportedModel || "Modell wählen";
  const models = (catalogs[provider] ?? []).filter((m) =>
    `${m.name ?? ""} ${m.id} ${m.provider}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (disabled) return;
        setOpen(next);
        if (next) setQuery("");
        if (next && !catalogs[provider]) void load(provider);
      }}
    >
      <PopoverTrigger
        render={
          <ComposerControl
            disabled={disabled}
            aria-label="Modell und Anbieter wählen"
            data-chat-provider-model-picker="true"
            className="group/model-trigger min-w-0 shrink justify-between whitespace-nowrap data-popup-open:bg-accent data-popup-open:text-foreground"
          />
        }
      >
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <span className="text-xs text-muted-foreground">{providerLabel}</span>
          <span
            data-chat-provider-model-picker-label="true"
            className="min-w-0 max-w-56 flex-1 truncate"
          >
            {label}
          </span>
          <ChevronDown className="size-3" />
        </span>
      </PopoverTrigger>
      <PopoverPopup
        side="top"
        align="end"
        padding="none"
        touchBackdrop
        className="before:hidden"
      >
        <div
          className="relative flex max-h-86.5 w-screen max-w-90 flex-row overflow-hidden"
          data-model-picker-content="true"
        >
          <div
            className="w-20 shrink-0 overflow-hidden bg-muted/30"
            aria-label="Anbieter"
            data-model-picker-sidebar="true"
          >
            <div className="relative flex min-h-full flex-col gap-1 p-1">
              {(["pi", "codex"] as const).map((p) => (
                <Button
                  key={p}
                  variant={p === provider ? "secondary" : "ghost"}
                  size="sm"
                  disabled={loading}
                  aria-pressed={p === provider}
                  onClick={() => chooseProvider(p)}
                >
                  {p === "pi" ? "Pi" : "Codex"}
                </Button>
              ))}
            </div>
          </div>
          <div className="flex min-h-56 min-w-0 flex-1 flex-col overflow-hidden border-l border-border/70 bg-muted/40">
            <Command
              items={models.map((m) => `${m.provider}/${m.id}`)}
              mode="none"
              value={query}
              onValueChange={setQuery}
            >
              <CommandInput
                aria-label="Modelle durchsuchen"
                placeholder="Modelle suchen…"
              />
              <CommandPanel>
                <CommandList aria-label={`${providerLabel} Modelle`}>
                  {models.map((m) => (
                    <CommandItem
                      key={`${m.provider}/${m.id}`}
                      value={`${m.provider}/${m.id}`}
                      aria-label={`${m.name || m.id} · ${m.provider}/${m.id}`}
                      onClick={() => {
                        selectedByProvider.current[provider] = m;
                        onSelect(provider, m);
                        setOpen(false);
                      }}
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-2 text-left">
                        <div
                          className="min-w-0 truncate text-sm font-normal leading-snug"
                          title={`${m.provider} / ${m.id}`}
                        >
                          {m.name || m.id}
                        </div>
                        {((model?.id === m.id &&
                          model.provider === m.provider) ||
                          (!model &&
                            (reportedModel === m.id ||
                              reportedModel === `${m.provider}/${m.id}`))) && (
                          <Check className="size-3.5 shrink-0" />
                        )}
                        <span className="min-w-0 shrink truncate text-xs text-muted-foreground/70">
                          {m.provider}
                        </span>
                      </div>
                    </CommandItem>
                  ))}
                </CommandList>
              </CommandPanel>
            </Command>
            {loading && (
              <p role="status" className="p-4 text-xs text-muted-foreground">
                Modelle werden geladen…
              </p>
            )}
            {error && (
              <div className="space-y-2 p-3">
                <ErrorNotice error={error} />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void load(provider)}
                >
                  Erneut versuchen
                </Button>
              </div>
            )}
            {!loading && !error && !models.length && (
              <p className="p-4 text-xs text-muted-foreground">
                Keine Modelle gefunden.
              </p>
            )}
          </div>
        </div>
        <p className="border-t border-border/70 px-3 py-2 text-xs leading-snug text-muted-foreground">
          Pi und Codex führen getrennte Sitzungen. Die Auswahl sendet keine
          Nachricht.
        </p>
      </PopoverPopup>
    </Popover>
  );
}
