import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { LibraryDocument } from "../shared/api.ts";
import { atomicFile, check } from "./files.ts";

export const DOCUMENT_LIMIT = 25 * 1024 * 1024;
export const LIBRARY_LIMIT = 1024 * 1024 * 1024;
export const APPLICATION_DOCUMENT_LIMIT = 100 * 1024 * 1024;

export function normalizeTags(value: unknown): string[] {
  check(Array.isArray(value) && value.length <= 20, "Höchstens 20 Tags erlaubt");
  const tags = value.map((tag) => {
    check(typeof tag === "string" && !/[\x00-\x1f\x7f]/.test(tag), "Ungültiger Tag");
    const normalized = tag.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase("de-DE");
    check(normalized.length > 0 && normalized.length <= 40 && !/[\x00-\x1f\x7f]/.test(normalized), "Tags benötigen 1 bis 40 Zeichen ohne Steuerzeichen");
    return normalized;
  });
  return [...new Set(tags)].sort((a, b) => a.localeCompare(b, "de"));
}

type SnapshotDocument = {
  document: string;
  name: string;
  label: string;
  position: number;
};
function mimeOf(bytes: Buffer): LibraryDocument["mime"] | undefined {
  if (bytes.subarray(0, 5).toString() === "%PDF-") return "application/pdf";
  if (
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    return "image/jpeg";
}
function nameOf(value: unknown) {
  check(
    typeof value === "string" &&
      value.length > 0 &&
      value.length <= 200 &&
      !/[\x00-\x1f\x7f/\\]/.test(value) &&
      value !== "." &&
      value !== "..",
    "Ungültiger Dateiname",
  );
  return value.normalize("NFC");
}
function zipName(position: number, name: string) {
  return `Anlagen/${String(position + 1).padStart(2, "0")}_${name.replace(/[\x00-\x1f\x7f/\\]/g, "_").replace(/^\.+/, "_")}`;
}

export class DocumentLibrary {
  private directory: string;
  constructor(
    private db: DatabaseSync,
    root: string,
  ) {
    this.directory = path.join(root, "documents");
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    check(
      !fs.lstatSync(this.directory).isSymbolicLink(),
      "Dokumentenordner ist ein Symlink",
    );
    db.exec(`
      CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY,name TEXT NOT NULL,label TEXT NOT NULL,mime TEXT NOT NULL,bytes INTEGER NOT NULL,sha256 TEXT NOT NULL UNIQUE,created TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS document_tags(document TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,tag TEXT NOT NULL,PRIMARY KEY(document,tag));
      CREATE TABLE IF NOT EXISTS application_documents(app TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,document TEXT NOT NULL REFERENCES documents(id) ON DELETE RESTRICT,position INTEGER NOT NULL,PRIMARY KEY(app,document));
      CREATE TABLE IF NOT EXISTS build_documents(build TEXT NOT NULL REFERENCES builds(id) ON DELETE CASCADE,document TEXT NOT NULL REFERENCES documents(id) ON DELETE RESTRICT,name TEXT NOT NULL,label TEXT NOT NULL,position INTEGER NOT NULL,PRIMARY KEY(build,document));
    `);
  }
  private metadata(row: Record<string, unknown>): LibraryDocument {
    return {
      id: String(row.id),
      name: String(row.name),
      label: String(row.label),
      mime: row.mime as LibraryDocument["mime"],
      bytes: Number(row.bytes),
      sha256: String(row.sha256),
      created: String(row.created),
      tags: this.db.prepare("SELECT tag FROM document_tags WHERE document=? ORDER BY tag").all(String(row.id)).map((tag) => String(tag.tag)),
      usedBy: Number(
        this.db
          .prepare(
            "SELECT COUNT(*) AS count FROM application_documents WHERE document=?",
          )
          .get(String(row.id))!.count,
      ),
    };
  }
  private blob(sha: string) {
    check(/^[a-f0-9]{64}$/.test(sha), "Ungültiger Dokumenthash", 500);
    const file = path.join(this.directory, sha + ".bin");
    check(
      !fs.lstatSync(file, { throwIfNoEntry: false })?.isSymbolicLink(),
      "Dokumentdatei ist ein Symlink",
    );
    return file;
  }
  list(tag?: unknown): LibraryDocument[] {
    if (tag !== undefined && tag !== "") {
      const normalized = normalizeTags([tag])[0];
      return this.db.prepare("SELECT d.* FROM documents d JOIN document_tags t ON t.document=d.id WHERE t.tag=? ORDER BY d.created DESC,d.id").all(normalized).map((row) => this.metadata(row));
    }
    return this.db.prepare("SELECT * FROM documents ORDER BY created DESC,id").all().map((row) => this.metadata(row));
  }
  get(id: unknown): LibraryDocument {
    check(
      typeof id === "string" && /^[a-f0-9-]{36}$/.test(id),
      "Dokument nicht gefunden",
      404,
    );
    const row = this.db.prepare("SELECT * FROM documents WHERE id=?").get(id);
    check(row, "Dokument nicht gefunden", 404);
    return this.metadata(row);
  }
  upload(name: unknown, input: unknown) {
    name = nameOf(name);
    check(
      Buffer.isBuffer(input) &&
        input.length > 0 &&
        input.length <= DOCUMENT_LIMIT,
      "Datei muss zwischen 1 Byte und 25 MiB groß sein",
      413,
    );
    const mime = mimeOf(input);
    check(
      mime &&
        (mime === "application/pdf"
          ? /\.pdf$/i
          : mime === "image/png"
            ? /\.png$/i
            : /\.jpe?g$/i
        ).test(String(name)),
      "Nur PDF, JPG und PNG mit passender Dateiendung erlaubt",
    );
    const sha = createHash("sha256").update(input).digest("hex");
    const existing = this.db
      .prepare("SELECT * FROM documents WHERE sha256=?")
      .get(sha);
    if (existing) return { ...this.metadata(existing), duplicate: true };
    const used = Number(
      this.db
        .prepare("SELECT COALESCE(SUM(bytes),0) AS bytes FROM documents")
        .get()!.bytes,
    );
    check(
      used + input.length <= LIBRARY_LIMIT,
      "Zentrale Ablage ist größer als 1 GiB",
      413,
    );
    const id = randomUUID(),
      created = new Date().toISOString(),
      file = this.blob(sha);
    atomicFile(file, input);
    try {
      this.db
        .prepare("INSERT INTO documents VALUES(?,?,?,?,?,?,?)")
        .run(id, String(name), String(name), mime, input.length, sha, created);
    } catch (error) {
      fs.unlinkSync(file);
      throw error;
    }
    return this.get(id);
  }
  rename(id: string, value: unknown) {
    return this.update(id, { label: value });
  }
  update(id: string, input: Record<string, unknown>) {
    this.get(id);
    check(Object.keys(input).length > 0 && Object.keys(input).every((key) => key === "label" || key === "tags"), "Bezeichnung oder Tags erwartet");
    if (input.label !== undefined)
      check(typeof input.label === "string" && input.label.trim().length > 0 && input.label.trim().length <= 200 && !/[\x00-\x1f\x7f]/.test(input.label), "Ungültige Dokumentbezeichnung");
    const tags = input.tags === undefined ? undefined : normalizeTags(input.tags);
    this.db.exec("BEGIN");
    try {
      if (input.label !== undefined) this.db.prepare("UPDATE documents SET label=? WHERE id=?").run((input.label as string).trim(), id);
      if (tags) {
        this.db.prepare("DELETE FROM document_tags WHERE document=?").run(id);
        const insert = this.db.prepare("INSERT INTO document_tags VALUES(?,?)");
        tags.forEach((tag) => insert.run(id, tag));
      }
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    return this.get(id);
  }
  remove(id: string) {
    const document = this.get(id);
    const builds = Number(
      this.db
        .prepare(
          "SELECT COUNT(*) AS count FROM build_documents WHERE document=?",
        )
        .get(id)!.count,
    );
    check(
      !document.usedBy && !builds,
      "Dokument wird noch in einer Bewerbung oder einem gespeicherten Build verwendet",
      409,
    );
    const file = this.blob(document.sha256);
    this.db.prepare("DELETE FROM documents WHERE id=?").run(id);
    if (fs.existsSync(file)) fs.unlinkSync(file);
    return { ok: true };
  }
  bytes(id: string) {
    const document = this.get(id),
      file = this.blob(document.sha256);
    check(
      fs.existsSync(file) && fs.lstatSync(file).isFile(),
      "Dokumentdatei fehlt",
      404,
    );
    check(
      fs.statSync(file).size === document.bytes,
      "Dokumentdatei beschädigt",
      409,
    );
    const bytes = fs.readFileSync(file);
    check(
      createHash("sha256").update(bytes).digest("hex") === document.sha256,
      "Dokumentdatei beschädigt",
      409,
    );
    return bytes;
  }
  validateSelection(value: unknown): string[] {
    check(
      Array.isArray(value) &&
        value.length <= 40 &&
        new Set(value).size === value.length,
      "Höchstens 40 unterschiedliche Dokumente auswählen",
    );
    const documents = value.map((id) => this.get(id));
    check(
      documents.reduce((n, document) => n + document.bytes, 0) <=
        APPLICATION_DOCUMENT_LIMIT,
      "Anlagen zusammen größer als 100 MiB",
    );
    return documents.map((document) => document.id);
  }
  ids(app: string): string[] {
    return this.db
      .prepare(
        "SELECT document FROM application_documents WHERE app=? ORDER BY position",
      )
      .all(app)
      .map((row) => String(row.document));
  }
  selected(app: string) {
    return this.ids(app).map((id) => this.get(id));
  }
  assign(app: string, ids: string[]) {
    ids = this.validateSelection(ids);
    this.db.prepare("DELETE FROM application_documents WHERE app=?").run(app);
    const insert = this.db.prepare(
      "INSERT INTO application_documents VALUES(?,?,?)",
    );
    ids.forEach((id, position) => insert.run(app, id, position));
  }
  snapshot(build: string, app: string) {
    const insert = this.db.prepare(
      "INSERT INTO build_documents VALUES(?,?,?,?,?)",
    );
    this.selected(app).forEach((document, position) =>
      insert.run(build, document.id, document.name, document.label, position),
    );
  }
  files(app: string): Record<string, Buffer> {
    return Object.fromEntries(
      this.selected(app).map((document, position) => [
        zipName(position, document.name),
        this.bytes(document.id),
      ]),
    );
  }
  dropSnapshot(build: string) {
    this.db.prepare("DELETE FROM build_documents WHERE build=?").run(build);
  }
  snapshotFiles(build: string): Record<string, Buffer> {
    const rows = this.db
      .prepare(
        "SELECT document,name,label,position FROM build_documents WHERE build=? ORDER BY position",
      )
      .all(build) as SnapshotDocument[];
    return Object.fromEntries(
      rows.map((row) => [
        zipName(row.position, row.name),
        this.bytes(row.document),
      ]),
    );
  }
}
