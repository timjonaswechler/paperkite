import * as NodeServices from "@effect/platform-node/NodeServices";
import { DEFAULT_SERVER_SETTINGS } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import { TestClock } from "effect/testing";
import * as ServerConfig from "./config.ts";
import { ServerActivation } from "./serverActivation.ts";
import * as Settings from "./serverSettings.ts";
import * as StorageCleanup from "./storageCleanup.ts";

const cleanupFixture = Effect.fn("StorageCleanupTest.fixture")(function* (
  activation: Effect.Effect<void> = Effect.never,
) {
  const fs = yield* FileSystem.FileSystem;
  const config = yield* ServerConfig.ServerConfig;
  const settings = {
    ...DEFAULT_SERVER_SETTINGS,
    storageCleanup: {
      ...DEFAULT_SERVER_SETTINGS.storageCleanup,
      worktreeAfterDays: 0,
      worktreeOnDelete: true,
      browserArtifactsAfterDays: 8,
      logsAfterDays: 8,
    },
  };
  const context = yield* Layer.build(
    StorageCleanup.layer.pipe(
      Layer.provide(
        Layer.mock(Settings.ServerSettingsService)({
          getSettings: Effect.succeed(settings),
          subscribeChanges: Effect.succeed(Stream.never),
        }),
      ),
    ),
  ).pipe(Effect.provideService(ServerActivation, activation));
  return { fs, config, service: Context.get(context, StorageCleanup.StorageCleanup) };
});

const cleanupTestLayer = ServerConfig.layerTest(process.cwd(), { prefix: "storage-cleanup-" }).pipe(
  Layer.provideMerge(NodeServices.layer),
);
const runCleanupTest = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  TestClock.setTime(Date.parse("2026-01-01T00:00:00Z")).pipe(
    Effect.andThen(effect),
    Effect.provide(cleanupTestLayer),
  );

