// Dependency-free composition must run before the T3 workspace can be installed.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeCrypto from "node:crypto";
import * as NodeChildProcess from "node:child_process";
import * as NodeURL from "node:url";

const root = NodeURL.fileURLToPath(new URL("../", import.meta.url));
const json = (file) => JSON.parse(NodeFS.readFileSync(file, "utf8"));
const git = (cwd, ...args) =>
  NodeChildProcess.execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });

export function safePath(base, relative) {
  if (
    typeof relative !== "string" ||
    relative === "" ||
    relative.includes("\\") ||
    NodePath.posix.isAbsolute(relative) ||
    NodePath.win32.isAbsolute(relative) ||
    relative
      .split("/")
      .some((part) => ["", ".", "..", ".git", "node_modules", ".env"].includes(part)) ||
    relative.split("/").some((part) => part.startsWith(".env."))
  ) {
    throw new Error(`Unsafe composition path: ${relative}`);
  }
  let current = base;
  for (const part of ["", ...relative.split("/")]) {
    current = NodePath.join(current, part);
    if (NodeFS.lstatSync(current, { throwIfNoEntry: false })?.isSymbolicLink()) {
      throw new Error(`Composition cannot traverse symlinks: ${relative}`);
    }
  }
  return current;
}

function filesAt(base, relative) {
  const file = safePath(base, relative);
  if (!NodeFS.statSync(file).isDirectory()) return [relative];
  return NodeFS.readdirSync(file)
    .sort()
    .flatMap((name) => filesAt(base, `${relative}/${name}`));
}

export function planOverlay(project, upstream, composition) {
  const entries = [];
  const targets = new Set();
  for (const item of [...composition.additions, ...composition.overrides]) {
    const replacing = composition.overrides.includes(item);
    if (replacing && (!item.reason || !/^[a-f0-9]{64}$/.test(item.upstreamSha256))) {
      throw new Error(`Override needs a reason and upstream SHA-256: ${item.target}`);
    }
    const source = safePath(project, item.source);
    for (const sourceName of filesAt(project, item.source)) {
      const suffix = NodePath.relative(source, safePath(project, sourceName));
      const targetName = suffix
        ? `${item.target}/${suffix.split(NodePath.sep).join("/")}`
        : item.target;
      const original = safePath(upstream, targetName);
      if (
        [...targets].some(
          (target) =>
            target === targetName ||
            target.startsWith(`${targetName}/`) ||
            targetName.startsWith(`${target}/`),
        )
      ) {
        throw new Error(`Duplicate or overlapping target: ${targetName}`);
      }
      targets.add(targetName);
      if (replacing) {
        if (suffix || !NodeFS.existsSync(original) || !NodeFS.statSync(original).isFile()) {
          throw new Error(`An override must replace exactly one upstream file: ${targetName}`);
        }
        const hash = NodeCrypto.createHash("sha256")
          .update(NodeFS.readFileSync(original))
          .digest("hex");
        if (hash !== item.upstreamSha256) throw new Error(`Upstream override drift: ${targetName}`);
      } else if (NodeFS.existsSync(original)) {
        throw new Error(`Addition would overwrite upstream: ${targetName}`);
      }
      entries.push({ source: safePath(project, sourceName), target: targetName });
    }
  }
  return entries;
}

export function applyOverlay(project, upstream, output, composition, previous = []) {
  const entries = planOverlay(project, upstream, composition);
  // Validate every destination before removing any old product source.
  for (const target of [...previous, ...entries.map((entry) => entry.target)]) {
    safePath(output, target);
  }
  for (const target of previous) {
    const destination = safePath(output, target);
    NodeFS.rmSync(destination, { force: true });
    const original = safePath(upstream, target);
    if (NodeFS.existsSync(original)) NodeFS.copyFileSync(original, destination);
  }
  for (const entry of entries) {
    const destination = safePath(output, entry.target);
    NodeFS.mkdirSync(NodePath.dirname(destination), { recursive: true });
    NodeFS.copyFileSync(entry.source, destination);
  }
  return entries.map((entry) => entry.target);
}

function verify() {
  const pin = json(NodePath.join(root, "integration/t3/upstream.json"));
  const upstream = NodePath.join(root, "vendor/t3");
  if (git(upstream, "rev-parse", "HEAD").trim() !== pin.commit) {
    throw new Error("T3 checkout does not match integration/t3/upstream.json.");
  }
  if (git(upstream, "remote", "get-url", "origin").trim() !== pin.repository) {
    throw new Error("T3 origin does not match the approved upstream repository.");
  }
  if (git(upstream, "status", "--porcelain", "--untracked-files=all").trim()) {
    throw new Error("T3 source is modified. Put changes in owned sources or explicit overrides.");
  }
  const gitlink = git(root, "ls-files", "--stage", "--", "vendor/t3").trim().split(/\s+/);
  if (gitlink[0] !== "160000" || gitlink[1] !== pin.commit) {
    throw new Error("Stage the matching vendor/t3 gitlink together with the upstream pin.");
  }
  const product = json(NodePath.join(root, "package.json"));
  const base = json(NodePath.join(upstream, "package.json"));
  if (
    product.engines.node !== base.engines.node ||
    product.packageManager !== base.packageManager
  ) {
    throw new Error("Paperkite toolchain must match the pinned T3 toolchain.");
  }
  return { pin, upstream };
}

