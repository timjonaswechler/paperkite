import { assert, it } from "@effect/vitest";
import { ProviderInstanceId, TextGenerationError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { decodeJsonReply, fromRunner } from "./textGenerationOperations.ts";

it.effect("extracts structured application facts instead of treating them as a thread title", () =>
  Effect.gen(function* () {
    const source = "Acme GmbH sucht Software Engineer. Kenntnisse in TypeScript erforderlich.";
    const textGeneration = fromRunner("Stub", (request) => {
      assert.strictEqual(request.operation, "generateApplicationAnalysis");
      assert.strictEqual(request.modelSelection.model, "fixture-model");
      const data = JSON.parse(request.prompt.split("\n").at(-1)!);
      assert.deepEqual(data, { sourceUrl: "https://jobs.example/job/42", advertisement: source });
      return decodeJsonReply(
        request,
        "Stub",
        '{"company":"Acme GmbH","role":"Software Engineer","requirements":["TypeScript"]}',
      );
    });
    const result = yield* (
      textGeneration.generateApplicationAnalysis?.({
        cwd: "/tmp",
        text: source,
        sourceUrl: "https://jobs.example/job/42",
        modelSelection: { instanceId: ProviderInstanceId.make("pi"), model: "fixture-model" },
      }) ?? Effect.die("Analysis operation missing")
    );
    assert.deepEqual(result, {
      company: "Acme GmbH",
      role: "Software Engineer",
      requirements: ["TypeScript"],
    });
  }),
);

it.effect("rejects a title-only response for application analysis", () =>
  Effect.gen(function* () {
    const textGeneration = fromRunner("Stub", (request) =>
      decodeJsonReply(request, "Stub", '{"title":"Acme Engineer"}'),
    );
    const result = yield* (
      textGeneration.generateApplicationAnalysis?.({
        cwd: "/tmp",
        text: "Job advertisement",
        sourceUrl: "",
        modelSelection: { instanceId: ProviderInstanceId.make("pi"), model: "fixture-model" },
      }) ?? Effect.die("Analysis operation missing")
    ).pipe(Effect.flip);
    assert.instanceOf(result, TextGenerationError);
  }),
);

// regression: #23726 a reply that echoes the schema key replaced the seed title with "title"
it.effect("fails a thread title reply that is only the schema key", () =>
  Effect.gen(function* () {
    const textGeneration = fromRunner("Stub", (request) =>
      decodeJsonReply(request, "Stub", '{"title":"title","needsRefinement":false}'),
    );

    const outcome = yield* textGeneration
      .generateThreadTitle({
        cwd: process.cwd(),
        message: "$implement Issue #140",
        modelSelection: {
          instanceId: ProviderInstanceId.make("pi"),
          model: "anthropic/claude-haiku-4-5",
        },
      })
      .pipe(Effect.match({ onFailure: (error) => error, onSuccess: (result) => result }));

    assert.instanceOf(outcome, TextGenerationError);
    assert.strictEqual(outcome.operation, "generateThreadTitle");
  }),
);
