// Fixture setup and independent oracles use Node; the production policy uses Effect services.
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";

import * as WorkspaceFilePolicy from "./WorkspaceFilePolicy.ts";

const fixture = Effect.fn(function* (repository = true) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const directory = yield* fs.makeTempDirectoryScoped({ prefix: "paperkite-file-policy-" });
  const cwd = path.join(directory, "workspace");
  const home = path.join(directory, "home");
  yield* fs.makeDirectory(cwd);
  yield* fs.makeDirectory(home);
  const environment = {
    HOME: home,
    PATH: "/usr/bin:/bin",
    GIT_CONFIG_NOSYSTEM: "1",
    XDG_CONFIG_HOME: path.join(home, ".config"),
    GIT_TERMINAL_PROMPT: "0",
  };
  const git = (
    args: ReadonlyArray<string>,
    input?: string,
    gitCwd = cwd,
    overrides: NodeJS.ProcessEnv = {},
  ) =>
    Effect.sync(() => {
      const result = NodeChildProcess.spawnSync("git", ["-c", "init.defaultBranch=main", ...args], {
        cwd: gitCwd,
        env: { ...environment, ...overrides },
        encoding: "utf8",
        ...(input === undefined ? {} : { input }),
      });
      if (result.error) throw result.error;
      expect(result.status, `fixture git ${args[0]}`).toBe(
        args[0] === "check-ignore" && result.status === 1 ? 1 : 0,
      );
      return result.stdout;
    });
  const write = Effect.fn("Fixture.write")(function* (name: string, contents = "") {
    const absolute = path.resolve(cwd, name);
    yield* fs.makeDirectory(path.dirname(absolute), { recursive: true });
    yield* fs.writeFileString(absolute, contents);
  });
  const policy = (fileSystem = fs, policyCwd = cwd, overrides: NodeJS.ProcessEnv = {}) =>
    WorkspaceFilePolicy.make(policyCwd).pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(HostProcess.HomeDirectory, home),
      Effect.provideService(HostProcess.Environment, {
        ...environment,
        ...overrides,
        PATH: "/no-executables",
      }),
    );
  if (repository) yield* git(["init", "--template="]);
  const expected = (
    names: ReadonlyArray<string>,
    gitCwd = cwd,
    overrides: NodeJS.ProcessEnv = {},
  ) =>
    git(["check-ignore", "-z", "--stdin"], `${names.join("\0")}\0`, gitCwd, overrides).pipe(
      Effect.map((output) => new Set(output.split("\0").filter(Boolean))),
    );
  return { fs, path, cwd, home, directory, write, git, policy, expected };
});

const file = (path: string) => ({ path, kind: "file" as const });
const folder = (path: string) => ({ path, kind: "directory" as const });
const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.scoped(effect).pipe(Effect.provide(NodeServices.layer));

