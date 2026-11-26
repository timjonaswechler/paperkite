import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as WebCrypto from "effect/crypto/WebCrypto";

import {
  parseIgnoreFile,
  type IgnoreFile,
  type IgnoreDecision,
} from "../../workspace/IgnorePatterns.ts";

export class WorkspaceFilePolicyReadError extends Schema.TaggedError<
  WorkspaceFilePolicyReadError,
  { readonly brand: unique symbol }
>()("WorkspaceFilePolicyReadError", {
  path: Schema.String,
  category: Schema.Literals(["io", "invalid", "unsupported", "limit"]),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return `Workspace file-filter metadata could not be read (${this.category}).`;
  }
}

interface Entry {
  readonly path: string;
  readonly kind: "file" | "directory";
  readonly symlink?: boolean;
}

type Mode = "browse" | "search";
interface Rules {
  readonly directory: string;
  readonly file: IgnoreFile;
}
interface Repository {
  readonly root: string;
  readonly gitDirectory?: string;
  readonly ignoreCase: boolean;
  readonly tracked: ReadonlySet<string>;
  readonly gitlinks: ReadonlySet<string>;
  readonly rules: ReadonlyArray<Rules>;
}
interface Directory {
  readonly repository: Repository;
  readonly gitRules: ReadonlyArray<Rules>;
  readonly ignoreRules: ReadonlyArray<Rules>;
  readonly gitIgnored: boolean;
  readonly searchIgnored: boolean;
  readonly throughSymlink: boolean;
}

const isReadError = Schema.is(WorkspaceFilePolicyReadError);
const textDecoder = new TextDecoder("utf-8", { fatal: true });
const posix = (value: string, separator: string) => value.split(separator).join("/");
const invalid = (
  path: string,
  category: WorkspaceFilePolicyReadError["category"] = "invalid",
): never => {
  throw new WorkspaceFilePolicyReadError({ path, category });
};
const decode = (bytes: Uint8Array, path: string) => {
  try {
    return textDecoder.decode(bytes);
  } catch {
    return invalid(path);
  }
};
const validPath = (value: string) =>
  value.length > 0 &&
  !value.includes("\0") &&
  value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");

function filterRules(contents: string, file: string, ignoreCase: boolean) {
  const lines = contents.split("\n");
  if (lines.length > 8192 || lines.some((line) => line.length > 16_384))
    return invalid(file, "limit");
  return parseIgnoreFile(
    ignoreCase ? contents.toLowerCase().replaceAll("[:upper:]", "[:lower:]") : contents,
  );
}

