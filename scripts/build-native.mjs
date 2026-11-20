import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const pin = JSON.parse(fs.readFileSync("native-t3/source.json", "utf8"));
const root = process.cwd(),
  source = path.resolve(process.env.T3_SOURCE_ROOT || "vendor/t3");
const node = process.env.T3_BUILD_NODE || process.execPath;
if (
  execFileSync(node, ["--version"], { encoding: "utf8" }).trim() !== "v26.13.1"
)
  throw new Error(
    "Isolated Node 26.13.1 required (T3_BUILD_NODE); do not replace service Node 22.",
  );
const config = JSON.parse(fs.readFileSync("native-t3/config.json", "utf8"));
const live = path.join(root, "native-t3/runtime");
const runtime = path.resolve(process.env.T3_BUILD_RUNTIME || config.directory);
const staging = runtime !== live;
if (
  (staging && !runtime.startsWith(path.join(root, ".work") + path.sep)) ||
  fs.lstatSync(runtime, { throwIfNoEntry: false })?.isSymbolicLink()
)
  throw new Error(
    "Build only the app runtime or an owned .work staging directory",
  );
if (!staging) {
  let active = false;
  try {
    active =
      execFileSync("systemctl", ["--user", "is-active", "bewerbung.service"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim() === "active";
  } catch {}
  if (active)
    throw new Error(
      "Stop bewerbung.service and take a fresh backup before installing a runtime build.",
    );
}
const digest = (file) =>
  createHash("sha256").update(fs.readFileSync(file)).digest("hex");
if (
  fs.lstatSync(live).isSymbolicLink() ||
  ![pin.runtimeSha256, pin.originalRuntimeSha256].includes(
    digest(path.join(live, "t3")),
  )
)
  throw new Error("App runtime pin mismatch");
const environment = {
  ...process.env,
  RAYON_NUM_THREADS: process.env.RAYON_NUM_THREADS || "2",
  PATH: [
    path.dirname(node),
    path.join(source, "apps/server/node_modules/.bin"),
    path.join(source, "node_modules/.bin"),
    process.env.PATH,
  ].join(path.delimiter),
  APP_VERSION: pin.version,
  T3CODE_WEB_SOURCEMAP: process.env.T3CODE_WEB_SOURCEMAP || "hidden",
};
execFileSync(path.join(source, "node_modules/.bin/vp"), ["build"], {
  cwd: path.join(source, "apps/web"),
  stdio: "inherit",
  env: environment,
});
execFileSync(node, ["scripts/cli.ts", "build-exe", "--verbose"], {
  cwd: path.join(source, "apps/server"),
  stdio: "inherit",
  env: environment,
});
if (staging && !fs.existsSync(runtime))
  fs.cpSync(live, runtime, { recursive: true, dereference: false });
const client = path.join(runtime, "client");
if (
  fs.lstatSync(client, { throwIfNoEntry: false })?.isSymbolicLink() ||
  fs
    .lstatSync(path.join(runtime, "t3"), { throwIfNoEntry: false })
    ?.isSymbolicLink()
)
  throw new Error("Runtime program and client must not be symlinks");
// Keep older hashed assets available to already-open browser sessions.
fs.mkdirSync(client, { recursive: true });
fs.cpSync(path.join(source, "apps/web/dist"), client, { recursive: true });
fs.copyFileSync(
  path.join(source, "apps/server/dist-exe/t3"),
  path.join(runtime, "t3"),
);
fs.chmodSync(path.join(runtime, "t3"), 0o755);
const sha256 = digest(path.join(runtime, "t3"));
if (staging) {
  fs.writeFileSync(
    path.join(runtime, "build-manifest.json"),
    JSON.stringify({ version: pin.version, sha256 }, null, 2) + "\n",
  );
} else {
  fs.writeFileSync(
    "native-t3/config.json",
    JSON.stringify({ ...config, sha256 }, null, 2) + "\n",
  );
  fs.writeFileSync(
    "native-t3/source.json",
    JSON.stringify({ ...pin, runtimeSha256: sha256 }, null, 2) + "\n",
  );
}
console.log(
  `App-local T3 server with structured job analysis and document-first client built: ${sha256}`,
);
