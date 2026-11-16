// Composition and class tokens from T3 ChatComposer/ComposerFooterControls; API boundary is local.
import { useRef, useState } from "react";
import { ShieldCheck } from "lucide-react";
import type { ApplicationDetail, Model, Provider } from "../../../shared/api";
import { api, errorMessage } from "../../api";
import { useDraft } from "../../useDraft";
import {
  ComposerPromptEditorTiptap,
  type ComposerPromptEditorHandle,
} from "../ComposerPromptEditorTiptap";
import { ComposerSurface } from "./ComposerSurface";
import { ComposerPrimaryActions } from "./ComposerPrimaryActions";
import { ProviderModelPicker } from "./ProviderModelPicker";
import { ComposerBanner } from "./ComposerBanner";
import { Button } from "../ui/button";
import { ErrorNotice } from "../Controls";

export function ChatComposer({
  app,
  sendOnEnter,
  onRefresh,
}: {
  app: ApplicationDetail;
  sendOnEnter: boolean;
  onRefresh: () => Promise<void>;
}) {
  const draft = useDraft(app.id);
  const [provider, setProvider] = useState<Provider>(app.harness.provider);
  const [model, setModel] = useState<Model>();
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [approvalBusy, setApprovalBusy] = useState<string[]>([]);
  const editorRef = useRef<ComposerPromptEditorHandle>(null);
  const submitGuard = useRef(false);
  async function submit() {
    const text = editorRef.current?.readSnapshot().value ?? draft.text;
    if (
      submitGuard.current ||
      !draft.ready ||
      !text.trim() ||
      app.harness.busy ||
      catalogLoading
    )
      return;
    submitGuard.current = true;
    setSubmitting(true);
    setError("");
    try {
      await draft.prepareSend();
      await api(`/applications/${app.id}/prompt`, "POST", {
        text,
        provider,
        ...(model ? { model } : {}),
      });
      draft.sent();
      await onRefresh();
      editorRef.current?.focus();
    } catch (e) {
      draft.sendFailed();
      setError(errorMessage(e));
    } finally {
      submitGuard.current = false;
      setSubmitting(false);
    }
  }
  async function interrupt() {
    if (submitGuard.current) return;
    submitGuard.current = true;
    setSubmitting(true);
    setError("");
    try {
      await api(`/applications/${app.id}/interrupt`, "POST", {});
      await onRefresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      submitGuard.current = false;
      setSubmitting(false);
    }
  }
  async function approve(id: string, allow: boolean) {
    setApprovalBusy((old) => [...old, id]);
    setError("");
    try {
      await api(`/applications/${app.id}/approvals/${id}`, "POST", { allow });
      await onRefresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setApprovalBusy((old) => old.filter((value) => value !== id));
    }
  }
  return (
    <div className="shrink-0 px-3 pb-3 pt-2 sm:px-5 sm:pb-5" data-composer-dock>
      <div className="mx-auto mb-2 w-full max-w-(--chat-content-max-width) space-y-2">
        <ErrorNotice error={error} onClose={() => setError("")} />
        {draft.error && (
          <>
            <ErrorNotice error={draft.error} />
            <Button size="sm" variant="outline" onClick={draft.retry}>
              Entwurf erneut laden / speichern
            </Button>
          </>
        )}
      </div>
      <ComposerSurface.Shell>
        {app.harness.pending.length > 0 && (
          <ComposerBanner.Dock>
            <ComposerBanner.Column>
              {app.harness.pending.map((approval) => (
                <ComposerBanner.Attachment key={approval.id}>
                  <ComposerBanner.Root
                    variant="warning"
                    density="spacious"
                    role="region"
                    aria-label="Einzelfreigabe"
                  >
                    <ComposerBanner.Row layout="approval">
                      <ComposerBanner.Icon>
                        <ShieldCheck />
                      </ComposerBanner.Icon>
                      <ComposerBanner.Content>
                        <span className="min-w-0">
                          <strong className="block text-sm">
                            {approval.title}
                          </strong>
                          <span className="mt-1 block max-h-32 overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-muted-foreground">
                            {approval.message}
                          </span>
                        </span>
                      </ComposerBanner.Content>
                      <ComposerBanner.Actions>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={approvalBusy.includes(approval.id)}
                          onClick={() => void approve(approval.id, false)}
                        >
                          Ablehnen
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          disabled={approvalBusy.includes(approval.id)}
                          onClick={() => void approve(approval.id, true)}
                        >
                          Einmal erlauben
                        </Button>
                      </ComposerBanner.Actions>
                    </ComposerBanner.Row>
                  </ComposerBanner.Root>
                </ComposerBanner.Attachment>
              ))}
            </ComposerBanner.Column>
          </ComposerBanner.Dock>
        )}
        <ComposerSurface.Host>
          <form
            data-chat-composer-form="true"
            className="mx-auto w-full min-w-0 max-w-(--chat-content-max-width)"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <ComposerSurface.Main>
              <div data-chat-composer-surface="true" className="rounded-2xl">
                <div
                  data-chat-composer-body="true"
                  className="relative px-4 pb-2 pt-3.5 sm:pt-4"
                >
                  <ComposerPromptEditorTiptap
                    value={draft.text}
                    onChange={draft.change}
                    disabled={!draft.ready || submitting}
                    placeholder={
                      draft.ready
                        ? "Was möchtest du an dieser Bewerbung ändern?"
                        : "Entwurf wird geladen…"
                    }
                    editorRef={editorRef}
                    onCommandKeyDown={(key, event) => {
                      if (
                        key !== "Enter" ||
                        event.shiftKey ||
                        event.altKey ||
                        event.isComposing
                      )
                        return false;
                      if (sendOnEnter || event.ctrlKey || event.metaKey) {
                        void submit();
                        return true;
                      }
                      return false;
                    }}
                  />
                </div>
                <div
                  data-chat-composer-footer="true"
                  className="flex min-w-0 flex-nowrap items-center overflow-visible px-2 pb-2"
                >
                  <div
                    data-chat-composer-actions="right"
                    className="flex min-w-0 flex-1 flex-nowrap items-center justify-end gap-2"
                  >
                    <div
                      data-chat-composer-controls="footer"
                      data-chat-composer-footer-controls="true"
                      className="relative flex min-w-0 flex-1 items-center justify-end gap-0.5"
                    >
                      <ProviderModelPicker
                        id={app.id}
                        provider={provider}
                        model={model}
                        reportedModel={
                          provider === app.harness.provider
                            ? app.harness.model
                            : undefined
                        }
                        disabled={app.harness.busy || submitting}
                        onSelect={(next, selection) => {
                          setProvider(next);
                          setModel(selection);
                        }}
                        onLoadingChange={setCatalogLoading}
                      />
                    </div>
                    <ComposerPrimaryActions
                      running={app.harness.busy}
                      sending={submitting}
                      disabled={
                        !draft.ready || !draft.text.trim() || catalogLoading
                      }
                      onInterrupt={() => void interrupt()}
                    />
                  </div>
                </div>
              </div>
            </ComposerSurface.Main>
          </form>
        </ComposerSurface.Host>
      </ComposerSurface.Shell>
      <div className="mx-auto mt-2 flex max-w-(--chat-content-max-width) items-center justify-between gap-3 px-2 text-2xs text-muted-foreground">
        <span>
          {app.harness.busy
            ? "Durchlauf aktiv"
            : "Dokumentänderungen nur mit Einzelfreigabe"}
        </span>
        <span className="hidden sm:inline">
          {sendOnEnter
            ? "Enter senden · Shift+Enter neue Zeile"
            : "Strg/⌘+Enter senden"}
        </span>
      </div>
    </div>
  );
}
