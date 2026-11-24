import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { check } from "../files.ts";
import type { ModFileChange, ModProvenance } from "../../shared/api.ts";

const fileDigest = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
export function sourceChanges(
  original: Record<string, Buffer>,
  mod: Record<string, Buffer>,
): ModProvenance["files"] {
  return [...new Set([...Object.keys(original), ...Object.keys(mod)])]
    .sort()
    .map((name) => {
      const before = original[name],
        after = mod[name];
      const status: ModFileChange["status"] = !before
        ? "added"
        : !after
          ? "removed"
          : before.equals(after)
            ? "unchanged"
            : "changed";
      return {
        path: name,
        status,
        originalSha256: before ? fileDigest(before) : null,
        modSha256: after ? fileDigest(after) : null,
      };
    });
}
export function readChangeNotes(workspace: string): string | null {
  const file = path.join(workspace, "MOD-CHANGES.md");
  if (!fs.existsSync(file)) return null;
  const stat = fs.lstatSync(file);
  check(
    stat.isFile() && !stat.isSymbolicLink() && stat.size <= 16384,
    "Ungültige Mod-Änderungsbeschreibung",
  );
  return fs.readFileSync(file, "utf8").trim() || null;
}
export function fileDifference(name: string, before?: Buffer, after?: Buffer) {
  if (!/\.(tex|lua|sty|cls|cfg|def|json|bib|bst|md|txt)$/i.test(name))
    return { binary: true, diff: "", truncated: false };
  try {
    for (const value of [before, after])
      if (value) new TextDecoder("utf8", { fatal: true }).decode(value);
  } catch {
    return { binary: true, diff: "", truncated: false };
  }
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "paperkite-mod-diff-"));
  const left = path.join(temp, "original"),
    right = path.join(temp, "mod");
  fs.writeFileSync(left, before || Buffer.alloc(0), { mode: 0o600 });
  fs.writeFileSync(right, after || Buffer.alloc(0), { mode: 0o600 });
  try {
    let diff = "",
      truncated = false;
    try {
      diff = execFileSync(
        "git",
        [
          "diff",
          "--no-index",
          "--no-ext-diff",
          "--no-textconv",
          "--no-prefix",
          "--",
          left,
          right,
        ],
        {
          encoding: "utf8",
          maxBuffer: 256 * 1024,
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
    } catch (error) {
      const failure = error as {
        status?: number;
        code?: string;
        stdout?: string;
      };
      check(
        failure.status === 1 || failure.code === "ENOBUFS",
        "Dateivergleich fehlgeschlagen",
        503,
      );
      diff = String(failure.stdout || "");
      truncated = failure.code === "ENOBUFS";
    }
    return {
      binary: false,
      diff: diff.replaceAll(left, "a/" + name).replaceAll(right, "b/" + name),
      truncated,
    };
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}
