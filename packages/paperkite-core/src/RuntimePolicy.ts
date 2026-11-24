import type { RuntimeStatus } from "@paperkite/contracts/runtime";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

export class FeatureUnavailable extends Schema.TaggedError<FeatureUnavailable>()(
  "PaperkiteFeatureUnavailable",
  { feature: Schema.Literal("threadSettlement") },
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
  }
>()("@paperkite/core/RuntimePolicy") {}

export const layer = (status: RuntimeStatus) =>
  Layer.succeed(RuntimePolicy, {
    status,
    requireThreadSettlement: status.capabilities.threadSettlement
      ? Effect.void
      : Effect.fail(new FeatureUnavailable({ feature: "threadSettlement" })),
  });
