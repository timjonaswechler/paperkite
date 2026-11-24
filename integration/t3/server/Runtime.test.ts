import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import type { RuntimeStatus } from "@paperkite/contracts/runtime";
import * as Runtime from "./Runtime.ts";

const proof: RuntimeStatus = {
  application: "paperkite",
  upstreamCommit: "fixture",
  profile: "proof",
  capabilities: { threadSettlement: false },
};

it.effect(
  "rejects every explicit settlement mutation but leaves unrelated native commands available",
  () =>
    Effect.gen(function* () {
      for (const type of ["thread.settle", "thread.auto-settle", "thread.unsettle"]) {
        const result = yield* Runtime.requireCommand(type).pipe(Effect.result);
        expect(result._tag).toBe("Failure");
        if (result._tag === "Failure") expect(result.failure._tag).toBe("FeatureUnavailable");
      }
      yield* Runtime.requireCommand("thread.create");
    }).pipe(Effect.provideService(Runtime.Profile, proof)),
);

it.effect("does not construct the disabled worker, and starts the enabled native worker once", () =>
  Effect.gen(function* () {
    for (const enabled of [false, true]) {
      const starts = yield* Ref.make(0);
      const worker = Layer.effectDiscard(Ref.update(starts, (count) => count + 1));
      yield* Layer.build(Runtime.whenSettlementEnabled(worker)).pipe(
        Effect.provideService(Runtime.Profile, {
          ...proof,
          capabilities: { threadSettlement: enabled },
        }),
        Effect.scoped,
      );
      expect(yield* Ref.get(starts)).toBe(enabled ? 1 : 0);
    }
  }),
);

it.effect("keeps the unprofiled native server compatible", () =>
  Runtime.requireCommand("thread.settle"),
);