function parseIndex(
  bytes: Uint8Array,
  file: string,
  algorithm: "sha1" | "sha256",
  digest: Uint8Array,
) {
  const hashSize = algorithm === "sha1" ? 20 : 32;
  const end = bytes.length - hashSize;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (end < 12 || decode(bytes.subarray(0, 4), file) !== "DIRC") return invalid(file);
  if (bytes.subarray(end).every((byte) => byte === 0)) return invalid(file, "unsupported");
  if (!digest.every((byte, index) => byte === bytes[end + index])) return invalid(file);
  const version = view.getUint32(4);
  if (version < 2 || version > 4) return invalid(file, "unsupported");
  const count = view.getUint32(8);
  if (count > 1_000_000) return invalid(file, "limit");
  const tracked = new Set<string>();
  const gitlinks = new Set<string>();
  let offset = 12;
  let previous: Uint8Array = new Uint8Array();
  for (let index = 0; index < count; index += 1) {
    const start = offset;
    if (offset + 42 + hashSize > end) return invalid(file);
    const mode = view.getUint32(offset + 24);
    const flags = view.getUint16(offset + 40 + hashSize);
    offset += 42 + hashSize;
    if (flags & 0x4000) {
      if (version === 2 || offset + 2 > end) return invalid(file);
      const extended = view.getUint16(offset);
      if (extended & ~0x6000) return invalid(file, "unsupported");
      offset += 2;
    }
    let strip = 0;
    if (version === 4) {
      let byte: number;
      let consumed = 0;
      do {
        if (offset >= end || consumed++ > 5) return invalid(file);
        byte = bytes[offset++]!;
        strip = (strip + (consumed > 1 ? 1 : 0)) * 128 + (byte & 127);
      } while (byte & 128);
      if (strip > previous.length) return invalid(file);
    }
    const nul = bytes.indexOf(0, offset);
    if (nul < offset || nul >= end) return invalid(file);
    const suffix = bytes.subarray(offset, nul);
    const nameLength = (version === 4 ? previous.length - strip : 0) + suffix.length;
    if (nameLength > 16_384) return invalid(file, "limit");
    const nameBytes = version === 4 ? new Uint8Array(nameLength) : suffix;
    if (version === 4) {
      nameBytes.set(previous.subarray(0, previous.length - strip));
      nameBytes.set(suffix, previous.length - strip);
    }
    const relative = decode(nameBytes, file);
    if (!validPath(relative) || relative.split("/").includes(".git")) return invalid(file);
    if (nameBytes.length > 16_384 || relative.split("/").length > 256)
      return invalid(file, "limit");
    if ((flags & 0xfff) !== Math.min(nameBytes.length, 0xfff)) return invalid(file);
    if (mode !== 0o100644 && mode !== 0o100755 && mode !== 0o120000 && mode !== 0o160000) {
      return invalid(file, "unsupported");
    }
    tracked.add(relative);
    if (mode === 0o160000) gitlinks.add(relative);
    previous = nameBytes;
    offset = nul + 1;
    if (version !== 4) {
      const next = start + Math.ceil((offset - start) / 8) * 8;
      if (next > end || bytes.subarray(offset, next).some((byte) => byte !== 0))
        return invalid(file);
      offset = next;
    }
  }
  while (offset < end) {
    if (offset + 8 > end) return invalid(file);
    const signature = decode(bytes.subarray(offset, offset + 4), file);
    const length = view.getUint32(offset + 4);
    // Lowercase extensions (split/sparse indexes, for example) change entry interpretation.
    if (!/^[A-Z][A-Za-z0-9 ]{3}$/.test(signature)) return invalid(file, "unsupported");
    offset += 8 + length;
    if (offset > end) return invalid(file);
  }
  return { tracked, gitlinks };
}

interface ConfigItem {
  readonly section: string;
  readonly subsection: string | undefined;
  readonly key: string;
  readonly value: string;
}

function configValue(raw: string, file: string): string {
  let result = "";
  let space = "";
  let quoted = false;
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index]!;
    if (!quoted && (char === "#" || char === ";")) break;
    if (char === '"') {
      result += space;
      space = "";
      quoted = !quoted;
    } else if (char === "\\") {
      const escaped = raw[++index];
      const escapes: Readonly<Record<string, string>> = {
        n: "\n",
        t: "\t",
        b: "\b",
        "\\": "\\",
        '"': '"',
      };
      if (escaped === undefined || !Object.hasOwn(escapes, escaped)) return invalid(file);
      result += space + escapes[escaped];
      space = "";
    } else if (!quoted && (char === " " || char === "\t")) {
      if (result !== "") space += char;
    } else {
      result += space + char;
      space = "";
    }
  }
  if (quoted) return invalid(file);
  return result;
}

function parseConfig(contents: string, file: string): ReadonlyArray<ConfigItem> {
  const items: ConfigItem[] = [];
  let section = "";
  let subsection: string | undefined;
  let pending = "";
  let continuedQuote: boolean = false;
  for (const raw of contents.replace(/^\uFEFF/, "").split("\n")) {
    const fragment = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (pending.length + fragment.length > 65_536) return invalid(file, "limit");
    let quote: boolean = continuedQuote;
    let escaped = false;
    let comment = false;
    for (const char of fragment) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quote = !quote;
      else if (!quote && (char === ";" || char === "#")) {
        comment = true;
        break;
      }
    }
    if (escaped && !comment) {
      pending += fragment.slice(0, -1);
      continuedQuote = quote;
      continue;
    }
    const trimmed = (pending + fragment).trim();
    pending = "";
    continuedQuote = false;
    if (trimmed === "" || trimmed.startsWith("#") || trimmed.startsWith(";")) continue;
    if (trimmed.startsWith("[")) {
      const header =
        /^\[([A-Za-z0-9-]+)(?:\s+"((?:[^"\\]|\\.)*)"|\.([^\]]+))?\]\s*(?:[#;].*)?$/.exec(trimmed);
      if (!header) return invalid(file);
      section = header[1]!.toLowerCase();
      subsection =
        header[2] === undefined ? header[3]?.toLowerCase() : configValue(`"${header[2]}"`, file);
    } else {
      const item = /^([A-Za-z][A-Za-z0-9-]*)(?:\s*=\s*(.*))?$/.exec(trimmed);
      if (!item || section === "") return invalid(file);
      items.push({
        section,
        subsection,
        key: item[1]!.toLowerCase(),
        value: item[2] === undefined ? "true" : configValue(item[2], file),
      });
    }
  }
  if (pending !== "") return invalid(file);
  return items;
}

