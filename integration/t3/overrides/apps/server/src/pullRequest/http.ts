import {
  AuthOrchestrationReadScope,
  EnvironmentHttpApi,
  PullRequestUnavailableError,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";

import { annotateEnvironmentRequest, requireEnvironmentScope } from "../auth/http.ts";

export const layer = HttpApiBuilder.group(EnvironmentHttpApi, "pullRequests", (handlers) =>
  handlers.handle(
    "diff",
    Effect.fn("environment.pullRequests.diff")(function* (args) {
      yield* annotateEnvironmentRequest(args.endpoint.name);
      yield* requireEnvironmentScope(AuthOrchestrationReadScope);
      return yield* new PullRequestUnavailableError({ reason: "feature-disabled" });
    }),
  ),
);
