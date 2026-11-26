import * as NodeServices from "@effect/platform-node/NodeServices";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Isolation from "./integration/Isolation.ts";

const permitted = new Set([
  "auth",
  "pair",
  "thread",
  "project",
  "providers",
  "__document-text",
  "__managed-chatgpt-token",
  "__speech-worker",
  "__cursor-sdk-worker",
  "acp-mcp-bridge",
  "acp-mcp-call",
]);

if (import.meta.main) {
  const command = await Effect.gen(function* () {
    const args = (yield* HostProcess.Arguments).slice(2);
    if (!permitted.has(args[0] ?? "")) {
      return yield* new Isolation.InvalidRuntimeLocation({
        reason: "this launcher exposes no native update or service commands",
      });
    }
    const root = yield* Config.String("PAPERKITE_ROOT");
    if (
      args.some((arg) => arg.startsWith("--base-dir=")) ||
      args.filter((arg) => arg === "--base-dir").length > 1
    ) {
      return yield* new Isolation.InvalidRuntimeLocation({
        reason: "ambiguous native data-home arguments",
      });
    }
    const index = args.indexOf("--base-dir");
    const home = index >= 0 ? args[index + 1] : yield* Config.String("T3CODE_HOME");
    if (!home)
      return yield* new Isolation.InvalidRuntimeLocation({
        reason: "an explicit data home is required",
      });
    yield* Isolation.resolve(root, home);
    return args[0];
  }).pipe(Effect.provide(NodeServices.layer), Effect.runPromise);
  if (["auth", "pair", "thread", "project", "providers"].includes(command ?? "")) {
    const { ignoreMacosTypeOfServiceEinval } = await import("../outboundHttp.ts");
    ignoreMacosTypeOfServiceEinval();
    const { runCli } = await import("../binCli.ts");
    const Runtime = await import("./integration/Runtime.ts");
    runCli(Runtime.status("proof"));
  } else {
    const { runCliCommand } = await import("../binMain.ts");
    await runCliCommand();
  }
}
