import fs from "node:fs";
import { createHash } from "node:crypto";
import type { Store } from "./store.ts";
import type { CoverLetter, CoverLetterState } from "../shared/api.ts";
import type { CoverModManifest } from "./cv-mod-prototype/model.ts";
import { decodeCover, encodeCover, validateCover } from "./cover-letter.ts";
import { coverBuildFiles } from "./cover-mod.ts";
import { check, neutralCover, putMap, safeFile } from "./files.ts";
const sourceFile = "anschreiben/Anschreiben.tex";
const hash = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
export type CoverMod = {
  id: string;
  name: string;
  digest: string;
  files: Record<string, Buffer>;
  manifest: CoverModManifest;
};
export class CoverDocuments {
  resolveMod?: (id: string) => CoverMod;
  constructor(private store: Store) {
    store.db.exec(
      "CREATE TABLE IF NOT EXISTS cover_documents(app TEXT PRIMARY KEY REFERENCES apps(id) ON DELETE CASCADE,fields TEXT NOT NULL,source_fingerprint TEXT NOT NULL,mod_id TEXT)",
    );
  }
  private initialFields(app: { company: string; role: string }): CoverLetter {
    return {
      sender: this.store.preferences.settings().applicantName,
      recipient: app.company,
      subject: "Bewerbung als " + app.role,
      salutation: "Sehr geehrte Damen und Herren,",
      body: "",
      closing: "Mit freundlichen Grüßen",
    };
  }
  private load(id: string) {
    const app = this.store.app(id),
      source = this.store.read(id, sourceFile).toString("utf8");
    const row = this.store.db
      .prepare("SELECT * FROM cover_documents WHERE app=?")
      .get(id);
    const decoded = decodeCover(source),
      cached = row ? (JSON.parse(String(row.fields)) as CoverLetter) : null;
    const fields =
      (row && (row.mod_id || row.source_fingerprint === hash(source))
        ? cached
        : decoded || cached) || this.initialFields(app);
    validateCover(fields);
    return {
      app,
      source,
      fields,
      modId: row?.mod_id ? String(row.mod_id) : null,
      fingerprint: hash(JSON.stringify({ source, record: row || null })),
      requiresConversion: !decoded && source !== neutralCover,
    };
  }
  read(id: string): CoverLetterState {
    const s = this.load(id);
    const mod = s.modId ? this.mod(s.modId) : null;
    return {
      revision: s.app.revision,
      fingerprint: s.fingerprint,
      fields: s.fields,
      requiresConversion: !s.modId && s.requiresConversion,
      modId: s.modId,
      ...(mod ? { modName: mod.name } : {}),
    };
  }
  create(id: string, input: { revision: unknown }): CoverLetterState {
    const app = this.store.app(id);
    if (fs.existsSync(safeFile(this.store.workspace(id), sourceFile)))
      return this.read(id);
    check(
      app.status !== "Gesendet",
      "Gesendetes Anschreiben ist schreibgeschützt.",
      409,
    );
    check(
      app.revision === input.revision,
      "Bewerbung inzwischen geändert. Neu laden.",
      409,
    );
    const fields = this.initialFields(app),
      source = encodeCover(fields);
    return this.commit(id, fields, null, source, {
      [sourceFile]: Buffer.from(source),
    });
  }
  private mod(id: string) {
    check(this.resolveMod, "Anschreiben-Vorlagen nicht verfügbar", 503);
    return this.resolveMod(id);
  }
  private checkRevision(
    s: ReturnType<CoverDocuments["load"]>,
    input: { revision: unknown; fingerprint?: unknown },
  ) {
    check(
      s.app.status !== "Gesendet",
      "Gesendetes Anschreiben ist schreibgeschützt.",
      409,
    );
    check(
      s.app.revision === input.revision &&
        (input.fingerprint === undefined ||
          input.fingerprint === s.fingerprint),
      "Anschreiben oder Quellen inzwischen geändert. Neu laden.",
      409,
    );
    check(
      !s.modId || input.fingerprint === s.fingerprint,
      "Anschreiben-Stand neu laden",
      409,
    );
  }
  private commit(
    id: string,
    fields: CoverLetter,
    modId: string | null,
    source: string,
    changes: Record<string, Buffer>,
  ) {
    const workspace = this.store.workspace(id);
    const original = Object.fromEntries(
      [...new Set([...Object.keys(changes), "application.json"])].map(
        (name) => [
          name,
          fs.existsSync(safeFile(workspace, name))
            ? this.store.read(id, name)
            : null,
        ],
      ),
    );
    this.store.db.exec("BEGIN IMMEDIATE");
    try {
      this.store.bump(id, changes);
      this.store.db
        .prepare(
          "INSERT INTO cover_documents VALUES(?,?,?,?) ON CONFLICT(app) DO UPDATE SET fields=excluded.fields,source_fingerprint=excluded.source_fingerprint,mod_id=excluded.mod_id",
        )
        .run(id, JSON.stringify(fields), hash(source), modId);
      this.store.db.exec("COMMIT");
    } catch (error) {
      this.store.db.exec("ROLLBACK");
      for (const [name, bytes] of Object.entries(original)) {
        if (bytes) putMap(workspace, { [name]: bytes });
        else fs.rmSync(safeFile(workspace, name), { force: true });
      }
      this.store.onWorkspaceCommit?.(id);
      throw error;
    }
    return this.read(id);
  }
  save(
    id: string,
    input: {
      revision: unknown;
      fingerprint?: unknown;
      fields: unknown;
      replaceExisting?: unknown;
    },
  ) {
    const s = this.load(id);
    this.checkRevision(s, input);
    validateCover(input.fields);
    check(
      s.modId || !s.requiresConversion || input.replaceExisting === true,
      "Vorhandene TeX-Vorlage zuerst ausdrücklich zum Ersetzen bestätigen.",
      409,
    );
    const source = s.modId ? s.source : encodeCover(input.fields);
    if (s.modId) this.mod(s.modId);
    return this.commit(
      id,
      input.fields,
      s.modId,
      source,
      s.modId ? {} : { [sourceFile]: Buffer.from(source) },
    );
  }
  bind(
    id: string,
    input: { revision: unknown; fingerprint?: unknown; modId: unknown },
  ) {
    const s = this.load(id);
    this.checkRevision(s, input);
    check(
      input.modId === null || typeof input.modId === "string",
      "Ungültige Anschreiben-Vorlage",
    );
    if (input.modId !== null) {
      const mod = this.mod(input.modId);
      return this.commit(id, s.fields, mod.id, s.source, {});
    }
    // Preserve custom TeX on return; canonical text letters retain the latest edited fields.
    const source =
      s.modId && !s.requiresConversion ? encodeCover(s.fields) : s.source;
    return this.commit(
      id,
      s.fields,
      null,
      source,
      source === s.source ? {} : { [sourceFile]: Buffer.from(source) },
    );
  }
  copy(source: string, destination: string) {
    if (
      !this.store.db
        .prepare("SELECT 1 FROM cover_documents WHERE app=?")
        .get(source)
    )
      return;
    const s = this.load(source),
      raw = this.store.read(destination, sourceFile);
    this.store.db
      .prepare("INSERT INTO cover_documents VALUES(?,?,?,?)")
      .run(destination, JSON.stringify(s.fields), hash(raw), s.modId);
  }
  fingerprint(id: string) {
    const s = this.load(id);
    check(s.modId, "Keine Anschreiben-Vorlage gewählt");
    const mod = this.mod(s.modId);
    return hash(
      JSON.stringify({ mod: mod.id, digest: mod.digest, fields: s.fields }),
    );
  }
  plan(id: string) {
    const s = this.load(id);
    if (!s.modId) return null;
    const mod = this.mod(s.modId);
    return {
      mod: true,
      files: {
        ...coverBuildFiles(mod.manifest, mod.files, s.fields),
        "cover-build.json": Buffer.from(
          JSON.stringify({ fingerprint: this.fingerprint(id), modId: mod.id }),
        ),
      },
    };
  }
}
