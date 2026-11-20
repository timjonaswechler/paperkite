import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { check } from "../files.ts";
import { readTemplateZip, safeRelative, shaFileLimit } from "./archive.ts";
import {
  adapterContract,
  buildCases,
  luaData,
  manifest,
  type ModManifest,
} from "./model.ts";

export type ModJob = {
  id: string;
  name: string;
  status:
    | "uploaded"
    | "generating"
    | "needs-input"
    | "checking"
    | "review"
    | "failed"
    | "interrupted";
  created: string;
  updated: string;
  sourceHash: string;
  sourceFingerprint: string;
  entrypoints: string[];
  files: string[];
  threadId?: string;
  threadUrl?: string;
  error?: string;
  manifest?: ModManifest;
  buildId?: string;
  artifactDigest?: string;
  versionId?: string;
  checks: {
    id: string;
    status: "passed" | "failed" | "unsupported";
    error?: string;
  }[];
};
export type ModThreadRunner = {
  generate: (
    workspace: string,
    onThread: (id: string, url: string) => void,
    onAttention: () => void,
    signal: AbortSignal,
  ) => Promise<void>;
  assertFinished: (threadId: string) => Promise<void>;
  remove?: (workspace: string) => Promise<void>;
};
export type ModBuilder = (
  input: string,
  output: string,
  signal?: AbortSignal,
) => Promise<{ text: string; log: string }>;
const digest = (b: Buffer | string) =>
  createHash("sha256").update(b).digest("hex");
