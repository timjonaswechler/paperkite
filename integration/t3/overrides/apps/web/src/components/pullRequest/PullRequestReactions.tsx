import { ReactionBar } from "~/paperkite/IssueSharedUi";
export { ReactionBar } from "~/paperkite/IssueSharedUi";
import { useAtomCommand } from "~/state/use-atom-command";
import type { EnvironmentId, PullRequestReaction, PullRequestRef } from "@t3tools/contracts";

import { pullRequestEnvironment } from "~/state/pullRequests";

export function PullRequestReactionBar({
  reactions,
  canReact,
  subjectId,
  environmentId,
  reference,
  onRefresh,
  className,
}: {
  readonly reactions: ReadonlyArray<PullRequestReaction>;
  readonly canReact: boolean;
  /** Omit to react to the pull request description. */
  readonly subjectId?: string | undefined;
  readonly environmentId: EnvironmentId;
  readonly reference: PullRequestRef;
  readonly onRefresh: () => void;
  readonly className?: string | undefined;
}) {
  const setReaction = useAtomCommand(pullRequestEnvironment.setReaction, {
    reportFailure: false,
  });
  return (
    <ReactionBar
      reactions={reactions}
      canReact={canReact}
      className={className}
      onReact={async (content, reacted) => {
        const result = await setReaction({
          environmentId,
          input: {
            ...reference,
            ...(subjectId === undefined ? {} : { subjectId }),
            content,
            reacted,
          },
        });
        if (result._tag === "Failure") return false;
        onRefresh();
        return true;
      }}
    />
  );
}
