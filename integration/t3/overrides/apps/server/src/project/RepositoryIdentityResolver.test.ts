import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as RepositoryIdentityResolver from "./RepositoryIdentityResolver.ts";

it.effect("omits repository identity even when a caller requests refresh", () =>
  Effect.gen(function* () {
    const resolver = yield* RepositoryIdentityResolver.RepositoryIdentityResolver;
    expect(yield* resolver.resolve("/workspace", { refresh: true })).toBeNull();
  }).pipe(Effect.provide(RepositoryIdentityResolver.layer)),
);