function compose(allowMissingLock = false) {
  const { pin, upstream } = verify();
  const output = safePath(root, ".build/t3");
  const marker = NodePath.join(output, ".paperkite-composition.json");
  const previous = NodeFS.existsSync(marker) ? json(marker) : null;
  if (NodeFS.existsSync(output) && !previous) {
    throw new Error("Refusing to replace an unmanaged .build/t3 directory.");
  }
  const composition = json(NodePath.join(root, "integration/t3/composition.json"));
  planOverlay(root, upstream, composition);
  if (!previous || previous.commit !== pin.commit) {
    NodeFS.rmSync(output, { recursive: true, force: true });
    NodeFS.mkdirSync(output, { recursive: true });
    // Copy tracked entries without following upstream reference symlinks or nested gitlinks.
    try {
      for (const entry of git(upstream, "ls-files", "--stage", "-z").split("\0").filter(Boolean)) {
        const [metadata, file] = entry.split("\t");
        const mode = metadata.split(" ")[0];
        const destination = NodePath.join(output, file);
        NodeFS.mkdirSync(NodePath.dirname(destination), { recursive: true });
        if (mode === "160000") NodeFS.mkdirSync(destination, { recursive: true });
        else if (mode === "120000")
          NodeFS.symlinkSync(NodeFS.readlinkSync(NodePath.join(upstream, file)), destination);
        else {
          NodeFS.copyFileSync(NodePath.join(upstream, file), destination);
          NodeFS.chmodSync(destination, Number.parseInt(mode, 8) & 0o777);
        }
      }
    } catch (error) {
      NodeFS.rmSync(output, { recursive: true, force: true });
      throw error;
    }
  }
  const targets = applyOverlay(
    root,
    upstream,
    output,
    composition,
    previous?.commit === pin.commit ? previous.targets : [],
  );
  if (composition.productLock) {
    const productLock = safePath(root, composition.productLock);
    if (NodeFS.existsSync(productLock)) {
      NodeFS.copyFileSync(productLock, NodePath.join(output, "pnpm-lock.yaml"));
    } else if (!allowMissingLock) {
      throw new Error("Product lock is missing. Run pnpm lock explicitly before installing.");
    }
  }
  NodeFS.writeFileSync(marker, `${JSON.stringify({ commit: pin.commit, targets }, null, 2)}\n`);
  return output;
}

export function isolatedEnvironment(environment) {
  return Object.fromEntries(
    Object.entries(environment).filter(
      ([key]) => !key.startsWith("T3CODE_") && !key.startsWith("T3_") && !key.startsWith("VITE_"),
    ),
  );
}

function run(cwd, args, env = {}, isolated = false) {
  NodeChildProcess.execFileSync("pnpm", args, {
    cwd,
    stdio: "inherit",
    env: {
      ...(isolated ? isolatedEnvironment(process.env) : process.env),
      VP_REMOTE_CACHE: "off",
      VP_REMOTE_CACHE_URL: "",
      ...env,
    },
  });
}

function main(action) {
  if (action === "verify") {
    verify();
    console.log("Pinned T3 checkout and toolchain verified.");
    return;
  }
  const output = compose(action === "lock");
  if (action === "compose") {
    console.log(`Composed workspace: ${output}`);
    return;
  }
  const required = json(NodePath.join(root, "package.json")).engines.node;
  if (process.version !== `v${required}`) throw new Error(`Use isolated Node ${required}.`);
  if (action === "lock") {
    run(output, ["install", "--lockfile-only", "--ignore-scripts", "--prefer-offline"]);
    const composition = json(NodePath.join(root, "integration/t3/composition.json"));
    NodeFS.copyFileSync(
      NodePath.join(output, "pnpm-lock.yaml"),
      safePath(root, composition.productLock),
    );
  } else if (action === "setup") {
    run(output, [
      "install",
      "--frozen-lockfile",
      "--filter",
      "@t3tools/web...",
      "--filter",
      "t3...",
      "--filter",
      "@t3tools/scripts...",
      "--filter",
      "@t3tools/oxlint-plugin-t3code...",
    ]);
  } else if (action === "check") {
    const paths = json(NodePath.join(output, ".paperkite-composition.json")).targets;
    run(output, ["exec", "vp", "fmt", "--check", ...paths]);
    run(output, ["exec", "vp", "lint", "--report-unused-disable-directives", ...paths]);
    run(output, [
      "exec",
      "vp",
      "run",
      "--filter",
      "@t3tools/web",
      "--filter",
      "t3",
      "--filter",
      "@paperkite/*",
      "typecheck",
    ]);
  } else if (action === "build") {
    run(output, ["exec", "vp", "run", "--filter", "@t3tools/web", "--filter", "t3", "build"]);
  } else if (action === "proof") {
    run(
      output,
      ["exec", "node", "apps/server/src/paperkite/prove.ts"],
      { PAPERKITE_ROOT: root },
      true,
    );
  } else if (action === "dev" || action === "start") {
    run(
      output,
      [
        "exec",
        "node",
        "apps/server/src/paperkite/main.ts",
        "--root",
        root,
        "--home",
        NodePath.join(root, ".local/t3"),
        "--static-dir",
        NodePath.join(output, "apps/web/dist"),
        ...process.argv.slice(3),
      ],
      {
        T3CODE_DEV_SEED: "0",
        T3CODE_HOME: NodePath.join(root, ".local/t3"),
        T3CODE_CLI_PATH: NodePath.join(root, "tooling/paperkite"),
        PAPERKITE_ROOT: root,
        PAPERKITE_NODE: process.execPath,
      },
      true,
    );
  } else {
    throw new Error("Use verify, compose, lock, setup, check, build, proof, start or dev.");
  }
}

if (
  process.argv[1] &&
  NodePath.resolve(process.argv[1]) === NodeURL.fileURLToPath(import.meta.url)
) {
  try {
    main(process.argv[2]);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
