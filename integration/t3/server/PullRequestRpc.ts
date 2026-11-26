import { PullRequestUnavailableError, WS_METHODS } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

const unavailable = Effect.fail(new PullRequestUnavailableError({ reason: "feature-disabled" }));

export const handlers = {
  [WS_METHODS.pullRequestsList]: () => unavailable,
  [WS_METHODS.pullRequestsListStats]: () => unavailable,
  [WS_METHODS.pullRequestsFilterOptions]: () => unavailable,
  [WS_METHODS.pullRequestsRoutingIdentity]: () => unavailable,
  [WS_METHODS.pullRequestsRouting]: () => unavailable,
  [WS_METHODS.pullRequestsSummary]: () => unavailable,
  [WS_METHODS.pullRequestsStack]: () => unavailable,
  [WS_METHODS.pullRequestsLinkedThreads]: () => unavailable,
  [WS_METHODS.pullRequestsDetail]: () => unavailable,
  [WS_METHODS.pullRequestsPreview]: () => unavailable,
  [WS_METHODS.pullRequestsChecks]: () => unavailable,
  [WS_METHODS.pullRequestsActivity]: () => unavailable,
  [WS_METHODS.pullRequestsReviewGuide]: () => unavailable,
  [WS_METHODS.pullRequestsGenerateReviewGuide]: () => unavailable,
  [WS_METHODS.pullRequestsThreadComments]: () => unavailable,
  [WS_METHODS.pullRequestsDiffFileContents]: () => unavailable,
  [WS_METHODS.pullRequestsFilesViewed]: () => unavailable,
  [WS_METHODS.pullRequestsChangeBreakdown]: () => unavailable,
  [WS_METHODS.pullRequestsSetFilesViewed]: () => unavailable,
  [WS_METHODS.pullRequestsRunAction]: () => unavailable,
  [WS_METHODS.pullRequestsUpdate]: () => unavailable,
  [WS_METHODS.pullRequestsComment]: () => unavailable,
  [WS_METHODS.pullRequestsUpdateComment]: () => unavailable,
  [WS_METHODS.pullRequestsSubmitReview]: () => unavailable,
  [WS_METHODS.pullRequestsReplyToThread]: () => unavailable,
  [WS_METHODS.pullRequestsSetThreadResolution]: () => unavailable,
  [WS_METHODS.pullRequestsSetReaction]: () => unavailable,
  [WS_METHODS.pullRequestsReportState]: () => unavailable,
  [WS_METHODS.pullRequestsInvalidate]: () => unavailable,
  [WS_METHODS.pullRequestsSubscribeRefreshes]: () => Stream.fromEffect(unavailable),
  [WS_METHODS.pullRequestsSubscribeLinkedThreadRefreshes]: () => Stream.fromEffect(unavailable),
  [WS_METHODS.pullRequestsReviewerCandidates]: () => unavailable,
  [WS_METHODS.pullRequestsRequestReviewers]: () => unavailable,
  [WS_METHODS.pullRequestsLabelCandidates]: () => unavailable,
  [WS_METHODS.pullRequestsSetLabels]: () => unavailable,
};
