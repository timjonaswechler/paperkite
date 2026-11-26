import type * as Native from "../../pullRequest/PullRequestService.ts";
import * as Context from "effect/Context";

// Native Context keys are string identities. Refer to the optional port without loading its implementation.
export const PullRequestService = Context.Service<
  Native.PullRequestService,
  Native.PullRequestService["Service"]
>("t3/pullRequest/PullRequestService");

export type PullRequestMergeEvent = Native.PullRequestMergeEvent;
