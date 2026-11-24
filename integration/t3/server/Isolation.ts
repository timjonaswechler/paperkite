import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

export class InvalidRuntimeLocation extends Schema.TaggedError<InvalidRuntimeLocation>()(
  "PaperkiteInvalidRuntimeLocation",
  { reason: Schema.String },
) {
  override get message(): string {
    return `Paperkite runtime location refused: ${this.reason}.`;
  }
}

export const resolve = Effect.fn("Paperkite.resolveIsolation")(function* (
  root: string,
  home: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const realRoot = yield* fs.realPath(root);
  const target = path.resolve(home);
  const local = path.join(realRoot, ".local");
  if (!target.startsWith(local + path.sep)) {
    return yield* new InvalidRuntimeLocation({
      reason: "home must be below this checkout's .local directory",
    });
  }
  const manifest = yield* fs.readFileString(path.join(realRoot, "package.json"));
  yield* Schema.decodeEffect(
    Schema.fromJsonString(Schema.Struct({ name: Schema.Literal("paperkite") })),
  )(manifest);
  let current = target;
  while (!(yield* fs.exists(current))) current = path.dirname(current);
  const existing = yield* fs.realPath(current);
  if (existing !== current) {
    return yield* new InvalidRuntimeLocation({
      reason: "home cannot traverse symlinked directories",
    });
  }
  return { root: realRoot, home: target, workspace: path.join(target, "workspaces") };
});