export function collect(root: string) {
  const result: Record<string, Buffer> = {};
  let total = 0,
    count = 0;
  function visit(dir: string, prefix = "") {
    check(
      fs.lstatSync(dir).isDirectory() && !fs.lstatSync(dir).isSymbolicLink(),
      "Mod-Verzeichnis ist kein regulärer Ordner",
    );
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const name = prefix + e.name;
      safeRelative(name);
      const full = path.join(dir, e.name),
        s = fs.lstatSync(full);
      check(!s.isSymbolicLink(), "Symlinks im Mod sind nicht erlaubt");
      if (s.isDirectory()) visit(full, name + "/");
      else {
        check(s.isFile() && s.size <= shaFileLimit, "Ungültige Mod-Datei");
        total += s.size;
        check(
          ++count <= 200 && total <= 32 * 1024 * 1024,
          "Mod-Dateien zu groß",
        );
        check(
          /\.(tex|lua|sty|cls|cfg|def|json|png|jpe?g|ttf|otf|bib|bst)$/i.test(
            name,
          ),
          "Nicht unterstützter Mod-Dateityp",
        );
        result[name] = fs.readFileSync(full);
      }
    }
  }
  visit(root);
  return result;
}
function fingerprint(files: Record<string, Buffer>) {
  return digest(
    JSON.stringify(
      Object.keys(files)
        .sort()
        .map((k) => [k, digest(files[k]!)]),
    ),
  );
}
function put(root: string, files: Record<string, Buffer>) {
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  for (const [name, b] of Object.entries(files)) {
    safeRelative(name);
    const target = path.join(root, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, b, { mode: 0o600, flag: "wx" });
  }
}
export class CvModImports {
  readonly db: DatabaseSync;
  isUsed?: (id: string) => boolean;
  private active = new Map<
    string,
    { abort: AbortController; task: Promise<void> }
  >();
  private deleting = new Map<string, Promise<void>>();
  private closed = false;
  private closing?: Promise<void>;
  constructor(
    readonly root: string,
    private threads: ModThreadRunner,
    private build: ModBuilder,
  ) {
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path.join(root, "imports.sqlite"));
    this.db.exec(
      "PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS versions(id TEXT PRIMARY KEY,import_id TEXT NOT NULL,build_id TEXT NOT NULL,digest TEXT NOT NULL,manifest TEXT NOT NULL,name TEXT NOT NULL)",
    );
    for (const job of this.list())
      if (["generating", "needs-input", "checking"].includes(job.status)) {
        job.status = "interrupted";
        job.error =
          "Prototyp wurde neu gestartet. Vorhandenen Thread prüfen; keine automatische neue Modellrunde.";
        this.save(job);
      }
  }
  private directory(id: string) {
    check(/^[a-f0-9-]{36}$/.test(id), "Ungültige Import-ID");
    return path.join(this.root, id);
  }
  get(id: string): ModJob {
    this.directory(id);
    const row = this.db.prepare("SELECT value FROM jobs WHERE id=?").get(id);
    check(row, "Vorlagenimport nicht gefunden", 404);
    return JSON.parse(String(row.value));
  }
  list(): ModJob[] {
    return this.db
      .prepare("SELECT value FROM jobs ORDER BY rowid DESC")
      .all()
      .map((r) => JSON.parse(String(r.value)));
  }
  private save(job: ModJob) {
    job.updated = new Date().toISOString();
    this.db
      .prepare(
        "INSERT INTO jobs VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
      )
      .run(job.id, JSON.stringify(job));
  }
  upload(name: unknown, bytes: Buffer, kind: unknown) {
    check(!this.closed, "Prototyp wird beendet", 503);
    check(
      kind === "cv-template",
      "Dieser Ablauf ist nur für Lebenslauf-Vorlagen",
    );
    check(
      typeof name === "string" &&
        name.length > 0 &&
        name.length <= 160 &&
        name.toLowerCase().endsWith(".zip"),
      "Lebenslauf-Vorlage als LaTeX-ZIP hochladen",
    );
    check(this.list().length < 20, "Prototyp auf 20 Importe begrenzt");
    const archive = readTemplateZip(bytes),
      id = randomUUID(),
      dir = this.directory(id);
    try {
      put(path.join(dir, "workspace", "source"), archive.files);
      fs.mkdirSync(path.join(dir, "workspace", "mod"), { mode: 0o700 });
      fs.writeFileSync(
        path.join(dir, "workspace", "ADAPTER-CONTRACT.md"),
        adapterContract,
        { mode: 0o600 },
      );
      fs.writeFileSync(path.join(dir, "original.zip"), bytes, { mode: 0o600 });
      const now = new Date().toISOString();
      const job: ModJob = {
        id,
        name,
        status: "uploaded",
        created: now,
        updated: now,
        sourceHash: digest(bytes),
        sourceFingerprint: fingerprint(archive.files),
        entrypoints: archive.entrypoints,
        files: Object.keys(archive.files).sort(),
        checks: [],
      };
      this.save(job);
      return job;
    } catch (e) {
      fs.rmSync(dir, { recursive: true, force: true });
      throw e;
    }
  }
  start(id: string) {
    check(!this.closed, "Prototyp wird beendet", 503);
    const job = this.get(id);
    check(!this.deleting.has(id), "Vorlagenimport wird gelöscht", 409);
    if (this.active.has(id)) return job;
    check(
      job.status === "uploaded",
      "KI wurde bereits gestartet; vorhandenen Thread prüfen",
      409,
    );
    check(this.active.size === 0, "Es läuft bereits ein Mod-Auftrag", 429);
    job.status = "generating";
    delete job.error;
    this.save(job);
    this.spawn(id, async (signal) => {
      await this.threads.generate(
        path.join(this.directory(id), "workspace"),
        (threadId, threadUrl) => {
          const j = this.get(id);
          j.threadId = threadId;
          j.threadUrl = threadUrl;
          this.save(j);
        },
        () => {
          const j = this.get(id);
          j.status = "needs-input";
          this.save(j);
        },
        signal,
      );
      await this.verify(id, signal);
    });
    return this.get(id);
  }
  recheck(id: string) {
    check(!this.closed, "Vorlagenimport wird beendet", 503);
    check(!this.deleting.has(id), "Vorlagenimport wird gelöscht", 409);
    const job = this.get(id);
    check(!this.active.has(id), "Auftrag arbeitet noch", 409);
    check(job.threadId, "Noch kein KI-Thread vorhanden", 409);
    check(this.active.size === 0, "Es läuft bereits ein Mod-Auftrag", 429);
    job.status = "checking";
    delete job.error;
    this.save(job);
    this.spawn(id, async (signal) => {
      await this.threads.assertFinished(job.threadId!);
      await this.verify(id, signal);
    });
    return job;
  }
  private spawn(id: string, run: (signal: AbortSignal) => Promise<void>) {
    const abort = new AbortController();
    const task = Promise.resolve()
      .then(() => run(abort.signal))
      .catch((error) => {
        const job = this.get(id);
        job.status = abort.signal.aborted ? "interrupted" : "failed";
        job.error = (
          error instanceof Error ? error.message : String(error)
        ).slice(-4000);
        this.save(job);
      })
      .finally(() => this.active.delete(id));
    this.active.set(id, { abort, task });
  }
  private async verify(id: string, signal: AbortSignal) {
    let job = this.get(id);
    job.status = "checking";
    job.checks = [];
    this.save(job);
    const workspace = path.join(this.directory(id), "workspace");
    check(
      fingerprint(collect(path.join(workspace, "source"))) ===
        job.sourceFingerprint,
      "Originalquellen wurden verändert; keine Übernahme",
    );
    const files = collect(path.join(workspace, "mod"));
    check(files["mod.json"], "KI hat keine mod.json erzeugt");
    let value: unknown;
    try {
      value = JSON.parse(files["mod.json"].toString("utf8"));
    } catch {
      throw new Error("mod.json enthält ungültiges JSON");
    }
    const config = manifest(value);
    check(files[config.entrypoint], "Hauptdatei aus mod.json fehlt");
    const hash = fingerprint(files);
    const buildId = randomUUID(),
      base = path.join(this.directory(id), "builds", buildId);
    job.manifest = config;
    job.buildId = buildId;
    job.artifactDigest = hash;
    this.save(job);
    for (const test of buildCases) {
      if (
        test.requiresField &&
        !config.fields.some((f) => f.key === test.requiresField)
      ) {
        job = this.get(id);
        job.checks.push({
          id: test.id,
          status: "unsupported",
          error: "Diese Mod deklariert dieses optionale Feld nicht.",
        });
        this.save(job);
        continue;
      }
      signal.throwIfAborted();
      const input = path.join(base, test.id, "input"),
        output = path.join(base, test.id, "output");
      put(input, {
        ...files,
        "cv-data.lua": Buffer.from("return " + luaData(test.data) + "\n"),
      });
      fs.mkdirSync(output, { recursive: true, mode: 0o700 });
      let error: string | undefined;
      try {
        const result = await this.build(input, output, signal),
          pdf = path.join(output, "document.pdf");
        check(
          fs.lstatSync(pdf).isFile() &&
            !fs.lstatSync(pdf).isSymbolicLink() &&
            fs.statSync(pdf).size <= 32 * 1024 * 1024 &&
            fs.readFileSync(pdf).subarray(0, 5).toString() === "%PDF-",
          "Kein gültiges PDF",
        );
        fs.writeFileSync(
          path.join(output, "build.log"),
          result.log.slice(-100000),
        );
        const text = result.text.replace(/\s+/g, " ");
        for (const expected of test.expected)
          check(text.includes(expected), "Inhalt fehlt im PDF: " + expected);
        for (const forbidden of test.forbidden)
          check(
            !text.includes(forbidden),
            "Unerwarteter Inhalt im PDF: " + forbidden,
          );
        if (test.id === "mixed")
          check(
            text.indexOf("BeforeMarker41") < text.indexOf("MiddleMarker43") &&
              text.indexOf("MiddleMarker43") < text.indexOf("AfterMarker47"),
            "Reihenfolge im PDF verändert",
          );
      } catch (e) {
        error = (e instanceof Error ? e.message : String(e)).slice(-4000);
      }
      job = this.get(id);
      job.checks.push({
        id: test.id,
        status: error ? "failed" : "passed",
        ...(error ? { error } : {}),
      });
      this.save(job);
    }
    check(
      fingerprint(collect(path.join(workspace, "mod"))) === hash,
      "Mod wurde während der Prüfung verändert; erneut prüfen",
    );
    check(
      job.checks.every(
        (c) => c.status === "passed" || c.status === "unsupported",
      ),
      "Adapterprüfung fehlgeschlagen; vorhandenen Thread überarbeiten lassen und erneut prüfen",
    );
    job.versionId = job.id + "." + buildId;
    this.db
      .prepare("INSERT INTO versions VALUES(?,?,?,?,?,?)")
      .run(
        job.versionId,
        job.id,
        buildId,
        hash,
        JSON.stringify(config),
        job.name,
      );
    job.status = "review";
    this.save(job);
  }
  async remove(id: string, updated: unknown) {
    check(!this.closed, "Vorlagenimport wird beendet", 503);
    const job = this.get(id);
    check(
      job.updated === updated,
      "Vorlagenimport inzwischen geändert. Neu laden.",
      409,
    );
    check(
      !this.active.has(id),
      "KI oder Prüfung arbeitet noch. Erst den nativen Thread beenden.",
      409,
    );
    check(
      !this.isUsed?.(id),
      "Diese Vorlage wird noch in einer Bewerbung verwendet.",
      409,
    );
    if (job.threadId)
      check(
        this.threads.remove,
        "Native Thread-Bereinigung ist nicht verfügbar",
        503,
      );
    check(!this.deleting.has(id), "Vorlagenimport wird bereits gelöscht", 409);
    const task = Promise.resolve().then(async () => {
      await this.threads.remove?.(path.join(this.directory(id), "workspace"));
      check(
        !this.isUsed?.(id),
        "Diese Vorlage wird inzwischen verwendet.",
        409,
      );
      fs.rmSync(this.directory(id), { recursive: true, force: true });
      this.db.prepare("DELETE FROM versions WHERE import_id=?").run(id);
      this.db.prepare("DELETE FROM jobs WHERE id=?").run(id);
    });
    this.deleting.set(id, task);
    try {
      await task;
    } finally {
      this.deleting.delete(id);
    }
  }
  reviewed(id: string) {
    let versionId = id;
    if (!id.includes(".")) {
      const job = this.get(id);
      check(
        job.status === "review" && job.versionId,
        "Vorlagen-Mod ist noch nicht erfolgreich geprüft. Erneut prüfen.",
        409,
      );
      versionId = job.versionId;
    }
    const row = this.db
      .prepare("SELECT * FROM versions WHERE id=?")
      .get(versionId);
    check(row, "Geprüfte Mod-Version nicht gefunden", 404);
    check(
      !this.deleting.has(String(row.import_id)),
      "Vorlagenimport wird gelöscht",
      409,
    );
    const files = collect(
      path.join(
        this.directory(String(row.import_id)),
        "builds",
        String(row.build_id),
        "bullets",
        "input",
      ),
    );
    delete files["cv-data.lua"];
    check(
      fingerprint(files) === row.digest,
      "Geprüfter Vorlagenstand wurde verändert. Erneut prüfen.",
      409,
    );
    const config = manifest(JSON.parse(String(row.manifest)));
    return {
      id: versionId,
      name: String(row.name),
      digest: String(row.digest),
      files,
      fields: config.fields,
    };
  }
  artifact(id: string, testId: string) {
    const job = this.get(id);
    check(
      buildCases.some((c) => c.id === testId) &&
        job.checks.some((c) => c.id === testId && c.status === "passed") &&
        job.buildId,
      "Geprüftes PDF nicht vorhanden",
      404,
    );
    const file = path.join(
      this.directory(id),
      "builds",
      job.buildId,
      testId,
      "output",
      "document.pdf",
    );
    check(
      fs.existsSync(file) && !fs.lstatSync(file).isSymbolicLink(),
      "PDF nicht vorhanden",
      404,
    );
    return file;
  }
  async idle() {
    await Promise.all(
      [...this.active.values()]
        .map((v) => v.task)
        .concat([...this.deleting.values()]),
    );
  }
  close() {
    return (this.closing ||= (async () => {
      this.closed = true;
      for (const v of this.active.values()) v.abort.abort();
      await Promise.allSettled(
        [...this.active.values()]
          .map((v) => v.task)
          .concat([...this.deleting.values()]),
      );
      this.db.close();
    })());
  }
}
