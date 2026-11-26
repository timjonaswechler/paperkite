import * as Context from "effect/Context";
import type { IssueTrackerKind } from "@t3tools/contracts";
import {
  isStandaloneIssueTracker,
  type IssueTrackerApi,
  type StandaloneIssueTrackerApi,
} from "@t3tools/source-control-core/server/IssueTracker";

export class IssueTrackerRegistry extends Context.Service<
  IssueTrackerRegistry,
  {
    /** Null for a kind with no implementation, which the service reports as unsupported. */
    readonly get: (kind: IssueTrackerKind) => IssueTrackerApi | null;
    readonly kinds: ReadonlyArray<IssueTrackerKind>;
    /** The trackers a user connects with a credential of their own, in registration order. */
    readonly standalone: ReadonlyArray<StandaloneIssueTrackerApi>;
  }
>()("t3/issue/IssueTrackerRegistry") {}

/** Exported for tests, which stand a registry up from trackers they supply themselves. */
export function fromTrackers(
  trackers: ReadonlyArray<IssueTrackerApi>,
): IssueTrackerRegistry["Service"] {
  const byKind = new Map(trackers.map((tracker) => [tracker.kind, tracker]));
  return {
    get: (kind) => byKind.get(kind) ?? null,
    kinds: trackers.map((tracker) => tracker.kind),
    standalone: trackers.filter(isStandaloneIssueTracker),
  };
}
