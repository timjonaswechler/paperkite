import {
  EnvironmentFeatureUnavailableError,
  SourceControlProviderError,
  SourceControlProviderKind,
  SourceControlRepositoryError,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as NativeRegistry from "../../sourceControl/SourceControlProviderRegistry.ts";
import type * as NativeRepositories from "../../sourceControl/SourceControlRepositoryService.ts";
import type * as NativeDiscovery from "../../sourceControl/SourceControlDiscovery.ts";

// Native service keys preserve shared consumers without constructing repository/provider implementations.
export const SourceControlProviderRegistry = Context.Service<
  NativeRegistry.SourceControlProviderRegistry,
  NativeRegistry.SourceControlProviderRegistry["Service"]
>("t3/sourceControl/SourceControlProviderRegistry");
export const SourceControlRepositoryService = Context.Service<
  NativeRepositories.SourceControlRepositoryService,
  NativeRepositories.SourceControlRepositoryService["Service"]
>("t3/sourceControl/SourceControlRepositoryService");

export const SourceControlDiscovery = Context.Service<
  NativeDiscovery.SourceControlDiscovery,
  NativeDiscovery.SourceControlDiscovery["Service"]
>("t3/sourceControl/SourceControlDiscovery");

export const discoveryLayer = Layer.succeed(SourceControlDiscovery, {
  discover: Effect.succeed({ versionControlSystems: [], sourceControlProviders: [] }),
});

const rejectProvider = Effect.fn("Paperkite.SourceControl.rejectProvider")(
  (operation: string, cwd: string) =>
    Effect.fail(
      new SourceControlProviderError({
        provider: SourceControlProviderKind.make("unknown"),
        operation,
        cwd,
        detail: "Source control providers are not installed in Paperkite.",
      }),
    ),
);

export const registryLayer = Layer.succeed(SourceControlProviderRegistry, {
  resolveLink: () => undefined,
  get: Effect.fn("SourceControlProviderRegistry.get")(() => rejectProvider("get", ".")),
  resolveHandle: Effect.fn("SourceControlProviderRegistry.resolveHandle")(
    (input: { readonly cwd: string }) => rejectProvider("resolveHandle", input.cwd),
  ),
  resolve: Effect.fn("SourceControlProviderRegistry.resolve")((input: { readonly cwd: string }) =>
    rejectProvider("resolve", input.cwd),
  ),
  discover: Effect.succeed([]),
});

const rejectRepository = Effect.fn("Paperkite.SourceControl.rejectRepository")(
  (operation: string) =>
    Effect.fail(
      new SourceControlRepositoryError({
        provider: SourceControlProviderKind.make("unknown"),
        operation,
        detail: "Repository hosting is unavailable in Paperkite.",
        cause: new EnvironmentFeatureUnavailableError({ feature: "sourceControl" }),
      }),
    ),
);

export const repositoryLayer = Layer.succeed(SourceControlRepositoryService, {
  lookupRepository: Effect.fn("SourceControlRepositoryService.lookupRepository")(() =>
    rejectRepository("lookupRepository"),
  ),
  prepareClone: Effect.fn("SourceControlRepositoryService.prepareClone")(() =>
    rejectRepository("prepareClone"),
  ),
  cloneRepository: Effect.fn("SourceControlRepositoryService.cloneRepository")(() =>
    rejectRepository("cloneRepository"),
  ),
  discardClone: Effect.fn("SourceControlRepositoryService.discardClone")(() =>
    rejectRepository("discardClone"),
  ),
  publishRepository: Effect.fn("SourceControlRepositoryService.publishRepository")(() =>
    rejectRepository("publishRepository"),
  ),
});