describe("WorkspaceFilePolicy", () => {
  it.effect(
    "uses literal tracked paths and descendant directories for browse only, in index v2/v3/v4",
    () =>
      run(
        Effect.gen(function* () {
          for (const version of [2, 3, 4]) {
            const f = yield* fixture();
            const longName = `tracked/${"a".repeat(180)}/kept.txt`;
            yield* f.write(longName);
            yield* f.write("tracked/other.txt");
            yield* f.write("z.txt");
            yield* f.write("i/page.tsx");
            yield* f.write("[id]/page.tsx");
            yield* f.git(["add", longName, "z.txt", "i/page.tsx"]);
            // v3's extended flags and v4's multi-byte prefix stripping must both be read.
            if (version === 3) yield* f.git(["update-index", "--skip-worktree", "z.txt"]);
            yield* f.git(["update-index", "--index-version", String(version)]);
            yield* f.write(".gitignore", "tracked/\nz.txt\n\\[id\\]/\n");
            const entries = [
              folder("tracked"),
              folder(`tracked/${"a".repeat(180)}`),
              file(longName),
              file("tracked/other.txt"),
              file("z.txt"),
              file("i/page.tsx"),
              file("[id]/page.tsx"),
            ];
            const policy = yield* f.policy();
            const names = entries.map((entry) => entry.path);
            const oracle = yield* f.expected(names);
            // Git's index lookup treats [id] as pathspec magic. The policy must not reproduce that leak.
            oracle.add("[id]/page.tsx");
            expect(yield* policy.ignored(entries, "browse")).toEqual(oracle);
            expect(yield* policy.ignored(entries, "search")).toEqual(
              new Set([
                "tracked",
                `tracked/${"a".repeat(180)}`,
                longName,
                "tracked/other.txt",
                "z.txt",
                "[id]/page.tsx",
              ]),
            );
          }
        }),
      ),
  );

  it.effect("preserves Git hierarchy, ignored-parent negation and byte-based wildcard syntax", () =>
    run(
      Effect.gen(function* () {
        const f = yield* fixture();
        yield* f.write(
          ".gitignore",
          "\uFEFFblocked/\n!blocked/keep.txt\nopen/*\n!open/kept/\n*.tmp\nfile-[[:digit:]]\nfolder/\ndeep/***/secret.txt\n",
        );
        yield* f.write("blocked/.gitignore", "!*\n");
        yield* f.write("blocked/keep.txt");
        yield* f.write("open/kept/.gitignore", "*.secret\n!safe.secret\n");
        for (const name of [
          "open/kept/safe.secret",
          "open/kept/no.secret",
          "open/lost/file.txt",
          "open/kept/file.tmp",
          "file-7",
          "file-a",
          "folder/file.txt",
          "deep/a/b/secret.txt",
        ])
          yield* f.write(name);
        const entries = [
          file("blocked/keep.txt"),
          file("open/kept/safe.secret"),
          file("open/kept/no.secret"),
          file("open/lost/file.txt"),
          file("open/kept/file.tmp"),
          file("file-7"),
          file("file-a"),
          { ...folder("folder"), symlink: true },
          file("folder/file.txt"),
          file("deep/a/b/secret.txt"),
        ];
        const policy = yield* f.policy();
        const oracle = yield* f.expected(
          entries.filter((entry) => entry.path !== "folder").map((entry) => entry.path),
        );
        expect(yield* policy.ignored(entries, "browse")).toEqual(oracle);
        expect(oracle).toEqual(
          new Set([
            "blocked/keep.txt",
            "open/kept/no.secret",
            "open/lost/file.txt",
            "open/kept/file.tmp",
            "file-7",
            "folder/file.txt",
            "deep/a/b/secret.txt",
          ]),
        );
      }),
    ),
  );

  it.effect("loads global/XDG excludes and included gitdir config with local precedence", () =>
    run(
      Effect.gen(function* () {
        const f = yield* fixture();
        yield* f.write("../home/.gitconfig", '[include]\n path = "filters config"\n');
        const canonicalGitDirectory = yield* f.fs.realPath(f.path.join(f.cwd, ".git"));
        yield* f.write(
          "../home/filters config",
          `[includeIf "gitdir:${canonicalGitDirectory}"]\n path = nested\n`,
        );
        yield* f.write(
          "../home/nested",
          String.raw`[core]
 excludesFile = "~/global \
filters"
`,
        );
        yield* f.write("../home/global filters", "*.global\n!local.global\n");
        yield* f.write(".git/info/exclude", "*.info\n");
        yield* f.write(".gitignore", "!visible.info\n!local.global\n");
        const entries = [
          "hidden.global",
          "local.global",
          "hidden.info",
          "visible.info",
          "ordinary.txt",
        ].map(file);
        const policy = yield* f.policy();
        const oracle = yield* f.expected(entries.map((entry) => entry.path));
        expect(oracle).toEqual(new Set(["hidden.global", "hidden.info"]));
        expect(yield* policy.ignored(entries, "browse")).toEqual(oracle);
        expect(yield* policy.ignored(entries, "search")).toEqual(oracle);
        yield* f.write("../home/.gitconfig", "");
        yield* f.write("../home/.config/git/ignore", "*.xdg\n");
        const xdgPolicy = yield* f.policy();
        expect(yield* xdgPolicy.ignored([file("hidden.xdg")], "browse")).toEqual(
          yield* f.expected(["hidden.xdg"]),
        );
        expect(yield* xdgPolicy.ignored([file("hidden.xdg")], "search")).toEqual(
          new Set(["hidden.xdg"]),
        );
        yield* f.write("../home/system-config", "[core]\n excludesFile = ~/system-ignore\n");
        yield* f.write("../home/system-ignore", "*.system\n");
        const overrides = {
          GIT_CONFIG_NOSYSTEM: "no",
          GIT_CONFIG_SYSTEM: f.path.join(f.home, "system-config"),
        };
        const systemPolicy = yield* f.policy(f.fs, f.cwd, overrides);
        expect(yield* systemPolicy.ignored([file("hidden.system")], "browse")).toEqual(
          yield* f.expected(["hidden.system"], f.cwd, overrides),
        );
        expect(yield* systemPolicy.ignored([file("hidden.system")], "search")).toEqual(
          new Set(["hidden.system"]),
        );
      }),
    ),
  );

  it.effect("uses repository-root rules and configured excludes from subfolder workspaces", () =>
    run(
      Effect.gen(function* () {
        const f = yield* fixture();
        yield* f.write(".gitignore", "sub/*.local\n");
        yield* f.git(["config", "core.excludesFile", "exclude-rules"]);
        yield* f.write("exclude-rules", "*.wrong\n");
        yield* f.write("sub/exclude-rules", "*.right\n");
        const cwd = f.path.join(f.cwd, "sub");
        const policy = yield* f.policy(f.fs, cwd);
        const entries = [file("a.local"), file("a.right"), file("a.wrong")];
        expect(yield* policy.ignored(entries, "browse")).toEqual(
          yield* f.expected(
            entries.map((entry) => entry.path),
            cwd,
          ),
        );
        expect(yield* policy.ignored(entries, "search")).toEqual(new Set(["a.local", "a.wrong"]));
      }),
    ),
  );

  it.effect("uses the nearest .ignore ahead of Git rules, including in ordinary folders", () =>
    run(
      Effect.gen(function* () {
        for (const repository of [false, true]) {
          const f = yield* fixture(repository);
          yield* f.write(".gitignore", "*keep*\n*.log\nblocked/\nopened/\n");
          yield* f.write(".ignore", "!*keep*\n*hide*\n!blocked/keep.txt\nfolder-link/\n!opened/\n");
          yield* f.write("sub/.ignore", "!*hide*\n");
          yield* f.write("sub/deep/keep.log");
          yield* f.write("blocked/keep.txt");
          yield* f.write("opened/.gitignore", "*.nested\n");
          yield* f.write("opened/file.txt");
          yield* f.write("opened/file.nested");
          const entries = [
            file("keep.txt"),
            file("hide.txt"),
            file("sub/hide.txt"),
            file("sub/deep/keep.log"),
            file("ordinary.log"),
            file("blocked/keep.txt"),
            file("opened/file.txt"),
            file("opened/file.nested"),
            { ...folder("folder-link"), symlink: true },
          ];
          const policy = yield* f.policy();
          expect(yield* policy.ignored(entries, "search")).toEqual(
            new Set(["hide.txt", "ordinary.log", "blocked/keep.txt", "opened/file.nested"]),
          );
          expect(yield* policy.ignored(entries, "browse")).toEqual(
            repository ? yield* f.expected(entries.map((entry) => entry.path)) : new Set(),
          );
        }
      }),
    ),
  );

  it.effect("changes browse scope at gitlinks, not ordinary nested clones or ignored parents", () =>
    run(
      Effect.gen(function* () {
        const f = yield* fixture();
        yield* f.write("seed.txt");
        const oid = (yield* f.git(["hash-object", "seed.txt"])).trim();
        yield* f.git(["init", "--template=", "sub"]);
        yield* f.git(["update-index", "--add", "--cacheinfo", `160000,${oid},sub`]);
        yield* f.git(["init", "--template=", "ignored/clone"]);
        yield* f.write(".gitignore", "sub/\nignored/\n");
        yield* f.write("sub/.gitignore", "dist/\n");
        yield* f.write("sub/dist/file.txt");
        yield* f.git(["init", "--template=", "sub/dist"]);
        yield* f.write("ignored/clone/.gitignore", "!*\n");
        yield* f.write("ignored/clone/file.txt");
        const policy = yield* f.policy();
        expect(
          yield* policy.ignored(
            [folder("sub"), folder("ignored"), file("ignored/clone/file.txt")],
            "browse",
          ),
        ).toEqual(new Set(["ignored", "ignored/clone/file.txt"]));
        const subEntries = [file("sub/.gitignore"), folder("sub/dist"), file("sub/dist/file.txt")];
        const subOracle = yield* f.expected(
          [".gitignore", "dist", "dist/file.txt"],
          f.path.join(f.cwd, "sub"),
        );
        expect(yield* policy.ignored(subEntries, "browse")).toEqual(
          new Set([...subOracle].map((name) => `sub/${name}`)),
        );
        expect(yield* policy.ignored([file("sub/dist/file.txt")], "search")).toEqual(
          new Set(["sub/dist/file.txt"]),
        );
      }),
    ),
  );

  it.effect("reads worktree common config/info excludes and the per-worktree index/config", () =>
    run(
      Effect.gen(function* () {
        const f = yield* fixture();
        yield* f.write("tracked.tmp");
        yield* f.git(["add", "tracked.tmp"]);
        yield* f.git(["config", "extensions.worktreeConfig", "true"]);
        yield* f.write(".git/info/exclude", "*.tmp\n");
        yield* f.fs.makeDirectory(f.path.join(f.directory, "metadata"));
        yield* f.fs.rename(f.path.join(f.cwd, ".git"), f.path.join(f.directory, "metadata/common"));
        yield* f.write("../metadata/worktree/commondir", "../common\n");
        yield* f.write("../metadata/worktree/HEAD", "ref: refs/heads/main\n");
        yield* f.fs.copyFile(
          f.path.join(f.directory, "metadata/common/index"),
          f.path.join(f.directory, "metadata/worktree/index"),
        );
        yield* f.write(
          "../metadata/worktree/config.worktree",
          '[core]\n excludesFile = "~/worktree-ignore"\n',
        );
        yield* f.write("../home/worktree-ignore", "*.worktree\n");
        yield* f.write(".git", "gitdir: ../metadata/worktree\n");
        const entries = [
          file("tracked.tmp"),
          file("other.tmp"),
          file("hidden.worktree"),
          file("visible.txt"),
        ];
        const policy = yield* f.policy();
        expect(yield* policy.ignored(entries, "browse")).toEqual(
          yield* f.expected(entries.map((entry) => entry.path)),
        );
        expect(yield* policy.ignored(entries, "search")).toEqual(
          new Set(["tracked.tmp", "other.tmp", "hidden.worktree"]),
        );
      }),
    ),
  );

  it.effect("reads SHA256 indexes without consulting refs or content", () =>
    run(
      Effect.gen(function* () {
        const f = yield* fixture(false);
        yield* f.git(["init", "--template=", "--object-format=sha256"]);
        yield* f.write("tracked.txt");
        yield* f.git(["add", "tracked.txt"]);
        yield* f.write(".gitignore", "*.txt\n");
        const policy = yield* f.policy();
        expect(
          yield* policy.ignored([file("tracked.txt"), file("untracked.txt")], "browse"),
        ).toEqual(yield* f.expected(["tracked.txt", "untracked.txt"]));
        expect(yield* policy.ignored([file("tracked.txt")], "search")).toEqual(
          new Set(["tracked.txt"]),
        );
      }),
    ),
  );

  it.effect(
    "fails closed on malformed metadata, unsupported config conditions and split indexes",
    () =>
      run(
        Effect.gen(function* () {
          const f = yield* fixture();
          yield* f.write("tracked.txt");
          yield* f.git(["add", "tracked.txt"]);
          const indexPath = f.path.join(f.cwd, ".git/index");
          const original = yield* f.fs.readFile(indexPath);
          const corruptChecksum = Uint8Array.from(original);
          corruptChecksum[corruptChecksum.length - 1] =
            corruptChecksum[corruptChecksum.length - 1]! ^ 1;
          yield* f.fs.writeFile(indexPath, corruptChecksum);
          expect(yield* f.policy().pipe(Effect.flip)).toMatchObject({
            _tag: "WorkspaceFilePolicyReadError",
            category: "invalid",
          });
          yield* f.fs.writeFile(indexPath, original.subarray(0, original.length - 5));
          expect(yield* f.policy().pipe(Effect.flip)).toMatchObject({
            _tag: "WorkspaceFilePolicyReadError",
            category: "invalid",
          });
          const body = new Uint8Array(original.length - 20 + 8);
          body.set(original.subarray(0, -20));
          body.set(new TextEncoder().encode("link"), original.length - 20);
          const extended = new Uint8Array(body.length + 20);
          extended.set(body);
          extended.set(NodeCrypto.createHash("sha1").update(body).digest(), body.length);
          yield* f.fs.writeFile(indexPath, extended);
          expect(yield* f.policy().pipe(Effect.flip)).toMatchObject({
            _tag: "WorkspaceFilePolicyReadError",
            category: "unsupported",
          });
          yield* f.fs.writeFile(indexPath, original);
          yield* f.write(".git/config", `[user]\n name = ${"x\\\n".repeat(20_000)}x\n`);
          const continued = yield* f.policy();
          expect(yield* continued.ignored([file("visible.txt")], "search")).toEqual(new Set());
          yield* f.write(".git/branch-config", "[user]\n name = Fixture Identity\n");
          yield* f.write(".git/config", '[includeIf "onbranch:main"]\n path = branch-config\n');
          const identityOnly = yield* f.policy();
          expect(yield* identityOnly.ignored([file("visible.txt")], "search")).toEqual(new Set());
          yield* f.write(".git/branch-config", "[core]\n excludesFile = ~/branch-ignore\n");
          expect(yield* f.policy().pipe(Effect.flip)).toMatchObject({
            _tag: "WorkspaceFilePolicyReadError",
            category: "unsupported",
          });
          yield* f.write(".git/config", '[core]\n excludesFile = "unterminated\n');
          expect(yield* f.policy().pipe(Effect.flip)).toMatchObject({
            _tag: "WorkspaceFilePolicyReadError",
            category: "invalid",
          });
          yield* f.write(".git/config", "");
          yield* f.write(".gitignore", "x".repeat(1_048_577));
          const policy = yield* f.policy();
          expect(
            yield* policy.ignored([file("anything.txt")], "search").pipe(Effect.flip),
          ).toMatchObject({ _tag: "WorkspaceFilePolicyReadError", category: "limit" });
        }),
      ),
  );

  it.effect(
    "propagates permission errors and never writes, opens content/refs, or re-reads cached rules",
    () =>
      run(
        Effect.gen(function* () {
          const f = yield* fixture();
          yield* f.write(".gitignore", "*.secret\n");
          yield* f.write("sub/file.txt", "not metadata");
          const opened: string[] = [];
          const fs = FileSystem.FileSystem.of({
            ...f.fs,
            open: Effect.fn("Fixture.open")(
              (name: string, options?: Parameters<typeof f.fs.open>[1]) => {
                expect(options?.flag ?? "r").toBe("r");
                opened.push(f.path.relative(f.directory, name));
                expect(name).not.toMatch(/(?:HEAD|refs|objects|file\.txt)$/);
                return f.fs.open(name, options);
              },
            ),
            writeFile: Effect.fn("Fixture.writeFile")(() => Effect.die("policy wrote a file")),
            writeFileString: Effect.fn("Fixture.writeFileString")(() =>
              Effect.die("policy wrote a file"),
            ),
            makeDirectory: Effect.fn("Fixture.makeDirectory")(() =>
              Effect.die("policy created a directory"),
            ),
          });
          const policy = yield* f.policy(fs);
          const entries = Array.from({ length: 2000 }, (_, index) => file(`sub/${index}.secret`));
          expect((yield* policy.ignored(entries, "search")).size).toBe(2000);
          const reads = opened.length;
          expect((yield* policy.ignored(entries, "search")).size).toBe(2000);
          expect(opened.length).toBe(reads);
          expect(opened.filter((name) => name === "workspace/.gitignore")).toHaveLength(1);
          expect(
            yield* policy.ignored([file(".git/config"), file("sub/.git/HEAD")], "browse"),
          ).toEqual(new Set([".git/config", "sub/.git/HEAD"]));
          const denied = FileSystem.FileSystem.of({
            ...f.fs,
            open: Effect.fn("Fixture.openDenied")(
              (name: string, options?: Parameters<typeof f.fs.open>[1]) =>
                name.endsWith(".gitignore")
                  ? Effect.fail(
                      PlatformError.systemError({
                        _tag: "PermissionDenied",
                        module: "FileSystem",
                        method: "open",
                        pathOrDescriptor: name,
                      }),
                    )
                  : f.fs.open(name, options),
            ),
          });
          const deniedPolicy = yield* f.policy(denied);
          expect(
            yield* deniedPolicy.ignored([file("secret.secret")], "browse").pipe(Effect.flip),
          ).toMatchObject({ _tag: "WorkspaceFilePolicyReadError", category: "io" });
          yield* f.write(".ignore", "*.private\n");
          const deniedIgnore = FileSystem.FileSystem.of({
            ...f.fs,
            open: Effect.fn("Fixture.openIgnoreDenied")(
              (name: string, options?: Parameters<typeof f.fs.open>[1]) =>
                name.endsWith("/.ignore")
                  ? Effect.fail(
                      PlatformError.systemError({
                        _tag: "PermissionDenied",
                        module: "FileSystem",
                        method: "open",
                        pathOrDescriptor: name,
                      }),
                    )
                  : f.fs.open(name, options),
            ),
          });
          const ignorePolicy = yield* f.policy(deniedIgnore);
          expect(yield* ignorePolicy.ignored([file("hidden.private")], "browse")).toEqual(
            new Set(),
          );
          expect(
            yield* ignorePolicy.ignored([file("hidden.private")], "search").pipe(Effect.flip),
          ).toMatchObject({ _tag: "WorkspaceFilePolicyReadError", category: "io" });
        }),
      ),
  );
});