export const make = Effect.fn("WorkspaceFilePolicy.make")(function* (cwd: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const home = yield* HostProcess.HomeDirectory;
  const environment = yield* HostProcess.Environment;
  const crypto = yield* WebCrypto.WebCrypto;
  const root = path.resolve(cwd);
  for (const key of [
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_COMMON_DIR",
    "GIT_INDEX_FILE",
    "GIT_CONFIG",
    "GIT_CONFIG_PARAMETERS",
    "GIT_CEILING_DIRECTORIES",
  ]) {
    if (environment[key])
      return yield* new WorkspaceFilePolicyReadError({ path: root, category: "unsupported" });
  }
  if (environment.GIT_CONFIG_COUNT && environment.GIT_CONFIG_COUNT !== "0") {
    return yield* new WorkspaceFilePolicyReadError({ path: root, category: "unsupported" });
  }
  const metadata = new Map<string, Uint8Array | undefined>();
  const infos = new Map<string, FileSystem.File.Info | undefined>();
  let bytesRead = 0;
  const checked = <A>(file: string, f: () => A) =>
    Effect.try({
      try: f,
      catch: (cause) =>
        isReadError(cause)
          ? cause
          : new WorkspaceFilePolicyReadError({ path: file, category: "invalid", cause }),
    });
  // These helpers share the construction/classification span; tracing each metadata chunk is costly.
  const info = Effect.fnUntraced(function* (file: string) {
    if (infos.has(file)) return infos.get(file);
    const result = yield* fs.lstat(file).pipe(
      Effect.catchIf(
        (cause) => cause.reason._tag === "NotFound",
        () => Effect.undefined,
      ),
      Effect.mapError(
        (cause) => new WorkspaceFilePolicyReadError({ path: file, category: "io", cause }),
      ),
    );
    infos.set(file, result);
    return result;
  });
  const read = Effect.fnUntraced(function* (file: string, limit = 1_048_576) {
    if (metadata.has(file)) return metadata.get(file);
    if (metadata.size >= 8192)
      return yield* new WorkspaceFilePolicyReadError({ path: file, category: "limit" });
    const result = yield* Effect.scoped(
      Effect.gen(function* () {
        const handle = yield* fs.open(file);
        const chunks: Uint8Array[] = [];
        let length = 0;
        while (true) {
          const chunk = yield* handle.readAlloc(Math.min(65_536, limit + 1 - length));
          if (Option.isNone(chunk)) break;
          length += chunk.value.length;
          if (length > limit || bytesRead + length > 134_217_728) {
            return yield* new WorkspaceFilePolicyReadError({ path: file, category: "limit" });
          }
          chunks.push(chunk.value);
        }
        const bytes = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.length;
        }
        return bytes;
      }),
    ).pipe(
      Effect.catchTags({
        PlatformError: (cause) =>
          cause.reason._tag === "NotFound"
            ? Effect.undefined
            : Effect.fail(new WorkspaceFilePolicyReadError({ path: file, category: "io", cause })),
      }),
    );
    bytesRead += result?.length ?? 0;
    metadata.set(file, result);
    return result;
  });
  const readText = Effect.fnUntraced(function* (file: string) {
    const bytes = yield* read(file);
    return bytes === undefined ? undefined : yield* checked(file, () => decode(bytes, file));
  });
  const expand = (value: string, base: string, file: string) => {
    if (value.length > 16_384) return invalid(file, "limit");
    if (value.includes("\0")) return invalid(file);
    if (value.startsWith("~") && !value.startsWith("~/")) return invalid(file, "unsupported");
    if (value.includes("%(")) return invalid(file, "unsupported");
    return path.resolve(base, value.startsWith("~/") ? path.join(home, value.slice(2)) : value);
  };
  const directoryForMarker = Effect.fnUntraced(function* (directory: string) {
    const marker = path.join(directory, ".git");
    const stat = yield* info(marker);
    if (!stat) return undefined;
    if (stat.type === "Directory") return marker;
    if (stat.type !== "File")
      return yield* new WorkspaceFilePolicyReadError({ path: marker, category: "unsupported" });
    const pointer = yield* readText(marker);
    if (pointer !== undefined && pointer.length > 16_384)
      return yield* new WorkspaceFilePolicyReadError({ path: marker, category: "limit" });
    if (!pointer?.startsWith("gitdir: ") || pointer.trimEnd().includes("\n")) {
      return yield* new WorkspaceFilePolicyReadError({ path: marker, category: "invalid" });
    }
    return path.resolve(directory, pointer.slice(8).trimEnd());
  });
  const repositories = new Map<string, Repository>();
  const loadRepository = Effect.fnUntraced(function* (
    directory: string,
    gitDirectory: string,
  ): Effect.fn.Return<Repository, WorkspaceFilePolicyReadError> {
    const cached = repositories.get(directory);
    if (cached) return cached;
    const canonicalGitDirectory = yield* fs
      .realPath(gitDirectory)
      .pipe(
        Effect.mapError(
          (cause) =>
            new WorkspaceFilePolicyReadError({ path: gitDirectory, category: "io", cause }),
        ),
      );
    const commonText = yield* readText(path.join(gitDirectory, "commondir"));
    if (commonText !== undefined && commonText.length > 16_384)
      return yield* new WorkspaceFilePolicyReadError({ path: gitDirectory, category: "limit" });
    if (
      commonText !== undefined &&
      (commonText.trim() === "" || commonText.trimEnd().includes("\n"))
    ) {
      return yield* new WorkspaceFilePolicyReadError({ path: gitDirectory, category: "invalid" });
    }
    const common =
      commonText === undefined ? gitDirectory : path.resolve(gitDirectory, commonText.trimEnd());
    const relativeRoot = path.relative(directory, root);
    const configCwd =
      relativeRoot !== ".." &&
      !relativeRoot.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativeRoot)
        ? root
        : directory;
    let excludes: string | undefined;
    let ignoreCase = false;
    let bare = false;
    let configuredWorktree: string | undefined;
    let worktreeConfig = false;
    let algorithm: "sha1" | "sha256" = "sha1";
    const boolean = (value: string, file: string) => {
      if (["true", "yes", "on", "1"].includes(value.toLowerCase())) return true;
      if (["false", "no", "off", "0", ""].includes(value.toLowerCase())) return false;
      return invalid(file);
    };
    const affectsFilters = Effect.fnUntraced(function* (
      file: string,
      depth: number,
    ): Effect.fn.Return<boolean, WorkspaceFilePolicyReadError> {
      if (depth > 10)
        return yield* new WorkspaceFilePolicyReadError({ path: file, category: "limit" });
      const contents = yield* readText(file);
      if (contents === undefined) return false;
      const items = yield* checked(file, () => parseConfig(contents, file));
      for (const item of items) {
        if (
          item.subsection === undefined &&
          ((item.section === "core" &&
            ["excludesfile", "ignorecase", "repositoryformatversion", "bare", "worktree"].includes(
              item.key,
            )) ||
            (item.section === "extensions" &&
              ["worktreeconfig", "objectformat"].includes(item.key)))
        )
          return true;
        if ((item.section === "include" || item.section === "includeif") && item.key === "path") {
          const include = yield* checked(file, () => expand(item.value, path.dirname(file), file));
          if (yield* affectsFilters(include, depth + 1)) return true;
        }
      }
      return false;
    });
    const loadConfig = Effect.fnUntraced(function* (
      file: string,
      depth: number,
    ): Effect.fn.Return<void, WorkspaceFilePolicyReadError> {
      if (depth > 10)
        return yield* new WorkspaceFilePolicyReadError({ path: file, category: "limit" });
      const contents = yield* readText(file);
      if (contents === undefined) return;
      const items = yield* checked(file, () => parseConfig(contents, file));
      for (const item of items) {
        if ((item.section === "include" || item.section === "includeif") && item.key === "path") {
          const include = yield* checked(file, () => expand(item.value, path.dirname(file), file));
          let enabled = item.section === "include";
          if (!enabled) {
            const condition = item.subsection;
            if (
              !condition ||
              (!condition.startsWith("gitdir:") && !condition.startsWith("gitdir/i:"))
            ) {
              if (yield* affectsFilters(include, depth + 1))
                return yield* new WorkspaceFilePolicyReadError({
                  path: file,
                  category: "unsupported",
                });
              continue;
            }
            const insensitive = condition.startsWith("gitdir/i:");
            let pattern = condition.slice(insensitive ? 9 : 7);
            if (pattern.startsWith("~/"))
              pattern = posix(path.join(home, pattern.slice(2)), path.sep);
            else if (pattern.startsWith("./"))
              pattern = posix(path.resolve(path.dirname(file), pattern), path.sep);
            else if (!path.isAbsolute(pattern)) pattern = `**/${pattern}`;
            if (pattern.endsWith("/")) pattern += "**";
            if (insensitive) pattern = pattern.toLowerCase();
            if (pattern.includes("\n"))
              return yield* new WorkspaceFilePolicyReadError({
                path: file,
                category: "unsupported",
              });
            if (pattern.length > 16_384)
              return yield* new WorkspaceFilePolicyReadError({ path: file, category: "limit" });
            const matcher = parseIgnoreFile(pattern);
            enabled = [gitDirectory, canonicalGitDirectory].some((directory) => {
              const target = posix(
                insensitive ? directory.toLowerCase() : directory,
                path.sep,
              ).replace(/^\//, "");
              return (
                matcher.decide(target, true) === "ignored" ||
                matcher.decide(`${target}/`, true) === "ignored"
              );
            });
          }
          if (enabled) yield* loadConfig(include, depth + 1);
        } else if (item.section === "core" && item.subsection === undefined) {
          if (item.key === "excludesfile")
            excludes = yield* checked(file, () =>
              item.value === "" ? "" : expand(item.value, directory, file),
            );
          if (item.key === "ignorecase")
            ignoreCase = yield* checked(file, () => boolean(item.value, file));
          if (item.key === "bare") bare = yield* checked(file, () => boolean(item.value, file));
          if (item.key === "worktree")
            configuredWorktree = yield* checked(file, () => expand(item.value, gitDirectory, file));
          if (item.key === "repositoryformatversion" && item.value !== "0" && item.value !== "1") {
            return yield* new WorkspaceFilePolicyReadError({ path: file, category: "unsupported" });
          }
        } else if (item.section === "extensions" && item.subsection === undefined) {
          if (item.key === "worktreeconfig")
            worktreeConfig = yield* checked(file, () => boolean(item.value, file));
          if (item.key === "objectformat") {
            if (item.value !== "sha1" && item.value !== "sha256")
              return yield* new WorkspaceFilePolicyReadError({
                path: file,
                category: "unsupported",
              });
            algorithm = item.value;
          }
        }
      }
    });
    const noSystem =
      environment.GIT_CONFIG_NOSYSTEM === undefined
        ? false
        : yield* checked(directory, () => boolean(environment.GIT_CONFIG_NOSYSTEM!, directory));
    if (!noSystem)
      yield* loadConfig(
        path.resolve(configCwd, environment.GIT_CONFIG_SYSTEM ?? "/etc/gitconfig"),
        0,
      );
    const xdg = environment.XDG_CONFIG_HOME || path.join(home, ".config");
    if (!path.isAbsolute(xdg))
      return yield* new WorkspaceFilePolicyReadError({ path: directory, category: "unsupported" });
    if (environment.GIT_CONFIG_GLOBAL !== undefined) {
      if (environment.GIT_CONFIG_GLOBAL !== "")
        yield* loadConfig(path.resolve(configCwd, environment.GIT_CONFIG_GLOBAL), 0);
    } else {
      yield* loadConfig(path.join(xdg, "git", "config"), 0);
      yield* loadConfig(path.join(home, ".gitconfig"), 0);
    }
    yield* loadConfig(path.join(common, "config"), 0);
    if (worktreeConfig) yield* loadConfig(path.join(gitDirectory, "config.worktree"), 0);
    if (bare)
      return yield* new WorkspaceFilePolicyReadError({
        path: gitDirectory,
        category: "unsupported",
      });
    if (configuredWorktree !== undefined) {
      const directories = yield* Effect.all([
        fs.realPath(configuredWorktree),
        fs.realPath(directory),
      ]).pipe(
        Effect.mapError(
          (cause) =>
            new WorkspaceFilePolicyReadError({ path: gitDirectory, category: "io", cause }),
        ),
      );
      if (directories[0] !== directories[1])
        return yield* new WorkspaceFilePolicyReadError({
          path: gitDirectory,
          category: "unsupported",
        });
    }
    const rules: Rules[] = [];
    for (const file of [
      excludes ?? path.join(xdg, "git", "ignore"),
      path.join(common, "info", "exclude"),
    ]) {
      if (file === "") continue;
      const contents = yield* readText(file);
      if (contents !== undefined)
        rules.push({
          directory,
          file: yield* checked(file, () => filterRules(contents, file, ignoreCase)),
        });
    }
    const indexFile = path.join(gitDirectory, "index");
    const bytes = yield* read(indexFile, 67_108_864);
    let index = { tracked: new Set<string>(), gitlinks: new Set<string>() };
    if (bytes !== undefined) {
      const hashSize = algorithm === "sha1" ? 20 : 32;
      if (bytes.length < 12 + hashSize)
        return yield* new WorkspaceFilePolicyReadError({ path: indexFile, category: "invalid" });
      const digest = yield* Effect.tryPromise({
        try: () =>
          crypto.subtle.digest(
            algorithm === "sha1" ? "SHA-1" : "SHA-256",
            bytes.slice(0, -hashSize),
          ),
        catch: (cause) =>
          new WorkspaceFilePolicyReadError({ path: indexFile, category: "invalid", cause }),
      });
      index = yield* checked(indexFile, () =>
        parseIndex(bytes, indexFile, algorithm, new Uint8Array(digest)),
      );
    }
    const tracked = new Set<string>();
    for (const relative of index.tracked) {
      const segments = (ignoreCase ? relative.toLowerCase() : relative).split("/");
      for (let depth = 1; depth <= segments.length; depth += 1)
        tracked.add(segments.slice(0, depth).join("/"));
      if (tracked.size > 1_000_000)
        return yield* new WorkspaceFilePolicyReadError({ path: indexFile, category: "limit" });
    }
    const repository: Repository = {
      root: directory,
      gitDirectory,
      ignoreCase,
      rules,
      tracked,
      gitlinks: new Set(
        [...index.gitlinks].map((name) => (ignoreCase ? name.toLowerCase() : name)),
      ),
    };
    repositories.set(directory, repository);
    return repository;
  });
  let initial: Repository = {
    root,
    ignoreCase: false,
    tracked: new Set(),
    gitlinks: new Set(),
    rules: [],
  };
  let ancestor = root;
  for (let depth = 0; ; depth += 1) {
    if (depth > 256)
      return yield* new WorkspaceFilePolicyReadError({ path: root, category: "limit" });
    const marker = yield* directoryForMarker(ancestor);
    if (marker !== undefined) {
      initial = yield* loadRepository(ancestor, marker);
      break;
    }
    const parent = path.dirname(ancestor);
    if (parent === ancestor) break;
    ancestor = parent;
  }
  const states = { browse: new Map<string, Directory>(), search: new Map<string, Directory>() };
  const readRules = Effect.fnUntraced(function* (
    directory: string,
    name: string,
    ignoreCase: boolean,
  ) {
    const file = path.join(directory, name);
    const stat = yield* info(file);
    // Git (and the native search walker) does not follow an ignore-file symlink.
    if (!stat || stat.type === "SymbolicLink") return undefined;
    if (stat.type !== "File")
      return yield* new WorkspaceFilePolicyReadError({ path: file, category: "invalid" });
    const contents = yield* readText(file);
    return contents === undefined
      ? undefined
      : { directory, file: yield* checked(file, () => filterRules(contents, file, ignoreCase)) };
  });
  const decide = (
    rules: ReadonlyArray<Rules>,
    absolute: string,
    folder: boolean,
    insensitive: boolean,
  ): IgnoreDecision | undefined => {
    for (let index = rules.length - 1; index >= 0; index -= 1) {
      const rule = rules[index]!;
      const relative = posix(path.relative(rule.directory, absolute), path.sep);
      const decision = rule.file.decide(insensitive ? relative.toLowerCase() : relative, folder);
      if (decision !== undefined) return decision;
    }
    return undefined;
  };
  const directoryState = Effect.fnUntraced(function* (
    directory: string,
    mode: Mode,
    depth = 0,
  ): Effect.fn.Return<Directory, WorkspaceFilePolicyReadError> {
    const cached = states[mode].get(directory);
    if (cached) return cached;
    if (depth > 256 || states[mode].size >= 65_536)
      return yield* new WorkspaceFilePolicyReadError({ path: directory, category: "limit" });
    let repository = initial;
    let gitRules = initial.rules;
    let ignoreRules: ReadonlyArray<Rules> = [];
    let gitIgnored = false;
    let searchIgnored = false;
    let throughSymlink = false;
    if (directory !== initial.root) {
      const parent = yield* directoryState(path.dirname(directory), mode, depth + 1);
      repository = parent.repository;
      gitRules = parent.gitRules;
      ignoreRules = parent.ignoreRules;
      const stat = yield* info(directory);
      throughSymlink = parent.throughSymlink || stat?.type === "SymbolicLink";
      gitIgnored =
        parent.gitIgnored ||
        decide(gitRules, directory, !throughSymlink, repository.ignoreCase) === "ignored";
      const own =
        mode === "search"
          ? decide(ignoreRules, directory, !throughSymlink, repository.ignoreCase)
          : undefined;
      if (own === "included") gitIgnored = false;
      searchIgnored =
        parent.searchIgnored || (own ?? (gitIgnored ? "ignored" : "included")) === "ignored";
      const relative = posix(path.relative(repository.root, directory), path.sep);
      const boundary =
        mode === "browse"
          ? repository.gitlinks.has(repository.ignoreCase ? relative.toLowerCase() : relative)
          : !searchIgnored;
      if (boundary && !throughSymlink) {
        const marker = yield* directoryForMarker(directory);
        if (marker !== undefined) {
          repository = yield* loadRepository(directory, marker);
          gitRules = repository.rules;
          gitIgnored = false;
        } else if (mode === "browse") {
          return yield* new WorkspaceFilePolicyReadError({
            path: directory,
            category: "unsupported",
          });
        }
      }
    }
    if (!throughSymlink) {
      if (!gitIgnored && (mode === "search" || repository.gitDirectory !== undefined)) {
        const rule = yield* readRules(directory, ".gitignore", repository.ignoreCase);
        if (rule) gitRules = [...gitRules, rule];
      }
      if (mode === "search" && !searchIgnored) {
        const rule = yield* readRules(directory, ".ignore", repository.ignoreCase);
        if (rule) ignoreRules = [...ignoreRules, rule];
      }
    }
    const state = { repository, gitRules, ignoreRules, gitIgnored, searchIgnored, throughSymlink };
    states[mode].set(directory, state);
    return state;
  });
  const ignored = Effect.fn("WorkspaceFilePolicy.ignored")(function* (
    entries: ReadonlyArray<Entry>,
    mode: Mode,
  ): Effect.fn.Return<ReadonlySet<string>, WorkspaceFilePolicyReadError> {
    const result = new Set<string>();
    for (const entry of entries) {
      if (
        !validPath(entry.path) ||
        entry.path.length > 16_384 ||
        entry.path.split("/").length > 256
      ) {
        return yield* new WorkspaceFilePolicyReadError({ path: root, category: "invalid" });
      }
      if (entry.path.split("/").includes(".git")) {
        result.add(entry.path);
        continue;
      }
      const absolute = path.join(root, entry.path);
      const state = yield* directoryState(path.dirname(absolute), mode);
      // check-ignore refuses paths beyond a symlink; browse intentionally leaves them unlabelled.
      if (
        mode === "browse" &&
        (state.throughSymlink || state.repository.gitDirectory === undefined)
      )
        continue;
      if (mode === "search" && state.throughSymlink) {
        return yield* new WorkspaceFilePolicyReadError({ path: absolute, category: "unsupported" });
      }
      const folder = entry.kind === "directory" && !entry.symlink;
      const gitIgnored =
        state.gitIgnored ||
        decide(state.gitRules, absolute, folder, state.repository.ignoreCase) === "ignored";
      if (mode === "browse") {
        const relative = posix(path.relative(state.repository.root, absolute), path.sep);
        if (
          gitIgnored &&
          !state.repository.tracked.has(
            state.repository.ignoreCase ? relative.toLowerCase() : relative,
          )
        )
          result.add(entry.path);
      } else {
        const own = decide(state.ignoreRules, absolute, folder, state.repository.ignoreCase);
        if (state.searchIgnored || (own ?? (gitIgnored ? "ignored" : "included")) === "ignored")
          result.add(entry.path);
      }
    }
    return result;
  });
  return { ignored };
});
