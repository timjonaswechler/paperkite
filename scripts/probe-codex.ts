import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import * as Client from "../server/upstream/codex/client.ts";
await Effect.runPromise(
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const handle = yield* spawner.spawn(
      ChildProcess.make("/home/redjoker/.local/bin/codex", ["app-server"], {
        cwd: "/tmp",
        extendEnv: false,
        env: { HOME: "/home/redjoker", PATH: "/usr/bin:/bin", LANG: "C.UTF-8" },
      }),
    );
    const context = yield* Layer.build(Client.layerChildProcess(handle));
    const client = context.mapUnsafe.get(
      Client.CodexAppServerClient.key,
    ) as Client.CodexAppServerClient["Service"];
    console.log(
      "initialize",
      yield* client.request("initialize", {
        clientInfo: { name: "bewerbung_probe", version: "0.1.0" },
        capabilities: { experimentalApi: true },
      }),
    );
    yield* client.notify("initialized", undefined);
    const account = yield* client.request("account/read", {
      refreshToken: false,
    });
    console.log("auth", {
      authenticated: !!account.account,
      type: account.account?.type,
    });
    const models = yield* client.request("model/list", {});
    console.log(
      "models",
      models.data.map((m) => ({
        id: m.id,
        model: m.model,
        isDefault: m.isDefault,
      })),
    );
  }).pipe(
    Effect.scoped,
    Effect.provide(NodeServices.layer),
    Effect.timeout("30 seconds"),
  ),
);
