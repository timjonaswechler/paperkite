import fs from "node:fs";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { zipSync } from "fflate";
import type {
  DeliveryJob,
  DeliveryPlan,
  DeliveryOutput,
  PdfInput,
} from "../shared/api.ts";
import { Store } from "./store.ts";
import { Builds } from "./builds.ts";
import { PdfJobs, pdfInputs } from "./pdf-jobs.ts";
import { check, atomicFile } from "./files.ts";

const uuid = /^[a-f0-9-]{36}$/;
const limit = 180 * 1024 * 1024;
export function deliveryFilename(
  label: string,
  applicant: string,
  company: string,
  role: string,
  extension = "pdf",
) {
  const part = (value: string) =>
    value
      .normalize("NFKD")
      .replace(/ß/g, "ss")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 45);
  return (
    ([label, applicant, company, role]
      .map(part)
      .filter(Boolean)
      .join("_")
      .slice(0, 175) || "Bewerbung") +
    "." +
    extension
  );
}
export class Deliveries {
  private work = new Set<Promise<void>>();
  constructor(
    private store: Store,
    private builds: Builds,
    private pdfs: PdfJobs,
    private notify: (app: string) => void = () => {},
  ) {
    store.db.exec(`
      CREATE TABLE IF NOT EXISTS delivery_plans(app TEXT PRIMARY KEY REFERENCES apps(id) ON DELETE CASCADE,revision INTEGER NOT NULL,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS delivery_jobs(id TEXT PRIMARY KEY,app TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,status TEXT NOT NULL,created TEXT NOT NULL,value TEXT NOT NULL,error TEXT,bytes INTEGER,sha256 TEXT);
      UPDATE delivery_jobs SET status='failed',error='Server während Paketerstellung beendet. Bitte erneut erstellen.' WHERE status IN ('queued','running');
    `);
  }
  plan(appId: string): DeliveryPlan {
    this.store.app(appId);
    const row = this.store.db
      .prepare("SELECT * FROM delivery_plans WHERE app=?")
      .get(appId);
    if (row)
      return {
        ...JSON.parse(String(row.value)),
        revision: Number(row.revision),
      };
    const history = this.store.builds(appId);
    const legacy = this.pdfs.plan(appId);
    const items: PdfInput[] = [];
    for (const kind of ["cover", "cv"]) {
      const build = history.find(
        (entry) => entry.kind === kind && entry.status === "success",
      );
      if (build) items.push({ kind: "build", id: String(build.id) });
    }
    for (const doc of this.store.documents.selected(appId))
      items.push({ kind: "document", id: doc.id });
    return {
      revision: 0,
      format: "pdf",
      outputs: [
        {
          id: "gesamt",
          label: "Bewerbung",
          mode: "merge",
          items: legacy.revision ? legacy.items : items,
          compression: legacy.revision ? legacy.compression : "none",
        },
      ],
    };
  }
  private validate(
    appId: string,
    input: Record<string, unknown>,
    complete: boolean,
  ): Omit<DeliveryPlan, "revision"> {
    check(
      input.format === "pdf" || input.format === "zip",
      "PDF oder ZIP wählen",
    );
    check(
      Array.isArray(input.outputs) &&
        input.outputs.length > 0 &&
        input.outputs.length <= 8 &&
        (input.format !== "pdf" || input.outputs.length === 1),
      "Ein PDF benötigt genau eine Ausgabe; ZIP maximal acht",
    );
    const selected = new Set(this.store.documents.ids(appId));
    const outputs: DeliveryOutput[] = input.outputs.map((raw) => {
      check(
        raw && typeof raw === "object" && !Array.isArray(raw),
        "Ungültige Ausgabe",
      );
      check(
        typeof raw.id === "string" && /^[a-zA-Z0-9_-]{1,64}$/.test(raw.id),
        "Ungültige Ausgabe-ID",
      );
      check(
        typeof raw.label === "string" &&
          raw.label.trim().length > 0 &&
          raw.label.length <= 80 &&
          !/[\x00-\x1f\x7f/\\]/.test(raw.label),
        "Gültige Ausgabebezeichnung angeben",
      );
      check(
        raw.mode === "merge" || raw.mode === "original",
        "Zusammenstellen oder Original wählen",
      );
      check(
        ["none", "lossless", "compact"].includes(raw.compression),
        "Ungültige Kompression",
      );
      const items = pdfInputs(raw.items, !complete);
      check(
        raw.mode !== "original" ||
          (((!complete && items.length === 0) || items.length === 1) &&
            raw.compression === "none" &&
            items.every((item) => !item.pages)),
        "Original: genau eine vollständige PDF ohne Kompression auswählen",
      );
      for (const item of items) {
        if (item.kind === "document") {
          check(
            selected.has(item.id),
            "Anlage nicht mehr ausgewählt. Paketplan prüfen.",
            409,
          );
          const document = this.store.documents.get(item.id);
          check(
            raw.mode !== "original" || document.mime === "application/pdf",
            "Bilder müssen zuerst als PDF zusammengestellt werden",
          );
        } else {
          const build = this.store.build(appId, item.id);
          check(
            build.status === "success",
            "PDF noch nicht erfolgreich gebaut",
            409,
          );
          this.builds.artifact(appId, item.id);
        }
      }
      return {
        id: raw.id,
        label: raw.label.trim(),
        mode: raw.mode,
        compression: raw.compression,
        items,
      };
    });
    check(
      new Set(outputs.map((output) => output.id)).size === outputs.length,
      "Ausgabe-IDs dürfen nicht doppelt vorkommen",
    );
    return { format: input.format, outputs };
  }
  savePlan(appId: string, input: Record<string, unknown>): DeliveryPlan {
    const current = this.plan(appId);
    check(
      current.revision === input.revision,
      "Paketplan inzwischen geändert. Neu laden.",
      409,
    );
    const value = this.validate(appId, input, false);
    const revision = current.revision + 1;
    this.store.db
      .prepare(
        "INSERT INTO delivery_plans VALUES(?,?,?) ON CONFLICT(app) DO UPDATE SET revision=excluded.revision,value=excluded.value",
      )
      .run(appId, revision, JSON.stringify(value));
    return { ...value, revision };
  }
  get(appId: string, id: string): DeliveryJob {
    check(uuid.test(id), "Paket nicht gefunden", 404);
    const row = this.store.db
      .prepare("SELECT * FROM delivery_jobs WHERE id=? AND app=?")
      .get(id, appId);
    check(row, "Paket nicht gefunden", 404);
    return {
      ...JSON.parse(String(row.value)),
      status: row.status,
      ...(row.error ? { error: String(row.error) } : {}),
    };
  }
  list(appId: string) {
    this.store.app(appId);
    return this.store.db
      .prepare(
        "SELECT id FROM delivery_jobs WHERE app=? ORDER BY created DESC,rowid DESC LIMIT 30",
      )
      .all(appId)
      .map((row) => this.get(appId, String(row.id)));
  }
  start(appId: string, revision: unknown): DeliveryJob {
    const app = this.store.app(appId),
      plan = this.plan(appId);
    check(
      plan.revision === revision,
      "Paketplan inzwischen geändert. Neu laden.",
      409,
    );
    const validated = this.validate(
      appId,
      plan as unknown as Record<string, unknown>,
      true,
    );
    const count = validated.outputs.filter(
      (output) => output.mode === "merge",
    ).length;
    this.pdfs.capacity(count);
    const id = randomUUID(),
      directory = path.join(this.store.root, "delivery-jobs", id);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const settings = this.store.preferences.settings();
    const outputs: DeliveryJob["outputs"] = [];
    const names = new Set<string>();
    const job: DeliveryJob = {
      id,
      app: appId,
      created: new Date().toISOString(),
      status: "queued",
      sourceRevision: app.revision,
      filename: deliveryFilename(
        "Bewerbung",
        settings.applicantName,
        app.company,
        app.role,
        plan.format,
      ),
      outputs,
    };
    this.store.db
      .prepare(
        "INSERT INTO delivery_jobs(id,app,status,created,value) VALUES(?,?,?,?,?)",
      )
      .run(id, appId, job.status, job.created, JSON.stringify(job));
    try {
      for (const output of validated.outputs) {
        let filename = deliveryFilename(
            output.label,
            settings.applicantName,
            app.company,
            app.role,
          ),
          suffix = 1;
        const stem = filename.slice(0, -4);
        while (names.has(filename.toLowerCase()))
          filename = stem + "_" + ++suffix + ".pdf";
        names.add(filename.toLowerCase());
        if (output.mode === "original") {
          const item = output.items[0]!;
          const bytes =
            item.kind === "document"
              ? this.store.documents.bytes(item.id)
              : fs.readFileSync(this.builds.artifact(appId, item.id));
          check(bytes.length <= limit, "Original zu groß");
          fs.writeFileSync(path.join(directory, filename), bytes, {
            mode: 0o600,
          });
          outputs.push({ filename, original: item.id });
        } else {
          const pdf = this.pdfs.start({
            appId,
            items: output.items,
            compression: output.compression,
            label: output.label,
          });
          outputs.push({ filename, pdfJob: pdf.id });
        }
      }
      if (plan.format === "pdf") job.filename = outputs[0]!.filename;
      this.store.db
        .prepare("UPDATE delivery_jobs SET value=?,status='running' WHERE id=?")
        .run(JSON.stringify(job), id);
    } catch (error) {
      this.store.db
        .prepare("UPDATE delivery_jobs SET status='failed',error=? WHERE id=?")
        .run(String(error).slice(0, 2000), id);
      this.announce(appId);
      throw error;
    }
    const work = (async () => {
      try {
        await this.pdfs.idle();
        let total = 0;
        const archive: Record<string, Uint8Array> = {};
        for (const output of outputs) {
          const file = path.join(directory, output.filename);
          if (output.pdfJob) {
            const pdf = this.pdfs.get(output.pdfJob);
            check(
              pdf.status === "success",
              pdf.error || "Eine PDF-Ausgabe konnte nicht erstellt werden",
              409,
            );
            fs.copyFileSync(this.pdfs.artifact(pdf.id), file);
          }
          const bytes = fs.readFileSync(file);
          total += bytes.length;
          check(total <= limit, "Paket maximal 180 MiB");
          archive[output.filename] = bytes;
        }
        const bytes =
          plan.format === "zip"
            ? Buffer.from(zipSync(archive, { level: 0 }))
            : Buffer.from(archive[outputs[0]!.filename]!);
        check(bytes.length <= limit, "Paket maximal 180 MiB");
        atomicFile(path.join(directory, "result"), bytes);
        this.store.db
          .prepare(
            "UPDATE delivery_jobs SET status='success',bytes=?,sha256=? WHERE id=?",
          )
          .run(
            bytes.length,
            createHash("sha256").update(bytes).digest("hex"),
            id,
          );
      } catch (error) {
        this.store.db
          .prepare(
            "UPDATE delivery_jobs SET status='failed',error=? WHERE id=?",
          )
          .run(String(error).slice(0, 2000), id);
      }
      this.announce(appId);
    })();
    this.work.add(work);
    void work.then(() => this.work.delete(work));
    this.announce(appId);
    return this.get(appId, id);
  }
  artifact(appId: string, id: string) {
    const job = this.get(appId, id);
    check(
      job.status === "success",
      "Paket noch nicht erfolgreich erstellt",
      409,
    );
    const file = path.join(this.store.root, "delivery-jobs", id, "result"),
      stat = fs.lstatSync(file);
    const row = this.store.db
      .prepare("SELECT bytes,sha256 FROM delivery_jobs WHERE id=?")
      .get(id)!;
    check(
      stat.isFile() &&
        !stat.isSymbolicLink() &&
        stat.size === row.bytes &&
        createHash("sha256").update(fs.readFileSync(file)).digest("hex") ===
          row.sha256,
      "Paketergebnis fehlt oder wurde verändert",
      409,
    );
    return file;
  }
  private announce(app: string) {
    try {
      this.notify(app);
    } catch {
      /* A disconnected viewer does not invalidate a completed download. */
    }
  }
  async idle() {
    await Promise.all(this.work);
  }
}
