import type { ComponentProps } from "react";
import { IssueMarkdownEditor } from "~/paperkite/IssueMarkdownEditor";
import {
  PullRequestMarkdownTextarea,
  type PullRequestCompletionScope,
} from "./PullRequestMarkdownTextarea";

export function PullRequestMarkdownEditor({
  completionScope,
  ...props
}: Omit<ComponentProps<typeof IssueMarkdownEditor>, "renderInput"> & {
  readonly completionScope: PullRequestCompletionScope | null;
}) {
  return (
    <IssueMarkdownEditor
      {...props}
      renderInput={({ value, onValueChange }) => (
        <PullRequestMarkdownTextarea
          autoFocus
          disabled={props.saving}
          completionScope={completionScope}
          value={value}
          rows={6}
          placeholder={props.placeholder}
          aria-label={props.label}
          onValueChange={onValueChange}
        />
      )}
    />
  );
}
