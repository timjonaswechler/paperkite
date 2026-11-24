import path from "node:path";
import { unzipSync } from "fflate";
import { check } from "../files.ts";

const MAX_PACKED = 8 * 1024 * 1024;
const MAX_EXPANDED = 32 * 1024 * 1024;
const MAX_FILES = 200;
export const shaFileLimit = 4 * 1024 * 1024;
export function safeRelative(name: unknown): asserts name is string {
  check(
    typeof name === "string" &&
      name.length > 0 &&
      name.length <= 200 &&
      !name.includes("\\") &&
      !/[\x00-\x1f\x7f:]/.test(name) &&
      !path.posix.isAbsolute(name) &&
      name
        .split("/")
        .every((part) => part !== "" && part !== "." && part !== ".."),
    "Unsicherer Dateipfad im Vorlagenpaket",
  );
}
export function readTemplateSource(
  name: string,
  bytes: Buffer,
  sourceAssets = false,
) {
  if (/\.zip$/i.test(name)) return readTemplateZip(bytes, sourceAssets);
  check(/\.tex$/i.test(name), "LaTeX-ZIP oder einzelne .tex-Datei erwartet");
  safeRelative(name);
  check(
    !name.includes("/") && bytes.length > 0 && bytes.length <= shaFileLimit,
    "Einzelne TeX-Datei bis 4 MiB erwartet",
  );
  check(
    /\\documentclass\b/.test(bytes.toString("latin1")),
    "TeX-Datei enthält keine LaTeX-Hauptdatei",
  );
  return { files: { [name]: Buffer.from(bytes) }, entrypoints: [name] };
}
export function readTemplateZip(bytes: Buffer, sourceAssets = false) {
  check(
    bytes.length > 0 && bytes.length <= MAX_PACKED,
    "ZIP benötigt 1 Byte bis 8 MiB",
  );
  // Inspect the central directory before allocating decompressed data; refuse ZIP64/encryption/symlinks.
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--)
    if (
      bytes.readUInt32LE(i) === 0x06054b50 &&
      i + 22 + bytes.readUInt16LE(i + 20) === bytes.length
    ) {
      end = i;
      break;
    }
  check(end >= 0, "Ungültige ZIP-Datei");
  const count = bytes.readUInt16LE(end + 10),
    offset = bytes.readUInt32LE(end + 16),
    size = bytes.readUInt32LE(end + 12);
  check(
    bytes.readUInt16LE(end + 4) === 0 &&
      bytes.readUInt16LE(end + 6) === 0 &&
      count === bytes.readUInt16LE(end + 8) &&
      count > 0 &&
      count <= MAX_FILES &&
      offset + size === end,
    "ZIP64/mehrteilige oder zu große ZIP-Datei wird nicht unterstützt",
  );
  let cursor = offset,
    total = 0;
  const names = new Set<string>();
  for (let i = 0; i < count; i++) {
    check(
      cursor + 46 <= end && bytes.readUInt32LE(cursor) === 0x02014b50,
      "Ungültiges ZIP-Verzeichnis",
    );
    const flags = bytes.readUInt16LE(cursor + 8),
      method = bytes.readUInt16LE(cursor + 10),
      length = bytes.readUInt16LE(cursor + 28),
      extra = bytes.readUInt16LE(cursor + 30),
      comment = bytes.readUInt16LE(cursor + 32),
      expanded = bytes.readUInt32LE(cursor + 24),
      localOffset = bytes.readUInt32LE(cursor + 42);
    check(
      cursor + 46 + length + extra + comment <= end &&
        !(flags & 1) &&
        [0, 8].includes(method) &&
        expanded <= MAX_EXPANDED &&
        localOffset < offset,
      "Verschlüsseltes oder ungültiges ZIP-Mitglied",
    );
    const raw = bytes
        .subarray(cursor + 46, cursor + 46 + length)
        .toString("utf8"),
      name = raw.endsWith("/") ? raw.slice(0, -1) : raw;
    safeRelative(name);
    check(!names.has(raw), "Doppelter ZIP-Dateiname");
    names.add(raw);
    const mode = bytes.readUInt32LE(cursor + 38) >>> 16;
    check((mode & 0xf000) !== 0xa000, "Symlinks sind im ZIP nicht erlaubt");
    total += expanded;
    check(total <= MAX_EXPANDED, "ZIP entpackt größer als 32 MiB");
    cursor += 46 + length + extra + comment;
  }
  check(cursor === end, "Ungültige ZIP-Verzeichnisgröße");
  let unpacked: ReturnType<typeof unzipSync>;
  try {
    unpacked = unzipSync(bytes);
  } catch {
    throw new Error("ZIP lässt sich nicht sicher entpacken");
  }
  const files: Record<string, Buffer> = {};
  let actual = 0;
  for (const [raw, data] of Object.entries(unpacked)) {
    if (raw.endsWith("/")) continue;
    safeRelative(raw);
    actual += data.length;
    check(actual <= MAX_EXPANDED, "Entpackte ZIP-Daten zu groß");
    const parts = raw.split("/");
    if (
      parts.some(
        (p) =>
          p === "__MACOSX" ||
          p.startsWith(".") ||
          ["build", "archive", "node_modules", ".git"].includes(p),
      )
    )
      continue;
    if (/\.(?:aux|log|out|synctex\.gz|sh)$/i.test(raw)) continue;
    if (!sourceAssets && /\.(?:pdf|md)$/i.test(raw)) continue;
    check(
      (sourceAssets
        ? /\.(?:tex|lua|sty|cls|cfg|def|bib|bst|png|jpe?g|ttf|otf|pdf|json|md|txt)$/i
        : /\.(?:tex|lua|sty|cls|cfg|def|bib|bst|png|jpe?g|ttf|otf)$/i
      ).test(raw),
      "Nicht unterstützter Quelldateityp: " + raw,
    );
    check(data.length <= shaFileLimit, "Einzeldatei größer als 4 MiB");
    files[raw] = Buffer.from(data);
  }
  check(Object.keys(files).length > 0, "ZIP enthält keine Vorlagenquellen");
  const roots = new Set(Object.keys(files).map((n) => n.split("/")[0]));
  const prefix =
    roots.size === 1 && Object.keys(files).every((n) => n.includes("/"))
      ? [...roots][0] + "/"
      : "";
  const normalized = Object.fromEntries(
    Object.entries(files).map(([n, b]) => [n.slice(prefix.length), b]),
  );
  const entrypoints = Object.entries(normalized)
    .filter(
      ([n, b]) =>
        n.endsWith(".tex") && /\\documentclass\b/.test(b.toString("utf8")),
    )
    .map(([n]) => n);
  check(
    entrypoints.length > 0,
    "ZIP enthält keine LaTeX-Hauptdatei; eine PDF allein genügt nicht",
  );
  return { files: normalized, entrypoints };
}
