import fs from "node:fs";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";

export const JSON_LIMIT = 24 * 1024 * 1024;
export const DATA_LIMIT = 16 * 1024 * 1024;
export const FILE_LIMIT = 4 * 1024 * 1024;
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function check(ok: unknown, message: string, status = 400): asserts ok {
  if (!ok) throw new HttpError(status, message);
}
export function allowedFile(p: unknown): p is string {
  if (
    typeof p !== "string" ||
    p.length > 180 ||
    p.split("/").some((s) => !s || s === "." || s === "..") ||
    p.includes("\\")
  )
    return false;
  return /^(?:cv\/Lebenslauf\.tex|cv\/(?:lua|profile|profiles)\/[a-zA-Z0-9_-]+\.lua|cv\/preamble\/[a-zA-Z0-9_-]+\.tex|cv\/assets\/[a-zA-Z0-9_-]+\.(?:jpg|jpeg|png)|anschreiben\/[a-zA-Z0-9_-]+\.tex|anschreiben\/assets\/[a-zA-Z0-9_-]+\.(?:jpg|jpeg|png)|fonts\/SourceSans3-[a-zA-Z0-9_-]+\.ttf|application\.json)$/.test(
    p,
  );
}
export const isText = (p: string) => /\.(tex|lua|json)$/.test(p);
export function safeFile(root: string, p: unknown) {
  check(allowedFile(p), "Dateipfad nicht erlaubt");
  let current = root;
  for (const part of p.split("/")) {
    current = path.join(current, part);
    const stat = fs.lstatSync(current, { throwIfNoEntry: false });
    check(!stat?.isSymbolicLink(), "Symlink nicht erlaubt");
  }
  return current;
}
export function atomicFile(file: string, bytes: string | Buffer) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = file + ".tmp-" + randomUUID();
  fs.writeFileSync(tmp, bytes, { mode: 0o600 });
  fs.renameSync(tmp, file);
}
export function fileMap(root: string): Record<string, Buffer> {
  const result: Record<string, Buffer> = {};
  const walk = (dir: string, prefix = "") => {
    if (!fs.existsSync(dir)) return;
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      check(!item.isSymbolicLink(), "Symlink nicht erlaubt");
      const p = prefix + item.name;
      if (item.isDirectory()) walk(path.join(dir, item.name), p + "/");
      else if (allowedFile(p)) {
        check(
          fs.statSync(path.join(root, p)).size <= FILE_LIMIT,
          "Datei zu groß",
        );
        result[p] = fs.readFileSync(safeFile(root, p));
      }
    }
  };
  walk(root);
  check(
    Object.values(result).reduce((n, b) => n + b.length, 0) <= DATA_LIMIT,
    "Dateien insgesamt zu groß",
  );
  return result;
}
export function checkFileChanges(root: string, files: Record<string, Buffer>) {
  let total = 0;
  for (const [name, bytes] of Object.entries(files)) {
    safeFile(root, name);
    check(bytes.length <= FILE_LIMIT, "Datei zu groß");
    total += bytes.length;
  }
  const walk = (dir: string, prefix = "") => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      check(!entry.isSymbolicLink(), "Symlink nicht erlaubt");
      const name = prefix + entry.name;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), name + "/");
      else if (allowedFile(name) && !Object.hasOwn(files, name)) {
        const size = fs.statSync(safeFile(root, name)).size;
        check(size <= FILE_LIMIT, "Datei zu groß");
        total += size;
      }
    }
  };
  walk(root);
  check(total <= DATA_LIMIT, "Dateien insgesamt zu groß");
}
export function putMap(root: string, files: Record<string, Buffer>) {
  // Validate the entire resulting workspace before replacing even its first file.
  checkFileChanges(root, files);
  for (const [p, bytes] of Object.entries(files))
    atomicFile(safeFile(root, p), bytes);
}
export function writeDocument(root: string, absolute: string, content: string) {
  const name = path.relative(root, absolute);
  check(
    isText(name) && name !== "application.json" && !content.includes("\0"),
    "Nur Textdokumente dürfen geändert werden",
  );
  const file = safeFile(root, name);
  const changes: Record<string, Buffer> = { [name]: Buffer.from(content) };
  const factsPath = safeFile(root, "application.json");
  if (fs.existsSync(factsPath)) {
    const facts = JSON.parse(fs.readFileSync(factsPath, "utf8"));
    check(Number.isSafeInteger(facts.revision), "Ungültige Bewerbungsdaten");
    // Reserve the exact metadata growth for Store.bump() when this Pi turn settles.
    changes["application.json"] = Buffer.from(
      JSON.stringify(
        {
          ...facts,
          revision: facts.revision + 1,
          updated: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
  }
  checkFileChanges(root, changes);
  atomicFile(file, content);
}
export function decodeImport(input: unknown) {
  const v = input as { format?: string; files?: Record<string, string> };
  check(
    v &&
      v.format === "bewerbung-template-v1" &&
      v.files &&
      typeof v.files === "object" &&
      !Array.isArray(v.files),
    "Format bewerbung-template-v1 erwartet",
  );
  const entries = Object.entries(v.files);
  check(entries.length > 0 && entries.length <= 160, "1–160 Dateien erlaubt");
  const result: Record<string, Buffer> = {};
  let total = 0;
  for (const [p, b64] of entries) {
    check(
      allowedFile(p) && p !== "application.json",
      "Importpfad nicht erlaubt: " + p,
    );
    check(
      typeof b64 === "string" &&
        b64.length <= Math.ceil(FILE_LIMIT / 3) * 4 &&
        /^[A-Za-z0-9+/]*={0,2}$/.test(b64),
      "Ungültiges Base64 oder Datei zu groß",
    );
    const bytes = Buffer.from(b64, "base64");
    check(
      bytes.length <= FILE_LIMIT && bytes.toString("base64") === b64,
      "Ungültige Dateigröße/Base64",
    );
    total += bytes.length;
    check(total <= DATA_LIMIT, "Import größer als 16 MiB");
    if (isText(p))
      check(
        !bytes.includes(0) && Buffer.from(bytes.toString("utf8")).equals(bytes),
        "UTF-8 Text erwartet",
      );
    if (p.endsWith(".ttf"))
      check(
        bytes.subarray(0, 4).equals(Buffer.from([0, 1, 0, 0])) ||
          bytes.subarray(0, 4).toString() === "OTTO",
        "Ungültige Font-Datei",
      );
    if (/\.jpe?g$/.test(p))
      check(bytes[0] === 255 && bytes[1] === 216, "Ungültiges JPEG");
    if (p.endsWith(".png"))
      check(
        bytes
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
        "Ungültiges PNG",
      );
    result[p] = bytes;
  }
  check(
    result["cv/Lebenslauf.tex"] && result["cv/lua/loader.lua"],
    "Lebenslauf.tex und lua/loader.lua fehlen",
  );
  return {
    files: result,
    bytes: total,
    digest: createHash("sha256").update(JSON.stringify(v.files)).digest("hex"),
  };
}
export const neutralCover = String.raw`\documentclass[11pt,a4paper]{article}
\usepackage[utf8]{inputenc}
\usepackage[T1]{fontenc}
\usepackage[ngerman]{babel}
\usepackage[margin=25mm]{geometry}
\pagestyle{empty}
\begin{document}
\textbf{Bewerbung – Entwurf}\\[1cm]
% Empfänger, Betreff und Inhalt bewusst neu ausfüllen. Keine alten Firmendaten übernehmen.
Sehr geehrte Damen und Herren,\\[5mm]
[Hier das individuelle Anschreiben verfassen.]\\[1cm]
Mit freundlichen Grüßen
\end{document}
`;
