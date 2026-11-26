import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as NetService from "@t3tools/shared/Net";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { Command, Flag } from "effect/cli";

import * as ServerConfig from "../config.ts";
import { resolveServerConfig } from "../cli/config.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as Isolation from "./integration/Isolation.ts";
import * as Runtime from "./integration/Runtime.ts";

const command = Command.make(
  "paperkite",
  {
    root: Flag.String("root"),
    home: Flag.String("home"),
    port: Flag.Int("port").pipe(Flag.withDefault(14773)),
    staticDir: Flag.String("static-dir"),
    profile: Flag.Literals("profile", ["native", "proof"]).pipe(Flag.withDefault("proof")),
  },
  Effect.fn("Paperkite.serve")(function* (flags) {
    const location = yield* Isolation.resolve(flags.root, flags.home);
    const path = yield* Path.Path;
    const config = yield* resolveServerConfig(
      {
        baseDir: Option.some(location.home),
        cwd: Option.some(location.workspace),
        mode: Option.some("web"),
        port: Option.some(flags.port),
        host: Option.some("127.0.0.1"),
        devUrl: Option.none(),
        noBrowser: Option.some(true),
        bootstrapFd: Option.none(),
        autoBootstrapProjectFromCwd: Option.some(false),
        logWebSocketEvents: Option.some(false),
        tailscaleServeEnabled: Option.some(false),
        tailscaleServePort: Option.none(),
        lan: Option.some(false),
      },
      Option.none(),
      { startupPresentation: "headless", rejectRunningServer: true },
    );
    const { runServer } = yield* Effect.promise(() => import("../server.ts"));
    const env = yield* HostProcess.Environment;
    return yield* runServer.pipe(
      Effect.provideService(HostProcess.Environment, {
        ...env,
        T3CODE_CLI_PATH: path.join(location.root, "tooling/paperkite"),
        T3CODE_HOME: location.home,
        PAPERKITE_ROOT: location.root,
      }),
      Effect.provideService(ServerConfig.ServerConfig, {
        ...config,
        staticDir: path.resolve(flags.staticDir),
      }),
      Effect.provideService(Runtime.Profile, Runtime.status(flags.profile)),
    );
  }),
);

if (import.meta.main) {
  Effect.gen(function* () {
    const env = { ...(yield* HostProcess.Environment) };
    for (const key of Object.keys(env)) {
      if (
        key.startsWith("T3CODE_") ||
        key.startsWith("T3_BOOT_") ||
        key.startsWith("T3_LAUNCHER_") ||
        key.startsWith("VITE_")
      )
        delete env[key];
    }
    yield* Command.run(command, { version: "0.0.0" }).pipe(
      Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromUnknown({})),
      Effect.provideService(HostProcess.Environment, env),
    );
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        NodeServices.layer,
        NodeCrypto.layer,
        NetService.layer,
        ProcessRunner.layer.pipe(Layer.provide(NodeServices.layer)),
      ),
    ),
    NodeRuntime.runMain,
  );
}
