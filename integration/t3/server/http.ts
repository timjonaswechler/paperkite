import { RuntimeStatus } from "@paperkite/contracts/runtime";
import * as RuntimePolicy from "@paperkite/core/RuntimePolicy";
import {
  AuthOrchestrationReadScope,
  EnvironmentAuthenticatedAuth,
  EnvironmentScopeRequiredError,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";

import * as AuthHttp from "../../auth/http.ts";
import * as Runtime from "./Runtime.ts";

const api = HttpApi.make("paperkite").add(
  HttpApiGroup.make("runtime")
    .add(
      HttpApiEndpoint.get("status", "/api/paperkite/runtime", {
        success: RuntimeStatus,
        error: [EnvironmentScopeRequiredError],
      }),
    )
    .middleware(EnvironmentAuthenticatedAuth),
);

const handlers = HttpApiBuilder.group(
  api,
  "runtime",
  Effect.fnUntraced(function* (group) {
    const policy = yield* RuntimePolicy.RuntimePolicy;
    return group.handle(
      "status",
      Effect.fn("Paperkite.runtimeStatus")(function* () {
        yield* AuthHttp.requireEnvironmentScope(AuthOrchestrationReadScope);
        return policy.status;
      }),
    );
  }),
);

export const layer = Layer.unwrap(
  Effect.map(Runtime.Profile, (profile) =>
    profile === undefined
      ? Layer.empty
      : HttpApiBuilder.layer(api).pipe(
          Layer.provide(handlers.pipe(Layer.provide(RuntimePolicy.layer(profile)))),
          Layer.provide(AuthHttp.layerAuthenticatedAuth),
        ),
  ),
);
