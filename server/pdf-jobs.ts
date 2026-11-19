import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type {
  PdfCompression,
  PdfInput,
  PdfJob,
  PdfPlan,
} from "../shared/api.ts";
import { Store } from "./store.ts";
import { Builds } from "./builds.ts";
import { APPLICATION_DOCUMENT_LIMIT, normalizeTags } from "./documents.ts";
import { atomicFile, check } from "./files.ts";
import type { PdfRunner } from "./pdf-runner.ts";

const OUTPUT_LIMIT = 180 * 1024 * 1024;
const uuid = /^[a-f0-9-]{36}$/;
function compressionOf(value: unknown): PdfCompression {
  check(value === "none" || value === "lossless" || value === "compact", "Ungültige Komprimierung");
  return value;
}
export function pdfInputs(value: unknown, allowEmpty = false): PdfInput[] {
  check(
    Array.isArray(value) &&
      value.length <= 40 &&
      (allowEmpty || value.length > 0),
    "1 bis 40 Unterlagen auswählen",
  );
  const result = value.map((entry) => {
    check(
      entry && typeof entry === "object" && !Array.isArray(entry),
      "Ungültiger PDF-Eintrag",
    );
    check(
      (entry.kind === "document" || entry.kind === "build") &&
        typeof entry.id === "string" &&
        uuid.test(entry.id),
      "Ungültige Unterlagenreferenz",
    );
    check(
      entry.pages === undefined ||
        (typeof entry.pages === "string" &&
          entry.pages.length <= 200 &&
          (entry.pages === "" ||
            /^[1-9]\d*(?:-[1-9]\d*)?(?:,[1-9]\d*(?:-[1-9]\d*)?)*$/.test(
              entry.pages,
            ))),
      "Seitenwahl wie 1-3,5 angeben",
    );
    return {
      kind: entry.kind,
      id: entry.id,
      ...(entry.pages ? { pages: entry.pages } : {}),
    } as PdfInput;
  });
  check(
    new Set(result.map((entry) => entry.kind + ":" + entry.id)).size ===
      result.length,
    "Unterlagen nicht doppelt auswählen",
  );
  return result;
}
type Source = {
  filename: string;
  mime: string;
  pages?: string;
  label: string;
  bytes: number;
  sha256: string;
};
export class PdfJobs {
  private tail = Promise.resolve();
  private pending = 0;
  readonly available: boolean;
  constructor(
    private store: Store,
    private builds: Builds,
    private runner?: PdfRunner,
    private notify: (app: string) => void = () => {},
  ) {
    this.available = Boolean(runner);
    store.db.exec(`
      CREATE TABLE IF NOT EXISTS pdf_jobs(id TEXT PRIMARY KEY,app TEXT REFERENCES apps(id),status TEXT NOT NULL,created TEXT NOT NULL,compression TEXT NOT NULL,items TEXT NOT NULL,snapshot TEXT NOT NULL,source_bytes INTEGER NOT NULL,bytes INTEGER,pages INTEGER,error TEXT,note TEXT,label TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS pdf_plans(app TEXT PRIMARY KEY REFERENCES apps(id) ON DELETE CASCADE,revision INTEGER NOT NULL,items TEXT NOT NULL,compression TEXT NOT NULL,excluded TEXT NOT NULL DEFAULT '[]');
    `);
    for (const row of store.db
      .prepare("SELECT id,status FROM pdf_jobs")
      .all()) {
      const interrupted = row.status === "queued" || row.status === "running";
      if (interrupted)
        store.db
          .prepare(
            "UPDATE pdf_jobs SET status='failed',error='Server während PDF-Aufbereitung beendet.' WHERE id=?",
          )
          .run(row.id);
      const id = String(row.id);
      if (uuid.test(id)) {
        this.clean(path.join(store.root, "pdf-jobs", id, "input"));
        if (interrupted || row.status === "failed")
          this.clean(path.join(store.root, "pdf-jobs", id, "output"));
      }
    }
  }
  private clean(directory: string) {
    try {
      fs.rmSync(directory, { recursive: true, force: true });
    } catch (error) {
      console.warn("PDF-Dateibereinigung ausstehend:", String(error));
    }
  }
  private announce(app: string | null) {
    if (app)
      try {
        this.notify(app);
      } catch (error) {
        console.warn("PDF-Benachrichtigung fehlgeschlagen:", String(error));
      }
  }
  private dto(row: Record<string, unknown>): PdfJob {
    return {
      id: String(row.id),
      app: row.app === null ? null : String(row.app),
      status: row.status as PdfJob["status"],
      created: String(row.created),
      compression: row.compression as PdfCompression,
      items: JSON.parse(String(row.items)),
      sourceBytes: Number(row.source_bytes),
      label: String(row.label),
      ...(row.bytes !== null ? { bytes: Number(row.bytes) } : {}),
      ...(row.pages !== null ? { pages: Number(row.pages) } : {}),
      ...(row.error ? { error: String(row.error) } : {}),
      ...(row.note ? { note: String(row.note) } : {}),
    };
  }
  get(id: unknown) {
    check(
      typeof id === "string" && uuid.test(id),
      "PDF-Aufbereitung nicht gefunden",
      404,
    );
    const row = this.store.db
      .prepare("SELECT * FROM pdf_jobs WHERE id=?")
      .get(id);
    check(row, "PDF-Aufbereitung nicht gefunden", 404);
    return this.dto(row);
  }
  list(app?: string) {
    if (app) {
      this.store.app(app);
      return this.store.db
        .prepare(
          "SELECT * FROM pdf_jobs WHERE app=? ORDER BY created DESC,rowid DESC LIMIT 50",
        )
        .all(app)
        .map((row) => this.dto(row));
    }
    return this.store.db
      .prepare(
        "SELECT * FROM pdf_jobs WHERE app IS NULL ORDER BY created DESC,rowid DESC LIMIT 50",
      )
      .all()
      .map((row) => this.dto(row));
  }
  busy(app: string) {
    return Boolean(
      this.store.db
        .prepare(
          "SELECT id FROM pdf_jobs WHERE app=? AND status IN ('queued','running')",
        )
        .get(app),
    );
  }
  private descriptors(app: string | null, items: PdfInput[]) {
    if (app) this.store.app(app);
    const selected = new Set(app ? this.store.documents.ids(app) : []);
    let documentsBytes = 0,
      buildCount = 0;
    const kinds = new Set<string>();
    const descriptors = items.map((item) => {
      if (item.kind === "document") {
        const document = this.store.documents.get(item.id);
        if (app)
          check(
            selected.has(item.id),
            "Anlagenauswahl inzwischen geändert. Neu laden.",
            409,
          );
        documentsBytes += document.bytes;
        return {
          label: document.label,
          bytes: document.bytes,
          mime: document.mime,
          read: () => this.store.documents.bytes(item.id),
        };
      }
      check(app, "Builds benötigen eine Bewerbung");
      const build = this.store.build(app, item.id);
      check(build.status === "success", "Build ohne erfolgreiches PDF", 409);
      check(
        !kinds.has(String(build.kind)),
        "Je ein Lebenslauf und Anschreiben auswählen",
      );
      kinds.add(String(build.kind));
      buildCount++;
      const file = this.builds.artifact(app, item.id),
        stat = fs.lstatSync(file);
      check(
        stat.isFile() &&
          !stat.isSymbolicLink() &&
          stat.size <= 32 * 1024 * 1024,
        "Builddatei ungültig",
      );
      return {
        label: build.kind === "cv" ? "Lebenslauf" : "Anschreiben",
        bytes: stat.size,
        mime: "application/pdf",
        read: () => fs.readFileSync(file),
      };
    });
    check(
      documentsBytes <= APPLICATION_DOCUMENT_LIMIT &&
        buildCount <= 2 &&
        descriptors.reduce((sum, entry) => sum + entry.bytes, 0) <=
          OUTPUT_LIMIT,
      "Auswahl ist zu groß (Anlagen maximal 100 MiB)",
    );
    return descriptors;
  }
  plan(app: string): PdfPlan {
    this.store.app(app);
    const row = this.store.db
      .prepare("SELECT * FROM pdf_plans WHERE app=?")
      .get(app);
    return row
      ? {
          revision: Number(row.revision),
          items: JSON.parse(String(row.items)),
          compression: row.compression as PdfCompression,
          excluded: JSON.parse(String(row.excluded)),
        }
      : { revision: 0, items: [], compression: "lossless", excluded: [] };
  }
  savePlan(app: string, input: Record<string, unknown>) {
    const current = this.plan(app);
    check(
      input.revision === current.revision,
      "PDF-Zusammenstellung inzwischen geändert. Neu laden.",
      409,
    );
    const items = pdfInputs(input.items, true),
      compression = compressionOf(input.compression);
    this.descriptors(app, items);
    const excluded = input.excluded === undefined ? [] : input.excluded;
    check(
      Array.isArray(excluded) &&
        excluded.length <= 42 &&
        excluded.every(
          (key) =>
            typeof key === "string" &&
            (/^document:[a-f0-9-]{36}$/.test(key) ||
              key === "build:cv" ||
              key === "build:cover"),
        ) &&
        new Set(excluded).size === excluded.length,
      "Ungültige ausgeschlossene Unterlagen",
    );
    const includedKeys = items.map((item) =>
      item.kind === "document"
        ? "document:" + item.id
        : "build:" + this.store.build(app, item.id).kind,
    );
    check(
      !includedKeys.some((key) => excluded.includes(key)),
      "Unterlage gleichzeitig ein- und ausgeschlossen",
    );
    this.store.db
      .prepare(
        "INSERT INTO pdf_plans VALUES(?,?,?,?,?) ON CONFLICT(app) DO UPDATE SET revision=excluded.revision,items=excluded.items,compression=excluded.compression,excluded=excluded.excluded",
      )
      .run(
        app,
        current.revision + 1,
        JSON.stringify(items),
        compression,
        JSON.stringify(excluded),
      );
    return this.plan(app);
  }
  capacity(count: number) {
    if (count === 0) return;
    check(this.available, "PDF-Werkzeuge sind noch nicht eingerichtet", 503);
    check(this.pending + count <= 8, "PDF-Warteschlange voll. Bitte warten.", 429);
  }
  start(input: Record<string, unknown>) {
    this.capacity(1);
    const items = pdfInputs(input.items),
      compression = compressionOf(input.compression);
    check(
      input.appId === undefined ||
        (typeof input.appId === "string" && uuid.test(input.appId)),
      "Ungültige Bewerbung",
    );
    const app = typeof input.appId === "string" ? input.appId : null;
    const label =
      input.label === undefined ? "Bewerbungsunterlagen" : input.label;
    check(
      typeof label === "string" &&
        label.trim().length > 0 &&
        label.trim().length <= 180 &&
        !/[\x00-\x1f\x7f]/.test(label),
      "Ungültiger Ergebnisname",
    );
    const descriptors = this.descriptors(app, items),
      id = randomUUID(),
      created = new Date().toISOString();
    const directory = path.join(this.store.root, "pdf-jobs", id),
      sourceDir = path.join(directory, "input"),
      output = path.join(directory, "output");
    fs.mkdirSync(sourceDir, { recursive: true, mode: 0o700 });
    fs.mkdirSync(output, { mode: 0o700 });
    const snapshot: Source[] = [];
    try {
      descriptors.forEach((source, index) => {
        const bytes = source.read(),
          mime = source.mime;
        check(
          bytes.length === source.bytes,
          "Quelldatei inzwischen geändert",
          409,
        );
        const filename =
          String(index).padStart(3, "0") +
          (mime === "application/pdf"
            ? ".pdf"
            : mime === "image/png"
              ? ".png"
              : ".jpg");
        fs.writeFileSync(path.join(sourceDir, filename), bytes, {
          mode: 0o600,
        });
        snapshot.push({
          filename,
          mime,
          label: source.label,
          bytes: bytes.length,
          sha256: createHash("sha256").update(bytes).digest("hex"),
          ...(items[index].pages ? { pages: items[index].pages } : {}),
        });
      });
      atomicFile(
        path.join(sourceDir, "plan.json"),
        Buffer.from(JSON.stringify({ compression, items: snapshot })),
      );
      this.store.db
        .prepare(
          "INSERT INTO pdf_jobs(id,app,status,created,compression,items,snapshot,source_bytes,label) VALUES(?,?,?,?,?,?,?,?,?)",
        )
        .run(
          id,
          app,
          "queued",
          created,
          compression,
          JSON.stringify(items),
          JSON.stringify(snapshot),
          descriptors.reduce((sum, entry) => sum + entry.bytes, 0),
          label.trim(),
        );
    } catch (error) {
      fs.rmSync(directory, { recursive: true, force: true });
      throw error;
    }
    this.pending++;
    this.tail = this.tail.then(async () => {
      this.store.db
        .prepare("UPDATE pdf_jobs SET status='running' WHERE id=?")
        .run(id);
      this.announce(app);
      try {
        const result = await this.runner!(
          sourceDir,
          output,
          "bewerbung-pdf-" + id,
        );
        const file = path.join(output, "result.pdf"),
          stat = fs.lstatSync(file);
        check(
          stat.isFile() &&
            !stat.isSymbolicLink() &&
            stat.size > 5 &&
            stat.size <= OUTPUT_LIMIT &&
            fs.readFileSync(file).subarray(0, 5).toString() === "%PDF-",
          "Kein gültiges PDF erzeugt",
        );
        check(
          Number.isSafeInteger(result.pages) &&
            result.pages > 0 &&
            result.pages <= 500,
          "Ungültige Seitenzahl",
        );
        this.store.db
          .prepare(
            "UPDATE pdf_jobs SET status='success',bytes=?,pages=?,note=? WHERE id=?",
          )
          .run(stat.size, result.pages, result.note || null, id);
      } catch (error) {
        this.store.db
          .prepare("UPDATE pdf_jobs SET status='failed',error=? WHERE id=?")
          .run(String(error).slice(0, 2500), id);
        this.clean(output);
      } finally {
        this.clean(sourceDir);
        this.pending--;
        this.announce(app);
      }
    });
    this.announce(app);
    return this.get(id);
  }
  artifact(id: string) {
    const job = this.get(id);
    check(job.status === "success", "PDF noch nicht erfolgreich erzeugt", 409);
    const file = path.join(
      this.store.root,
      "pdf-jobs",
      id,
      "output",
      "result.pdf",
    );
    const stat = fs.lstatSync(file);
    check(
      stat.isFile() && !stat.isSymbolicLink() && stat.size === job.bytes,
      "PDF-Ergebnis fehlt oder ist beschädigt",
      409,
    );
    return file;
  }
  save(id: string, input: Record<string, unknown>) {
    const job = this.get(id),
      bytes = fs.readFileSync(this.artifact(id));
    const label = input.label === undefined ? job.label : input.label;
    check(
      typeof label === "string" &&
        label.trim().length > 0 &&
        label.length <= 180 &&
        !/[\x00-\x1f\x7f]/.test(label),
      "Ungültige Dokumentbezeichnung",
    );
    // Validate requested metadata before any blob/row mutation, including dedupe cases.
    const tags = input.tags === undefined ? [] : input.tags;
    const normalized = normalizeTags(tags);
    const name =
      label
        .trim()
        .replace(/[/\\]/g, "_")
        .replace(/\.pdf$/i, "") + ".pdf";
    const document = this.store.documents.upload(name, bytes);
    if ("duplicate" in document) return document;
    return this.store.documents.update(document.id, {
      label: label.trim(),
      tags: normalized,
    });
  }
  idle() {
    return this.tail;
  }
}
