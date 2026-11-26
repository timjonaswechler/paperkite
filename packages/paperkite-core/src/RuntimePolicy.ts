import type { RuntimeStatus } from "@paperkite/contracts/runtime";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

export class FeatureUnavailable extends Schema.TaggedError<FeatureUnavailable>()(
  "PaperkiteFeatureUnavailable",
  { feature: Schema.Literals(["threadSettlement", "pullRequests", "git"]) },
) {
  override get message(): string {
    return `Feature ${this.feature} is unavailable in this Paperkite profile.`;
  }
}

export class RuntimePolicy extends Context.Service<
  RuntimePolicy,
  {
    readonly status: RuntimeStatus;
    readonly requireThreadSettlement: Effect.Effect<void, FeatureUnavailable>;
    readonly requirePullRequests: Effect.Effect<void, FeatureUnavailable>;
    readonly requireGit: Effect.Effect<void, FeatureUnavailable>;
  }
>()("@paperkite/core/RuntimePolicy") {}

export const layer = (status: RuntimeStatus) =>
  Layer.succeed(RuntimePolicy, {
    status,
    requireThreadSettlement: status.capabilities.threadSettlement
      ? Effect.void
      : Effect.fail(new FeatureUnavailable({ feature: "threadSettlement" })),
    requireGit: status.capabilities.git
      ? Effect.void
      : Effect.fail(new FeatureUnavailable({ feature: "git" })),
    requirePullRequests: status.capabilities.pullRequests
      ? Effect.void
      : Effect.fail(new FeatureUnavailable({ feature: "pullRequests" })),
  });
