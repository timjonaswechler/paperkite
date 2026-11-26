import * as NodeWorkerThreads from "node:worker_threads";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Scope from "effect/Scope";
import * as TestClock from "effect/testing/TestClock";
import { vi } from "vite-plus/test";

import * as WorkspaceSearchIndex from "./WorkspaceSearchIndex.ts";

const fixture = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const cwd = yield* fs.realPath(
    yield* fs.makeTempDirectoryScoped({ prefix: "paperkite-search-" }),
  );
  const home = yield* fs.makeTempDirectoryScoped({ prefix: "paperkite-search-home-" });
  const write = Effect.fn("test.write")(function* (name: string, text = "") {
    const full = path.join(cwd, name);
    yield* fs.makeDirectory(path.dirname(full), { recursive: true });
    yield* fs.writeFileString(full, text);
  });
  const index = (variant: WorkspaceSearchIndex.WorkspaceSearchIndexVariant = "paths") =>
    WorkspaceSearchIndex.make(cwd, variant).pipe(
      Effect.provideService(HostProcess.HomeDirectory, home),
      Effect.provideService(HostProcess.Environment, { HOME: home, PATH: "" }),
    );
  return { fs, path, cwd, write, index };
});
const contents = (
  index: WorkspaceSearchIndex.WorkspaceSearchIndex["Service"],
  input: Partial<Parameters<typeof index.searchContents>[0]> = {},
) =>
  index.searchContents({
    query: "needle",
    limit: 500,
    caseSensitive: true,
    wholeWord: false,
    useRegex: false,
    ...input,
  });

