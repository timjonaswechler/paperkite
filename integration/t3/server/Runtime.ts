import type { RuntimeStatus } from "@paperkite/contracts/runtime";
import * as RuntimePolicy from "@paperkite/core/RuntimePolicy";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

export const Profile = Context.Reference<RuntimeStatus | undefined>("paperkite/t3/Profile", {
  defaultValue: () => undefined,
});

export const settlementEnabled = Effect.map(
  Profile,
  (profile) => profile?.capabilities.threadSettlement !== false,
);

export const requireCommand = Effect.fn("Paperkite.requireCommand")(function* (type: string) {
  const profile = yield* Profile;
  if (
    profile === undefined ||
    !["thread.settle", "thread.auto-settle", "thread.unsettle"].includes(type)
  )
    return;
  const policy = yield* RuntimePolicy.RuntimePolicy.pipe(
    Effect.provide(RuntimePolicy.layer(profile)),
  );
  yield* policy.requireThreadSettlement;
});

export const whenSettlementEnabled = <A, E, R>(layer: Layer.Layer<A, E, R>) =>
  Layer.unwrap(Effect.map(settlementEnabled, (enabled) => (enabled ? layer : Layer.empty)));
