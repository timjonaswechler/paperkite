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
    "Isolated original toolchain Node 26.13.1 required (T3_BUILD_NODE); do not replace service Node 22.",
  );
const config = JSON.parse(fs.readFileSync("native-t3/config.json", "utf8"));
const runtime = path.resolve(config.directory);
if (
  runtime !== path.join(root, "native-t3/runtime") ||
  fs.lstatSync(runtime).isSymbolicLink()
)
  throw new Error("Only this project's independent runtime may be rebuilt");
if (
  createHash("sha256")
    .update(fs.readFileSync(path.join(runtime, "t3")))
    .digest("hex") !== pin.runtimeSha256
)
  throw new Error("Original runtime pin mismatch");
const vp = path.join(source, "node_modules/.bin/vp");
execFileSync(vp, ["build"], {
  cwd: path.join(source, "apps/web"),
  stdio: "inherit",
  env: {
    ...process.env,
    PATH: [
      path.dirname(node),
      path.join(source, "node_modules/.bin"),
      process.env.PATH,
    ].join(path.delimiter),
    APP_VERSION: pin.version,
    T3CODE_WEB_SOURCEMAP: "hidden",
  },
});
const target = path.join(runtime, "client");
if (fs.lstatSync(target, { throwIfNoEntry: false })?.isSymbolicLink())
  throw new Error("Native client must not be a symlink");
fs.rmSync(target, { recursive: true, force: true });
fs.cpSync(path.join(source, "apps/web/dist"), target, { recursive: true });
console.log("Complete original T3 web client plus business extension built.");
