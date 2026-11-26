import { expect, it } from "@effect/vitest";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as ServerConfig from "../../config.ts";
import * as ServerSecretStore from "../../auth/ServerSecretStore.ts";
import * as SqlitePersistence from "../../persistence/Sqlite.ts";
import * as ManagedPolicy from "../../policy/ManagedPolicy.ts";
import * as ServerSettings from "../../serverSettings.ts";

const settingsLayer = ServerSettings.layer.pipe(
  Layer.provideMerge(ServerSecretStore.layer),
  Layer.provide(ManagedPolicy.layerTest()),
  Layer.provideMerge(Layer.fresh(SqlitePersistence.layerMemory)),
  Layer.provideMerge(
    Layer.fresh(
      ServerConfig.layerTest(process.cwd(), {
        prefix: "paperkite-settings-availability-",
      }),
    ),
  ),
);

it.layer(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))("settings availability", (it) => {
  it.effect("rejects unsupported host writes before settings or provider-instance mutations", () =>
    Effect.gen(function* () {
      const settings = yield* ServerSettings.ServerSettingsService;
      const config = yield* ServerConfig.ServerConfig;
      const fs = yield* FileSystem.FileSystem;
      const before = yield* settings.getSettings;
      const beforeFile = yield* fs.readFileString(config.settingsPath).pipe(Effect.option);
      for (const kind of [
        "github",
        "gitlab",
        "gitcafe",
        "tanstack-source",
        "forgejo",
        "bitbucket",
        "azure-devops",
        "cursor-origin",
        "linear",
        "future-host",
      ]) {
        const patch = {
          sourceControlHosts: { [kind]: { tokens: { "fixture.test": "fixture-secret" } } },
        };
        const attempts = [
          settings.updateSettings(patch),
          settings.updateProviderInstance(
            {
              operation: "upsert",
              instanceId: ProviderInstanceId.make("fixture-provider"),
              instance: { driver: ProviderDriverKind.make("acpRegistry"), config: {} },
            },
            patch,
          ),
        ];
        for (const attempt of attempts) {
          expect(yield* attempt.pipe(Effect.flip)).toMatchObject({
            _tag: "ServerSettingsError",
            operation: "normalize",
          });
          expect(yield* settings.getSettings).toEqual(before);
          expect(yield* fs.readFileString(config.settingsPath).pipe(Effect.option)).toEqual(
            beforeFile,
          );
        }
      }
    }).pipe(Effect.provide(Layer.fresh(settingsLayer))),
  );

  it.effect(
    "does not import, move or delete retired host secrets when reading legacy settings",
    () =>
      Effect.gen(function* () {
        const config = yield* ServerConfig.ServerConfig;
        const fs = yield* FileSystem.FileSystem;
        const store = yield* ServerSecretStore.ServerSecretStore;
        const settings = yield* ServerSettings.ServerSettingsService;
        const oldKey = "github-token-Z2l0aHViLmNvbQ";
        yield* store.set(oldKey, new TextEncoder().encode("fixture-retired-value"));
        yield* store.set(
          "bitbucket-access-token",
          new TextEncoder().encode("fixture-retired-bitbucket"),
        );
        yield* fs.writeFileString(
          config.settingsPath,
          JSON.stringify({
            github: { tokens: { "github.com": "••••••" } },
            bitbucket: { email: "fixture@example.test", accessToken: "••••••" },
          }),
        );
        expect((yield* settings.getSettings).sourceControlHosts).toEqual({});
        const bitbucket = yield* store.get("bitbucket-access-token");
        expect(Option.isSome(bitbucket)).toBe(true);
        if (Option.isSome(bitbucket))
          expect(new TextDecoder().decode(bitbucket.value)).toBe("fixture-retired-bitbucket");
        expect(yield* store.get("source-control-Yml0YnVja2V0-YWNjZXNzVG9rZW4")).toEqual(
          Option.none(),
        );
        const original = yield* store.get(oldKey);
        expect(Option.isSome(original)).toBe(true);
        if (Option.isSome(original))
          expect(new TextDecoder().decode(original.value)).toBe("fixture-retired-value");
        expect(yield* store.get("source-control-Z2l0aHVi-dG9rZW5z-Z2l0aHViLmNvbQ")).toEqual(
          Option.none(),
        );
      }).pipe(Effect.provide(Layer.fresh(settingsLayer))),
  );
});
