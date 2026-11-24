import { ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as ServerSettings from "../../serverSettings.ts";
import * as Runtime from "./Runtime.ts";

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    if ((yield* Runtime.Profile)?.profile !== "proof") return;
    const settings = yield* ServerSettings.ServerSettingsService;
    const path = yield* Path.Path;
    const commandPath = yield* HostProcess.ExecutablePath;
    const agentPath = yield* path.fromFileUrl(
      new URL("../../../scripts/dev-replay-agent.ts", import.meta.url),
    );
    yield* settings.updateProviderInstance({
      operation: "upsert",
      instanceId: ProviderInstanceId.make("devReplay"),
      instance: {
        displayName: "Replay (dev)",
        driver: ProviderDriverKind.make("acpRegistry"),
        config: { source: "local", commandPath, commandArgs: [agentPath] },
      },
    });
  }),
);
