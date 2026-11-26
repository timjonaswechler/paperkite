import {
  workflowReferenceIssue,
  workflowReferenceLabel,
  workflowReferencePullRequest,
} from "@t3tools/client-runtime/workflows";
import type { EnvironmentId, WorkflowRunReference } from "@t3tools/contracts";
import { T } from "gt-react";
import { ExternalLinkIcon, LinkIcon } from "lucide-react";

import { cn } from "../../lib/utils";
import { Button } from "../ui/button";

export function WorkflowReferenceMark({
  reference: _reference,
}: {
  readonly reference: WorkflowRunReference;
}) {
  return <LinkIcon aria-hidden className="size-3 shrink-0 text-muted-foreground" />;
}

/** A thing the run touched, as a chip that opens it beside the run. */
export function WorkflowReferenceChip({
  reference,
  open,
  small = false,
  onOpen,
}: {
  readonly reference: WorkflowRunReference;
  /** It shows in the pane now, so another click closes it. */
  readonly open: boolean;
  /** On a step, where the label is enough. */
  readonly small?: boolean;
  readonly onOpen: () => void;
}) {
  if (
    workflowReferencePullRequest(reference) !== null ||
    workflowReferenceIssue(reference) !== null
  )
    return null;
  const label = workflowReferenceLabel(reference);
  const title = reference.title === label ? "" : reference.title;
  const name = title === "" ? label : `${label} ${title}`;
  return (
    <button
      type="button"
      aria-pressed={open}
      aria-label={name}
      className={cn(
        "inline-flex min-w-0 max-w-72 cursor-pointer items-center gap-1.5 rounded-full border bg-card text-foreground hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none",
        small ? "py-px ps-1.5 pe-2 text-2xs" : "py-0.5 ps-2 pe-2.5 text-xs",
        open ? "border-primary ring-1 ring-primary" : "border-border",
      )}
      onClick={onOpen}
    >
      <WorkflowReferenceMark reference={reference} />
      <span className="shrink-0 text-muted-foreground">{label}</span>
      {small || title === "" ? null : <span className="min-w-0 truncate">{title}</span>}
    </button>
  );
}

/** Opens the reference on its own page, where it has the whole window. Null for a kind with none. */
export function referencePageOpener(
  _environmentId: EnvironmentId,
): (reference: WorkflowRunReference) => (() => void) | null {
  return () => null;
}

/** A reference opened beside its run: the Issues or Pull requests page's own view of it. */
export function WorkflowReferencePanel({
  reference,
}: {
  readonly environmentId: EnvironmentId;
  readonly reference: WorkflowRunReference;
}) {
  if (
    workflowReferencePullRequest(reference) !== null ||
    workflowReferenceIssue(reference) !== null
  )
    return null;
  // A kind this client does not know yet: what the run knows of it, and where it lives.
  return (
    <div className="space-y-2 p-4">
      <h3 className="text-base font-semibold break-words">
        {reference.title === "" ? workflowReferenceLabel(reference) : reference.title}
      </h3>
      <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <WorkflowReferenceMark reference={reference} />
        <span>{reference.kind}</span>
        {reference.state === null ? null : (
          <>
            <span aria-hidden>·</span>
            <span>{reference.state}</span>
          </>
        )}
      </p>
      {reference.url === null ? null : (
        <Button
          size="sm"
          variant="outline"
          render={<a href={reference.url} target="_blank" rel="noreferrer" />}
        >
          <T>Open</T>
          <ExternalLinkIcon aria-hidden />
        </Button>
      )}
    </div>
  );
}
