import {
  type ApplicationAnalysisInput,
  type ApplicationAnalysisResult,
  TextGenerationError,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "./TextGeneration.ts";

export class ApplicationAnalysis extends Context.Service<
  ApplicationAnalysis,
  {
    readonly analyze: (
      input: ApplicationAnalysisInput,
    ) => Effect.Effect<ApplicationAnalysisResult, TextGenerationError>;
  }
>()("t3/textGeneration/ApplicationAnalysis") {}

const make = Effect.gen(function* () {
  const textGeneration = yield* TextGeneration.TextGeneration;
  const settingsService = yield* ServerSettings.ServerSettingsService;
  const fs = yield* FileSystem.FileSystem;
  return ApplicationAnalysis.of({
    analyze: Effect.fn("ApplicationAnalysis.analyze")(function* (input) {
      const settings = yield* settingsService.getSettings.pipe(
        Effect.mapError(
          (cause) =>
            new TextGenerationError({
              operation: "generateApplicationAnalysis",
              detail: "Could not read model settings.",
              cause,
            }),
        ),
      );
      const cwd = yield* fs
        .makeTempDirectoryScoped({ prefix: "t3-application-analysis-" })
        .pipe(
          Effect.mapError(
            (cause) =>
              new TextGenerationError({
                operation: "generateApplicationAnalysis",
                detail: "Could not prepare analysis.",
                cause,
              }),
          ),
        );
      const generate = textGeneration.generateApplicationAnalysis;
      if (!generate)
        return yield* new TextGenerationError({
          operation: "generateApplicationAnalysis",
          detail: "Application analysis is not available.",
        });
      return yield* generate({
        ...input,
        cwd,
        modelSelection: input.modelSelection ?? settings.textGenerationModelSelection,
      });
    }, Effect.scoped),
  });
});
export const layer = Layer.effect(ApplicationAnalysis, make);
