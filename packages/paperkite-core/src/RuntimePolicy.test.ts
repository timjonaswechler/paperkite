import { it, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as RuntimePolicy from "./RuntimePolicy.ts";

it.effect("a disabled capability rejects execution while the native profile permits it", () =>
  Effect.gen(function* () {
    for (const enabled of [false, true]) {
      const result = yield* Effect.gen(function* () {
        const policy = yield* RuntimePolicy.RuntimePolicy;
        expect(policy.status.capabilities.threadSettlement).toBe(enabled);
        expect(yield* policy.requirePullRequests.pipe(Effect.flip)).toMatchObject({
          _tag: "PaperkiteFeatureUnavailable",
          feature: "pullRequests",
        });
        return yield* Effect.result(policy.requireThreadSettlement);
      }).pipe(
        Effect.provide(
          RuntimePolicy.layer({
            application: "paperkite",
            upstreamCommit: "fixture",
            profile: enabled ? "native" : "proof",
            capabilities: {
              threadSettlement: enabled,
              pullRequests: false,
              git: false,
              pairing: false,
              environments: false,
              github: false,
              sourceControl: false,
              issues: false,
            },
          }),
        ),
      );
      expect(result._tag).toBe(enabled ? "Success" : "Failure");
    }
  }),
);
