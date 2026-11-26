import type { RepositoryIdentity } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

export class RepositoryIdentityResolver extends Context.Service<
  RepositoryIdentityResolver,
  {
    readonly resolve: (
      cwd: string,
      options?: { readonly refresh?: boolean },
    ) => Effect.Effect<RepositoryIdentity | null>;
  }
>()("t3/project/RepositoryIdentityResolver") {}

export const layer = Layer.succeed(RepositoryIdentityResolver, {
  resolve: Effect.fn("RepositoryIdentityResolver.resolve")(() => Effect.succeed(null)),
});
