import { T, useGT } from "gt-react";
import { useState, type ReactNode } from "react";
import {
  AuthSourceControlWriteScope,
  type EnvironmentId,
  type ScopedThreadRef,
} from "@t3tools/contracts";

import { cn } from "~/lib/utils";
import { readEnvironmentScope, useEnvironmentScope } from "~/state/session";

import { Button } from "~/components/ui/button";
import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";
import { PullRequestMarkdown } from "~/components/pullRequest/PullRequestMarkdown";
import { Textarea } from "~/components/ui/textarea";

export function IssueMarkdownEditor({
  value,
  cwd,
  environmentId,
  threadRef = null,
  placeholder,
  label,
  saving,
  allowEmpty = false,
  className,
  onSave,
  onCancel,
  renderInput,
}: {
  readonly value: string;
  readonly cwd: string;
  readonly environmentId: EnvironmentId;
  readonly threadRef?: ScopedThreadRef | null;
  readonly placeholder?: string | undefined;
  readonly label: string;
  readonly saving: boolean;
  readonly allowEmpty?: boolean;
  readonly className?: string | undefined;
  readonly onSave: (next: string) => void;
  readonly onCancel: () => void;
  readonly renderInput?: (input: {
    readonly value: string;
    readonly onValueChange: (value: string) => void;
  }) => ReactNode;
}) {
  const gt = useGT();
  const canWriteSourceControl = useEnvironmentScope(environmentId, AuthSourceControlWriteScope);
  const [draft, setDraft] = useState(value);
  const [preview, setPreview] = useState(false);
  const [seed, setSeed] = useState(value);
  if (seed !== value) {
    setSeed(value);
    setDraft(value);
  }
  const empty = draft.trim().length === 0;
  const saveDisabled = !canWriteSourceControl || saving || (empty && !allowEmpty);

  return (
    <div
      className={cn("space-y-2", className)}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (
          event.key === "Enter" &&
          (event.metaKey || event.ctrlKey) &&
          !event.shiftKey &&
          !event.altKey
        ) {
          event.preventDefault();
          event.stopPropagation();
          if (
            !saveDisabled &&
            !event.repeat &&
            readEnvironmentScope(environmentId, AuthSourceControlWriteScope)
          )
            onSave(draft);
          return;
        }
        if (event.key !== "Escape" || saving) return;
        event.preventDefault();
        onCancel();
      }}
    >
      <ToggleGroup
        aria-label={gt("Markdown editor mode")}
        variant="segmented"
        value={[preview ? "preview" : "write"]}
        disabled={saving}
        onValueChange={(next) => {
          const mode = next[0];
          if (mode === "write" || mode === "preview") setPreview(mode === "preview");
        }}
      >
        <Toggle value="write">
          <T context="verb, markdown editor mode">Write</T>
        </Toggle>
        <Toggle value="preview">
          <T context="markdown editor mode">Preview</T>
        </Toggle>
      </ToggleGroup>
      {preview ? (
        <div className="rounded-lg border border-border/60 px-3 py-2">
          {empty ? (
            <p className="text-xs text-muted-foreground">
              <T>Nothing to preview.</T>
            </p>
          ) : (
            <PullRequestMarkdown
              text={draft}
              cwd={cwd}
              environmentId={environmentId}
              threadRef={threadRef}
            />
          )}
        </div>
      ) : renderInput ? (
        renderInput({ value: draft, onValueChange: setDraft })
      ) : (
        <Textarea
          autoFocus
          disabled={saving}
          value={draft}
          rows={6}
          placeholder={placeholder}
          aria-label={label}
          onChange={(event) => setDraft(event.target.value)}
        />
      )}
      <div className="flex justify-end gap-2">
        <Button size="xs" variant="ghost" disabled={saving} onClick={onCancel}>
          <T>Cancel</T>
        </Button>
        <Button
          size="xs"
          variant="outline"
          disabled={!canWriteSourceControl || saving || (empty && !allowEmpty)}
          onClick={() => {
            if (
              !readEnvironmentScope(environmentId, AuthSourceControlWriteScope) ||
              saving ||
              (empty && !allowEmpty)
            )
              return;
            onSave(draft);
          }}
        >
          {saving ? gt("Saving...") : gt("Save")}
        </Button>
      </div>
    </div>
  );
}
