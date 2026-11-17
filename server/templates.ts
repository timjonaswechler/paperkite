import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { TemplateSummary } from "../shared/api.ts";
import { check, decodeImport, fileMap, putMap } from "./files.ts";

function labelOf(value: unknown) {
  check(
    typeof value === "string" &&
      value.trim().length > 0 &&
      value.trim().length <= 120 &&
      !/[\x00-\x1f\x7f]/.test(value),
    "Vorlagenname benötigt 1 bis 120 Zeichen",
  );
  return value.normalize("NFC").trim();
}
export class Templates {
  constructor(
    private db: DatabaseSync,
    private root: string,
  ) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS template_metadata(id TEXT PRIMARY KEY REFERENCES templates(id) ON DELETE CASCADE,label TEXT NOT NULL,profile TEXT);
      CREATE TABLE IF NOT EXISTS template_default(singleton INTEGER PRIMARY KEY CHECK(singleton=1),id TEXT REFERENCES templates(id) ON DELETE SET NULL);
      CREATE TABLE IF NOT EXISTS template_deletions(id TEXT PRIMARY KEY);
    `);
    if (
      !db.prepare("SELECT id FROM template_default WHERE singleton=1").get()
    ) {
      const latest = db
        .prepare(
          "SELECT id FROM templates ORDER BY created DESC,rowid DESC LIMIT 1",
        )
        .get();
      if (latest)
        db.prepare("INSERT INTO template_default VALUES(1,?)").run(latest.id);
    }
    this.cleanup();
  }
  private cleanup() {
    for (const row of this.db
      .prepare("SELECT id FROM template_deletions")
      .all()) {
      const id = String(row.id);
      try {
        check(
          /^[a-f0-9-]{36}$/.test(id) &&
            !this.db.prepare("SELECT id FROM templates WHERE id=?").get(id),
          "Ungültiger Vorlagen-Löschauftrag",
        );
        check(
          !fs
            .lstatSync(path.join(this.root, "templates"), {
              throwIfNoEntry: false,
            })
            ?.isSymbolicLink(),
          "Vorlagenordner ist ein Symlink",
        );
        fs.rmSync(this.directory(id), { recursive: true, force: true });
        this.db.prepare("DELETE FROM template_deletions WHERE id=?").run(id);
      } catch (error) {
        console.warn("Vorlagenbereinigung ausstehend:", id, String(error));
      }
    }
  }
  private directory(id: string) {
    return path.join(this.root, "templates", id);
  }
  private defaultId() {
    return (
      this.db.prepare("SELECT id FROM template_default WHERE singleton=1").get()
        ?.id ||
      this.db
        .prepare(
          "SELECT id FROM templates ORDER BY created DESC,rowid DESC LIMIT 1",
        )
        .get()?.id
    );
  }
  list(): TemplateSummary[] {
    const selected = this.defaultId();
    return this.db
      .prepare(
        "SELECT t.*,m.label,m.profile FROM templates t LEFT JOIN template_metadata m ON m.id=t.id ORDER BY t.created DESC,t.rowid DESC",
      )
      .all()
      .map((row) => {
        const directory = path.join(
          this.directory(String(row.id)),
          "cv",
          "profiles",
        );
        const profiles = fs.existsSync(directory)
          ? fs
              .readdirSync(directory)
              .filter((name) => /^[A-Za-z0-9_-]+\.lua$/.test(name))
              .map((name) => name.slice(0, -4))
              .sort()
          : [];
        const profile =
          typeof row.profile === "string" && profiles.includes(row.profile)
            ? row.profile
            : profiles.includes("general")
              ? "general"
              : profiles[0];
        return {
          id: String(row.id),
          created: String(row.created),
          digest: String(row.digest),
          bytes: Number(row.bytes),
          profiles,
          label: String(row.label || "Master"),
          isDefault: row.id === selected,
          ...(profile ? { defaultProfile: profile } : {}),
        };
      });
  }
  get(id: unknown): TemplateSummary {
    check(
      typeof id === "string" && /^[a-f0-9-]{36}$/.test(id),
      "Vorlage nicht gefunden",
      404,
    );
    const template = this.list().find((entry) => entry.id === id);
    check(template, "Vorlage nicht gefunden", 404);
    return template;
  }
  files(id: string) {
    this.get(id);
    return fileMap(this.directory(id));
  }
  import(input: unknown) {
    const decoded = decodeImport(input),
      id = randomUUID(),
      created = new Date().toISOString();
    putMap(this.directory(id), decoded.files);
    try {
      this.db
        .prepare("INSERT INTO templates VALUES(?,?,?,?)")
        .run(id, created, decoded.digest, decoded.bytes);
    } catch (error) {
      fs.rmSync(this.directory(id), { recursive: true, force: true });
      throw error;
    }
    if (
      !this.db
        .prepare("SELECT id FROM template_default WHERE singleton=1")
        .get()?.id
    )
      this.db
        .prepare(
          "INSERT INTO template_default VALUES(1,?) ON CONFLICT(singleton) DO UPDATE SET id=excluded.id",
        )
        .run(id);
    return {
      id,
      count: Object.keys(decoded.files).length,
      bytes: decoded.bytes,
      profiles: Object.keys(decoded.files).filter((name) =>
        name.startsWith("cv/profiles/"),
      ),
      warning:
        "Alte Anschreiben sind nur Referenzen. Originalquellen bleiben unverändert.",
    };
  }
  rename(id: string, value: unknown) {
    this.get(id);
    const label = labelOf(value);
    this.db
      .prepare(
        "INSERT INTO template_metadata(id,label) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET label=excluded.label",
      )
      .run(id, label);
    return this.get(id);
  }
  setDefault(id: string) {
    this.get(id);
    this.db
      .prepare(
        "INSERT INTO template_default VALUES(1,?) ON CONFLICT(singleton) DO UPDATE SET id=excluded.id",
      )
      .run(id);
    return this.list();
  }
  fromFiles(files: Record<string, Buffer>, label: unknown, profile?: string) {
    const name = labelOf(label);
    const source = Object.fromEntries(
      Object.entries(files)
        .filter(([key]) => key !== "application.json")
        .map(([key, bytes]) => [key, bytes.toString("base64")]),
    );
    const imported = this.import({
      format: "bewerbung-template-v1",
      files: source,
    });
    this.db
      .prepare("INSERT INTO template_metadata VALUES(?,?,?)")
      .run(imported.id, name, profile || null);
    return this.get(imported.id);
  }
  copy(id: string, label?: unknown) {
    const original = this.get(id);
    return this.fromFiles(
      this.files(id),
      label === undefined ? original.label.slice(0, 110) + " (Kopie)" : label,
      original.defaultProfile,
    );
  }
  remove(id: string, digest: unknown) {
    const original = this.get(id);
    check(
      digest === original.digest,
      "Vorlagenstand inzwischen geändert. Neu laden.",
      409,
    );
    this.db.exec("BEGIN");
    try {
      this.db.prepare("INSERT INTO template_deletions VALUES(?)").run(id);
      this.db.prepare("DELETE FROM templates WHERE id=?").run(id);
      if (
        !this.db
          .prepare("SELECT id FROM template_default WHERE singleton=1")
          .get()?.id
      ) {
        const next = this.db
          .prepare(
            "SELECT id FROM templates ORDER BY created DESC,rowid DESC LIMIT 1",
          )
          .get();
        if (next)
          this.db
            .prepare(
              "INSERT INTO template_default VALUES(1,?) ON CONFLICT(singleton) DO UPDATE SET id=excluded.id",
            )
            .run(next.id);
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    this.cleanup();
    return { ok: true };
  }
  export(id: string) {
    return {
      format: "bewerbung-template-v1",
      files: Object.fromEntries(
        Object.entries(this.files(id)).map(([name, bytes]) => [
          name,
          bytes.toString("base64"),
        ]),
      ),
    };
  }
}
