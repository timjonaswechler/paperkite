import { expect, it } from "@effect/vitest";
import { EnvironmentId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as PeerLinks from "../../peer/PeerLinks.ts";

it.effect(
  "keeps excluded peer operations unavailable without storage, secrets or network services",
  () =>
    Effect.gen(function* () {
      const links = yield* PeerLinks.PeerLinks;
      const id = EnvironmentId.make("excluded-peer");
      expect(yield* links.enabled).toBe(false);
      for (const operation of [
        links.list.pipe(Effect.asVoid),
        links.names.pipe(Effect.asVoid),
        links.get(id).pipe(Effect.asVoid),
        links.resolve(id).pipe(Effect.asVoid),
        links.unlink(id).pipe(Effect.asVoid),
        links
          .link({
            url: "https://unused.example.test",
            pairingCode: "unused",
            access: "full-access",
          })
          .pipe(Effect.asVoid),
        links
          .linkUnlessLinked({
            url: "https://unused.example.test",
            pairingCode: "unused",
            access: "read-only",
          })
          .pipe(Effect.asVoid),
      ])
        expect(yield* operation.pipe(Effect.flip)).toMatchObject({
          _tag: "PeerLinkError",
          reason: "disabled",
        });
    }).pipe(Effect.provide(PeerLinks.layerUnavailable)),
);
