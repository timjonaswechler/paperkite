import type {
  SourceControlDriver,
  SourceControlDriverInstance,
} from "@t3tools/source-control-core/server/driver";
import * as Context from "effect/Context";
import * as Layer from "effect/Layer";

export interface SourceControlDriverEntry {
  readonly driver: Pick<SourceControlDriver, "kind" | "definition">;
  readonly instance: SourceControlDriverInstance;
}

export class SourceControlDrivers extends Context.Service<
  SourceControlDrivers,
  ReadonlyArray<SourceControlDriverEntry>
>()("t3/sourceControl/builtInDrivers/SourceControlDrivers") {}

export const layer = Layer.succeed(SourceControlDrivers, []);
