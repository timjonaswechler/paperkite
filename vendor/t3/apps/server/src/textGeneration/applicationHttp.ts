import { AuthOrchestrationOperateScope, EnvironmentHttpApi } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import { annotateEnvironmentRequest, requireEnvironmentScope } from "../auth/http.ts";
import * as ApplicationAnalysis from "./ApplicationAnalysis.ts";

export const layer = HttpApiBuilder.group(EnvironmentHttpApi, "applicationAnalysis", Effect.fnUntraced(function* (handlers) {
  const analysis = yield* ApplicationAnalysis.ApplicationAnalysis;
  return handlers.handle("analyze", Effect.fn("environment.applicationAnalysis.analyze")(function* (args) {
    yield* annotateEnvironmentRequest(args.endpoint.name);
    yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
    return yield* analysis.analyze(args.payload);
  }));
}));