describe("storage cleanup reports and local file policies", () => {
  it.effect(
    "cleans expired artifacts and rotated logs while retaining current logs and saved checkouts",
    () =>
      runCleanupTest(
        Effect.gen(function* () {
          const activation = yield* Deferred.make<void>();
          const { service, fs, config } = yield* cleanupFixture(Deferred.await(activation));
          yield* fs.makeDirectory(config.browserArtifactsDir, { recursive: true });
          yield* fs.makeDirectory(config.logsDir, { recursive: true });
          for (const name of ["one.png", "two.webm"]) {
            const file = config.browserArtifactsDir + "/" + name;
            yield* fs.writeFileString(file, "capture");
            yield* fs.utimes(file, 1, 1);
          }
          for (const name of ["server.log.1", "server.log.2", "server.log"]) {
            const file = config.logsDir + "/" + name;
            yield* fs.writeFileString(file, "log");
            yield* fs.utimes(file, 1, 1);
          }
          const worktree = `${config.worktreesDir}/saved-checkout`;
          yield* fs.makeDirectory(worktree, { recursive: true });
          yield* fs.writeFileString(`${worktree}/.git`, "gitdir: ../saved-admin");
          const savedRef = `${config.worktreesDir}/saved-admin/refs/t3/checkpoint`;
          yield* fs.makeDirectory(`${config.worktreesDir}/saved-admin/refs/t3`, {
            recursive: true,
          });
          yield* fs.writeFileString(savedRef, "previous-checkpoint");
          yield* fs.utimes(`${worktree}/.git`, 1, 1);
          yield* fs.utimes(savedRef, 1, 1);
          expect(yield* service.latestReport).toBeNull();
          yield* Deferred.succeed(activation, undefined);
          const [report] = yield* service.reports.pipe(
            Stream.filter((report) => report !== null),
            Stream.take(1),
            Stream.runCollect,
          );
          expect(report?.trigger).toBe("automatic");
          expect(yield* fs.readFileString(`${worktree}/.git`)).toBe("gitdir: ../saved-admin");
          expect(yield* fs.readFileString(savedRef)).toBe("previous-checkpoint");
          expect(report?.entries).toMatchObject([
            {
              kind: "browser-artifacts",
              outcome: "removed",
              reason: "Removed 2 browser artifacts",
              bytes: 14,
              files: 2,
            },
            {
              kind: "logs",
              outcome: "removed",
              reason: "Removed 2 rotated logs",
              bytes: 6,
              files: 2,
            },
          ]);
          expect(report?.bytesFreed).toBe(20);
          expect(yield* fs.readDirectory(config.browserArtifactsDir)).toEqual([]);
          expect(yield* fs.exists(config.logsDir + "/server.log")).toBe(true);
          expect(yield* fs.exists(config.logsDir + "/server.log.1")).toBe(false);
          expect(yield* fs.exists(config.logsDir + "/server.log.2")).toBe(false);
        }),
      ),
  );
  it.effect.each([
    { kind: "logs", name: "server.log.1", label: "rotated logs" },
    { kind: "browser-artifacts", name: "capture.png", label: "browser artifacts" },
  ] as const)("skips dangling symlinks during $kind cleanup", ({ kind, name, label }) =>
    runCleanupTest(
      Effect.gen(function* () {
        const { service, fs, config } = yield* cleanupFixture();
        const directory = kind === "logs" ? `${config.logsDir}/nested` : config.browserArtifactsDir;
        yield* fs.makeDirectory(directory, { recursive: true });
        const expired = `${directory}/${name}`;
        const dangling = `${directory}/00-dangling-${name}`;
        const linked = `${directory}/01-linked-${name}`;
        yield* fs.symlink("missing", dangling);
        yield* fs.symlink(directory, linked);
        yield* fs.writeFileString(expired, "expired");
        yield* fs.utimes(expired, 1, 1);

        const report = yield* service.runNow;
        expect(report.entries.filter((entry) => entry.kind === kind)).toMatchObject([
          { outcome: "removed", reason: `Removed 1 ${label}`, files: 1, bytes: 7 },
        ]);
        expect((yield* fs.readDirectory(directory)).toSorted()).toEqual([
          `00-dangling-${name}`,
          `01-linked-${name}`,
        ]);
      }),
    ),
  );
  it.effect.each([
    { linked: "home", outcome: "removed", reason: "Removed 1 rotated logs" },
    { linked: "logs folder", outcome: "kept", reason: "No expired files" },
  ] as const)(
    "rotated logs behind a symlinked $linked are $outcome",
    ({ linked, outcome, reason }) =>
      runCleanupTest(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const config = yield* ServerConfig.ServerConfig;
          const disk = yield* fs.realPath(yield* fs.makeTempDirectoryScoped());
          yield* fs.makeDirectory(`${disk}/real/logs`, { recursive: true });
          if (linked === "home") {
            yield* fs.symlink(`${disk}/real`, `${disk}/home`);
          } else {
            yield* fs.makeDirectory(`${disk}/home`);
            yield* fs.symlink(`${disk}/real/logs`, `${disk}/home/logs`);
          }
          yield* fs.writeFileString(`${disk}/real/logs/server.log.1`, "log");
          yield* fs.utimes(`${disk}/real/logs/server.log.1`, 1, 1);
          const { service } = yield* cleanupFixture().pipe(
            Effect.provideService(ServerConfig.ServerConfig, {
              ...config,
              logsDir: `${disk}/home/logs`,
            }),
          );
          const report = yield* service.runNow;
          expect(report.entries.filter((entry) => entry.kind === "logs")).toMatchObject([
            { outcome, reason },
          ]);
          expect(yield* fs.exists(`${disk}/real/logs/server.log.1`)).toBe(outcome === "kept");
        }),
      ),
  );
  it.effect("keeps external rotated logs when a scanned directory is replaced by a symlink", () =>
    runCleanupTest(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const config = yield* ServerConfig.ServerConfig;
        yield* fs.makeDirectory(config.logsDir, { recursive: true });
        const nested = `${yield* fs.realPath(config.logsDir)}/nested`;
        const outside = yield* fs.makeTempDirectoryScoped();
        const expired = `${outside}/server.log.1`;
        yield* fs.makeDirectory(nested);
        yield* fs.writeFileString(expired, "external log");
        yield* fs.utimes(expired, 1, 1);

        const { service } = yield* cleanupFixture().pipe(
          Effect.provideService(FileSystem.FileSystem, {
            ...fs,
            readDirectory: (directory, options) =>
              Effect.gen(function* () {
                if (directory === nested) {
                  yield* fs.rename(nested, `${nested}-original`);
                  yield* fs.symlink(outside, nested);
                }
                return yield* fs.readDirectory(directory, options);
              }),
          }),
        );
        const report = yield* service.runNow;
        expect(yield* fs.exists(expired)).toBe(true);
        expect(report.entries.find((entry) => entry.kind === "logs")).toMatchObject({
          outcome: "kept",
          reason: "No expired files",
        });
      }),
    ),
  );
});
