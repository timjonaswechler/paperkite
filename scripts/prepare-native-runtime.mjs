import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
const pin = JSON.parse(fs.readFileSync("native-t3/source.json", "utf8"));
const source = path.resolve(process.argv[2] || "");
if (!process.argv[2])
  throw new Error("Readonly original runtime directory argument required");
const digest = (file) =>
  createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const originalSha256 = pin.originalRuntimeSha256 || pin.runtimeSha256;
if (digest(path.join(source, "t3")) !== originalSha256)
  throw new Error("Runtime is not the pinned original Linux x64 T3 executable");
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
    "Stop bewerbung.service and back up current data before replacing its runtime.",
  );
const base = path.resolve("native-t3"),
  target = path.join(base, "runtime");
for (const directory of [base, target])
  if (fs.lstatSync(directory, { throwIfNoEntry: false })?.isSymbolicLink())
    throw new Error("Runtime target must not be a symlink");
if (
  source === target ||
  fs.existsSync(path.join(source, "userdata")) ||
  fs.existsSync(path.join(target, "userdata"))
)
  throw new Error("Refusing runtime self-copy or state disposal");
fs.mkdirSync(base, { recursive: true, mode: 0o700 });
const temporary = path.join(base, ".runtime-" + randomUUID());
try {
  fs.cpSync(source, temporary, {
    recursive: true,
    preserveTimestamps: true,
    dereference: false,
  });
  fs.rmSync(target, { recursive: true, force: true });
  fs.renameSync(temporary, target);
  fs.writeFileSync(
    path.join(base, "config.json"),
    JSON.stringify(
      {
        version: pin.version,
        directory: "native-t3/runtime",
        sha256: originalSha256,
      },
      null,
      2,
    ) + "\n",
  );
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
console.log(
  "Original runtime dependencies copied; installed instance unchanged. Build the application backend/client before starting.",
);