it.live(
  "searches real cold and warm contents without Git and never scans excluded directories",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      yield* f.write(".git/config", "[core]\nexcludesFile = .git/excludes\n");
      yield* f.write(".git/excludes", "configured.txt\n");
      yield* f.write(".git/info/exclude", "info.txt\n");
      yield* f.write(".git/objects/never-open", "needle\n");
      yield* f.write(".gitignore", "ignored/\n");
      yield* f.write(".ignore", "custom/\n");
      for (const name of ["ignored/deep/a.txt", "custom/deep/a.txt", "info.txt", "configured.txt"])
        yield* f.write(name, "needle\n");
      yield* f.write("src/keep.ts", "none\r\nneedle needle\r\n");
      const visited: string[] = [];
      const wrapped = {
        ...f.fs,
        readDirectoryEntries: (dir: string) => {
          visited.push(f.path.relative(f.cwd, dir));
          return f.fs.readDirectoryEntries(dir);
        },
      };
      yield* Effect.acquireRelease(
        Effect.sync(() => vi.stubEnv("PATH", "")),
        () => Effect.sync(() => vi.unstubAllEnvs()),
      );
      const index = yield* f
        .index("content")
        .pipe(Effect.provideService(FileSystem.FileSystem, wrapped));
      const expected = {
        matches: [
          {
            path: "src/keep.ts",
            lineNumber: 2,
            lineContent: "needle needle",
            matchRanges: [
              { start: 0, end: 6 },
              { start: 7, end: 13 },
            ],
          },
        ],
        truncated: false,
      };
      expect(yield* contents(index)).toEqual(expected);
      expect(yield* contents(index)).toEqual(expected);
      expect(visited.toSorted()).toEqual(["", "src"]);
      expect((yield* index.list()).entries.map((entry) => entry.path)).not.toContain(
        "configured.txt",
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.live(
  "prefilters filename results by kind and images, preserves literal braces, and supports fuzzy/glob paths",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      for (const name of [
        "src/app/game/[id]/index.tsx",
        "src/foo{bar}.ts",
        "src/main.ts",
        "src/notes.md",
        "assets/logo.ts",
        "assets/logo.PNG",
        "assets/logo.svg",
      ])
        yield* f.write(name);
      yield* f.write("binary.png", "\0binary");
      const index = yield* f.index();
      expect((yield* index.search("srmn", 1, "file")).entries).toEqual([
        { path: "src/main.ts", kind: "file" },
      ]);
      expect((yield* index.search("src", 1, "file")).truncated).toBe(true);
      expect(yield* index.search("logo", 1, "directory", true)).toEqual({
        entries: [{ path: "assets/logo.PNG", kind: "file" }],
        truncated: true,
      });
      for (const query of ["game/[i", "game/[id]"])
        expect((yield* index.search(query, 20)).entries.map((e) => e.path)).toContain(
          "src/app/game/[id]/index.tsx",
        );
      expect((yield* index.search("foo{bar}.ts", 20)).entries.map((e) => e.path)).toEqual([
        "src/foo{bar}.ts",
      ]);
      for (const [query, expected] of [
        [
          "*.{ts,tsx}",
          ["assets/logo.ts", "src/app/game/[id]/index.tsx", "src/foo{bar}.ts", "src/main.ts"],
        ],
        ["*.{ts}", ["assets/logo.ts", "src/foo{bar}.ts", "src/main.ts"]],
        ["src/{main}.ts", ["src/main.ts"]],
        ["src/{foo{bar},notes}.md", ["src/notes.md"]],
      ] as const) {
        const result = (yield* index.search(query, 20, "file")).entries
          .map((e) => e.path)
          .toSorted();
        expect(result).toEqual([...expected].toSorted());
      }
      expect((yield* index.search("binary", 10, "file", true)).entries).toEqual([
        { path: "binary.png", kind: "file" },
      ]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.live(
  "keeps safe file and directory aliases without traversing links, outside roots, cycles or .git",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      const outside = yield* f.fs.makeTempDirectoryScoped({ prefix: "paperkite-outside-" });
      yield* f.write("src/keep.ts", "needle\n");
      yield* f.write(".git/secret", "needle\n");
      yield* f.fs.symlink("src", f.path.join(f.cwd, "src-alias"));
      yield* f.fs.symlink("src/keep.ts", f.path.join(f.cwd, "file-alias.ts"));
      yield* f.fs.symlink(outside, f.path.join(f.cwd, "outside"));
      yield* f.fs.symlink("..", f.path.join(f.cwd, "src/back"));
      yield* f.fs.symlink(".git", f.path.join(f.cwd, "git-alias"));
      yield* f.fs.symlink("missing", f.path.join(f.cwd, "broken"));
      const index = yield* f.index();
      expect((yield* index.list()).entries).toEqual(
        [
          { path: "file-alias.ts", kind: "file" },
          { path: "src", kind: "directory" },
          { path: "src-alias", kind: "directory" },
          { path: "src/keep.ts", kind: "file" },
        ].toSorted((a, b) => a.path.localeCompare(b.path)),
      );
      expect((yield* contents(index)).matches.map((m) => m.path)).toEqual([
        "file-alias.ts",
        "src/keep.ts",
      ]);
      yield* f.fs.remove(f.path.join(f.cwd, "file-alias.ts"));
      yield* f.fs.symlink(f.path.join(outside, "secret"), f.path.join(f.cwd, "file-alias.ts"));
      expect((yield* index.search("alias", 20)).entries).toEqual([
        { path: "src-alias", kind: "directory" },
      ]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.live(
  "uses UTF-16 ranges and Unicode whole-word boundaries, preserves regex escapes and literal fallback",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      yield* f.write(
        "words.ts",
        "𐐀foo foo foo𐐀\nhéllo wörld\n-foo- -foo- -foo-\nSquare\nsquare\ncall(Foo(bar));\n",
      );
      const index = yield* f.index("content");
      expect(
        (yield* contents(index, { query: "foo", wholeWord: true })).matches.map((m) => [
          m.lineNumber,
          m.matchRanges,
        ]),
      ).toEqual([
        [1, [{ start: 6, end: 9 }]],
        [
          3,
          [
            { start: 1, end: 4 },
            { start: 7, end: 10 },
            { start: 13, end: 16 },
          ],
        ],
      ]);
      expect((yield* contents(index, { query: "wörld" })).matches[0]?.matchRanges).toEqual([
        { start: 6, end: 11 },
      ]);
      expect(
        (yield* contents(index, { query: "-foo-", wholeWord: true })).matches[0]?.matchRanges,
      ).toEqual([
        { start: 0, end: 5 },
        { start: 6, end: 11 },
        { start: 12, end: 17 },
      ]);
      expect(
        (yield* contents(index, {
          query: "\\SQUARE",
          useRegex: true,
          caseSensitive: false,
        })).matches.map((m) => m.lineNumber),
      ).toEqual([4, 5]);
      expect(
        (yield* contents(index, { query: "Square" })).matches.map((m) => m.lineNumber),
      ).toEqual([4]);
      const invalid = yield* contents(index, {
        query: "foo(",
        useRegex: true,
        caseSensitive: false,
      });
      expect(invalid.regexFallbackError).toBeDefined();
      expect(invalid.matches).toEqual([
        {
          path: "words.ts",
          lineNumber: 6,
          lineContent: "call(Foo(bar));",
          matchRanges: [{ start: 5, end: 9 }],
        },
      ]);
      expect(
        (yield* contents(index, { query: "*.ts foo", wholeWord: true })).matches.map(
          (m) => m.lineNumber,
        ),
      ).toEqual([1, 3]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.live(
  "finds late whole words, retains long-line hits, caps dense files, and reads edits without rebuilding",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      yield* f.write("a.txt", `${"needleSuffix\n".repeat(140)}needle\n`);
      yield* f.write("dense.txt", "needle\n".repeat(300));
      yield* f.write("long.txt", `${"x".repeat(600)} needleSuffix\n`);
      yield* f.write("other.txt", "needle\n");
      const index = yield* f.index("content");
      expect((yield* contents(index, { wholeWord: true, limit: 1 })).matches).toEqual([
        {
          path: "a.txt",
          lineNumber: 141,
          lineContent: "needle",
          matchRanges: [{ start: 0, end: 6 }],
        },
      ]);
      const result = yield* contents(index);
      expect(result.matches.filter((m) => m.path === "dense.txt")).toHaveLength(100);
      expect(result.matches.filter((m) => m.path === "other.txt")).toHaveLength(1);
      expect(result.matches.find((m) => m.path === "long.txt")).toMatchObject({
        lineNumber: 1,
        matchRanges: [],
      });
      expect(
        (yield* contents(index, { wholeWord: true })).matches.some((m) => m.path === "long.txt"),
      ).toBe(false);
      yield* f.write("other.txt", "updated needle\n");
      expect(
        (yield* contents(index)).matches.find((m) => m.path === "other.txt")?.matchRanges,
      ).toEqual([{ start: 8, end: 14 }]);
      yield* f.write(".ignore", "other.txt\n");
      expect((yield* contents(index)).matches.some((m) => m.path === "other.txt")).toBe(false);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("coalesces refreshes while serving and refiltering the last completed snapshot", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    yield* f.write("old.txt", "needle\n");
    const started = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    let scanStarted = started;
    let scanRelease = release;
    let hold = false;
    let scans = 0;
    const wrapped = {
      ...f.fs,
      readDirectoryEntries: (dir: string) =>
        Effect.gen(function* () {
          if (dir === f.cwd) {
            scans += 1;
            if (hold) {
              yield* Deferred.succeed(scanStarted, undefined);
              yield* Deferred.await(scanRelease);
            }
          }
          return yield* f.fs.readDirectoryEntries(dir);
        }),
    };
    const index = yield* f.index().pipe(Effect.provideService(FileSystem.FileSystem, wrapped));
    yield* index.list();
    yield* index.list();
    expect(scans).toBe(1);
    hold = true;
    const refresh = yield* Effect.forkChild(index.refresh());
    yield* Deferred.await(started);
    const concurrentRefresh = yield* Effect.forkChild(index.refresh(), { startImmediately: true });
    yield* f.write("new.txt");
    expect((yield* index.list()).entries).toEqual([{ path: "old.txt", kind: "file" }]);
    yield* f.write(".ignore", "old.txt\n");
    expect((yield* index.list()).entries).toEqual([]);
    yield* Deferred.succeed(release, undefined);
    yield* Fiber.join(refresh);
    yield* Fiber.join(concurrentRefresh);
    expect((yield* index.list()).entries.map((e) => e.path)).toEqual([".ignore", "new.txt"]);
    expect(scans).toBe(2);
    scanStarted = yield* Deferred.make<void>();
    scanRelease = yield* Deferred.make<void>();
    yield* TestClock.adjust("3 seconds");
    yield* index.list();
    yield* Deferred.await(scanStarted);
    const expiredRefresh = yield* Effect.forkChild(index.refresh(), { startImmediately: true });
    expect(scans).toBe(3);
    yield* Deferred.succeed(scanRelease, undefined);
    yield* Fiber.join(expiredRefresh);
    expect(scans).toBe(3);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("times out a cold scan honestly and reuses its completion for subsequent contents", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    yield* f.write("found.txt", "needle\n");
    const started = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    const wrapped = {
      ...f.fs,
      readDirectoryEntries: (dir: string) =>
        Effect.gen(function* () {
          if (dir === f.cwd) {
            yield* Deferred.succeed(started, undefined);
            yield* Deferred.await(release);
          }
          return yield* f.fs.readDirectoryEntries(dir);
        }),
    };
    const index = yield* f
      .index("content")
      .pipe(Effect.provideService(FileSystem.FileSystem, wrapped));
    const cold = yield* Effect.forkChild(contents(index).pipe(Effect.flip));
    yield* Deferred.await(started);
    yield* TestClock.adjust("15 seconds");
    expect((yield* Fiber.join(cold))._tag).toBe("WorkspaceSearchIndexScanTimedOut");
    yield* Deferred.succeed(release, undefined);
    yield* index.refresh();
    expect((yield* contents(index)).matches.map((match) => match.path)).toEqual(["found.txt"]);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.live("bounds catastrophic regex matching, terminates its worker, and remains usable", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    yield* f.write("pathological.txt", `${"a".repeat(40_000)}!`);
    const workers: NodeWorkerThreads.Worker[] = [];
    const terminate = NodeWorkerThreads.Worker.prototype.terminate;
    using _spy = vi
      .spyOn(NodeWorkerThreads.Worker.prototype, "terminate")
      .mockImplementation(function (this: NodeWorkerThreads.Worker) {
        workers.push(this);
        return terminate.call(this);
      });
    const index = yield* f.index("content");
    const failure = yield* contents(index, { query: "(a+)+$", useRegex: true }).pipe(Effect.flip);
    expect(failure._tag).toBe("WorkspaceSearchIndexSearchFailed");
    expect(failure).toMatchObject({
      reason: "Content matching exceeded its per-file time budget.",
    });
    expect(workers).toHaveLength(1);
    expect(workers[0]?.threadId).toBe(-1);
    yield* f.write("pathological.txt", "needle\n");
    expect((yield* contents(index)).matches).toHaveLength(1);
    expect(workers).toHaveLength(2);
    expect(workers[1]?.threadId).toBe(-1);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.live("terminates an active worker on request cancellation and index scope disposal", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    yield* f.write("pathological.txt", `${"a".repeat(40_000)}!`);
    const owner = yield* Scope.make();
    const index = yield* f.index("content").pipe(Scope.provide(owner));
    const post = NodeWorkerThreads.Worker.prototype.postMessage;
    const workers: NodeWorkerThreads.Worker[] = [];
    for (const dispose of [false, true]) {
      let posted = () => {};
      const onPosted = new Promise<void>((resolve) => {
        posted = resolve;
      });
      using _spy = vi
        .spyOn(NodeWorkerThreads.Worker.prototype, "postMessage")
        .mockImplementation(function (this: NodeWorkerThreads.Worker, value, transfer) {
          workers.push(this);
          post.call(this, value, transfer);
          posted();
        });
      const search = yield* Effect.forkChild(contents(index, { query: "(a+)+$", useRegex: true }));
      yield* Effect.promise(() => onPosted);
      if (dispose) {
        yield* Scope.close(owner, Exit.void);
        expect(Exit.isFailure(yield* Fiber.await(search))).toBe(true);
      } else yield* Fiber.interrupt(search);
      expect(workers.at(-1)?.threadId).toBe(-1);
    }
    expect((yield* index.list().pipe(Effect.flip))._tag).toBe("WorkspaceSearchIndexSearchFailed");
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.live("fails on unreadable filter metadata rather than leaking the previous snapshot", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    yield* f.write("visible.txt", "needle\n");
    const index = yield* f.index();
    expect((yield* index.list()).entries).toEqual([{ path: "visible.txt", kind: "file" }]);
    yield* f.write(".git", "invalid metadata pointer\n");
    expect((yield* index.list().pipe(Effect.flip))._tag).toBe("WorkspaceSearchIndexSearchFailed");
    expect((yield* index.search("visible", 5).pipe(Effect.flip))._tag).toBe(
      "WorkspaceSearchIndexSearchFailed",
    );
    expect((yield* contents(index).pipe(Effect.flip))._tag).toBe(
      "WorkspaceSearchIndexSearchFailed",
    );
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("sorts before applying the list cap and reports truncation", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    const children = Array.from({ length: 25_003 }, (_, index) => ({
      name: `${String(25_002 - index).padStart(5, "0")}.txt`,
      type: "File" as const,
    }));
    const wrapped = {
      ...f.fs,
      readDirectoryEntries: (dir: string) =>
        dir === f.cwd ? Effect.succeed(children) : f.fs.readDirectoryEntries(dir),
    };
    const index = yield* f.index().pipe(Effect.provideService(FileSystem.FileSystem, wrapped));
    const result = yield* index.list();
    expect(result.entries).toHaveLength(25_000);
    expect(result.entries[0]?.path).toBe("00000.txt");
    expect(result.entries.at(-1)?.path).toBe("24999.txt");
    expect(result.truncated).toBe(true);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
