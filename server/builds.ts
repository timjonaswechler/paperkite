import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn, execFile } from "node:child_process";
import { check, fileMap, putMap } from "./files.ts";
import { Store } from "./store.ts";
import { decodeCover } from "./cover-letter.ts";
import { safeRelative } from "./cv-mod-prototype/archive.ts";
import { dockerModBuilder } from "./cv-mod-prototype/native.ts";
import { collect } from "./cv-mod-prototype/imports.ts";
export type BuildKind = "cv" | "cover";
export type Runner = (
  input: string,
  output: string,
  kind: BuildKind,
  profile: string,
  name: string,
  options?: { cvMod?: boolean; coverMod?: boolean },
) => Promise<string>;
export function dockerRunner(image: string): Runner {
  check(
    /^sha256:[a-f0-9]{64}$/.test(image),
    "Builder-Image muss per ID gepinnt sein",
    503,
  );
  return (input, output, kind, profile, name, options) => {
    if (
      (kind === "cv" && options?.cvMod) ||
      (kind === "cover" && options?.coverMod)
    )
      return dockerModBuilder(
        image,
        fs.readFileSync("pdf-tools/image-id", "utf8").trim(),
      )(input, output).then((result) => result.log);
    return new Promise((resolve, reject) => {
      const args = [
        "run",
        "--rm",
        "--name",
        name,
        "--network=none",
        "--read-only",
        "--cap-drop=ALL",
        "--security-opt=no-new-privileges",
        "--pids-limit=64",
        "--memory=768m",
        "--cpus=1",
        "--ulimit",
        "fsize=33554432:33554432",
        "--user",
        `${process.getuid!()}:${process.getgid!()}`,
        "--tmpfs",
        "/tmp:rw,nosuid,nodev,noexec,size=128m,mode=1777",
        "--tmpfs",
        "/work:rw,nosuid,nodev,noexec,size=128m,mode=1777",
        "--mount",
        `type=bind,src=${input},dst=/input,readonly`,
        "--mount",
        `type=bind,src=${output},dst=/out`,
        image,
        kind,
        profile,
      ];
      const child = spawn("/usr/bin/docker", args, {
        stdio: ["ignore", "pipe", "pipe"],
      });
      let log = "",
        timedOut = false;
      const capture = (b: Buffer) => {
        if (log.length < 1024 * 1024)
          log += b.toString().slice(0, 1024 * 1024 - log.length);
      };
      child.stdout.on("data", capture);
      child.stderr.on("data", capture);
      const timer = setTimeout(() => {
        timedOut = true;
        execFile("/usr/bin/docker", ["rm", "-f", name], () => {});
      }, 120000);
      child.on("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0 && !timedOut) resolve(log);
        else
          reject(
            new Error((timedOut ? "Zeitlimit überschritten\n" : "") + log),
          );
      });
    });
  };
}
export class Builds {
  private tail: Promise<void> = Promise.resolve();
  private queued = new Map<string, string>();
  constructor(
    public store: Store,
    private runner: Runner,
    private notify: (app: string) => void = () => {},
  ) {
    store.db.exec(
      "CREATE TABLE IF NOT EXISTS pending_build_deletions(id TEXT PRIMARY KEY)",
    );
    this.cleanDeleted();
  }
  private cleanDeleted() {
    const parent = path.join(this.store.root, "builds");
    for (const row of this.store.db
      .prepare("SELECT id FROM pending_build_deletions")
      .all()) {
      const id = String(row.id);
      try {
        check(/^[a-f0-9-]{36}$/.test(id), "Ungültiger Build-Löschauftrag");
        check(
          !this.store.db.prepare("SELECT 1 FROM builds WHERE id=?").get(id),
          "Build wird noch verwendet",
        );
        check(
          !fs.lstatSync(parent, { throwIfNoEntry: false })?.isSymbolicLink(),
          "Buildordner ist ein Symlink",
        );
        fs.rmSync(path.join(parent, id), { recursive: true, force: true });
        this.store.db
          .prepare("DELETE FROM pending_build_deletions WHERE id=?")
          .run(id);
      } catch (error) {
        console.warn("Build-Dateibereinigung ausstehend:", id, String(error));
      }
    }
  }
  private references(app: string) {
    const result = new Map<string, string>();
    const collect = (value: unknown, reason: string) => {
      if (Array.isArray(value)) {
        for (const entry of value) collect(entry, reason);
        return;
      }
      if (!value || typeof value !== "object") return;
      const object = value as Record<string, unknown>;
      if (object.kind === "build" && typeof object.id === "string")
        result.set(object.id, reason);
      if (typeof object.original === "string")
        result.set(object.original, reason);
      for (const entry of Object.values(object)) collect(entry, reason);
    };
    const tables = new Set(
      this.store.db
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all()
        .map((r) => String(r.name)),
    );
    for (const [table, column, jobs] of [
      ["delivery_plans", "value", false],
      ["pdf_plans", "items", false],
      ["pdf_jobs", "items", true],
      ["delivery_jobs", "value", true],
    ] as const) {
      if (!tables.has(table)) continue;
      for (const row of this.store.db
        .prepare(
          `SELECT ${column} AS value FROM ${table} WHERE app=? ${jobs ? "AND status IN ('queued','running','success')" : ""}`,
        )
        .all(app))
        collect(
          JSON.parse(String(row.value)),
          "In einem Versand-/PDF-Auftrag oder gespeicherten Plan verwendet",
        );
    }
    return result;
  }
  private blocked(
    build: Record<string, unknown>,
    references: Map<string, string>,
  ) {
    if (build.status === "queued" || build.status === "running")
      return "Build läuft noch";
    if (build.finalized) return "Festgehaltene Version";
    return references.get(String(build.id));
  }
  history(app: string) {
    const references = this.references(app);
    return this.store.builds(app).map((build) => {
      const reason = this.blocked(build, references);
      return Object.assign(build, reason ? { deletionBlocked: reason } : {});
    });
  }
  private removeMany(app: string, ids: string[], strict: boolean) {
    const removed: string[] = [];
    this.store.db.exec("BEGIN IMMEDIATE");
    try {
      const references = this.references(app);
      for (const id of ids) {
        const build = this.store.build(app, id),
          reason = this.blocked(build, references);
        if (reason) {
          check(!strict, reason, 409);
          continue;
        }
        check(/^[a-f0-9-]{36}$/.test(id), "Ungültige Build-ID");
        this.store.db
          .prepare("INSERT INTO pending_build_deletions VALUES(?)")
          .run(id);
        this.store.db
          .prepare("DELETE FROM builds WHERE app=? AND id=?")
          .run(app, id);
        removed.push(id);
      }
      this.store.db.exec("COMMIT");
    } catch (error) {
      this.store.db.exec("ROLLBACK");
      throw error;
    }
    this.cleanDeleted();
    return removed.length;
  }
  remove(app: string, id: string) {
    this.removeMany(app, [id], true);
    this.notify(app);
    return {
      ok: true,
      cleanupPending: Boolean(
        this.store.db
          .prepare("SELECT 1 FROM pending_build_deletions WHERE id=?")
          .get(id),
      ),
    };
  }
  private prune(app: string, id: string, kind: BuildKind) {
    const older = this.store.db
      .prepare(
        "SELECT id FROM builds WHERE app=? AND kind=? AND rowid<(SELECT rowid FROM builds WHERE id=?) AND status NOT IN ('queued','running')",
      )
      .all(app, kind, id)
      .map((row) => String(row.id));
    return this.removeMany(app, older, false);
  }
  request(app: string, kind: unknown) {
    check(kind === "cv" || kind === "cover", "Buildtyp ungültig");
    const a = this.store.app(app),
      key = app + ":" + kind + ":" + a.revision;
    const previous = this.queued.get(key);
    if (previous) return this.store.build(app, previous);
    for (const document of this.store.documents.selected(app))
      this.store.documents.bytes(document.id);
    const id = randomUUID(),
      dir = path.join(this.store.root, "builds", id);
    const cvPlan = kind === "cv" ? this.store.cv.plan(app) : null;
    const coverPlan = kind === "cover" ? this.store.cover.plan(app) : null;
    const documentPlan = cvPlan || coverPlan;
    fs.mkdirSync(path.join(dir, "output"), { recursive: true, mode: 0o700 });
    if (documentPlan) {
      for (const [name, bytes] of Object.entries(documentPlan.files)) {
        safeRelative(name);
        const file = path.join(dir, "input", name);
        fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
        fs.writeFileSync(file, bytes, { mode: 0o600, flag: "wx" });
      }
    } else putMap(path.join(dir, "input"), fileMap(this.store.workspace(app)));
    // Inputs are never written after this point; Docker receives a read-only mount.
    this.store.db.exec("BEGIN");
    try {
      this.store.db
        .prepare(
          "INSERT INTO builds(id,app,kind,revision,status,created) VALUES(?,?,?,?,?,?)",
        )
        .run(id, app, kind, a.revision, "queued", new Date().toISOString());
      this.store.documents.snapshot(id, app);
      this.store.db.exec("COMMIT");
    } catch (error) {
      this.store.db.exec("ROLLBACK");
      fs.rmSync(dir, { recursive: true, force: true });
      throw error;
    }
    this.queued.set(key, id);
    this.tail = this.tail.then(async () => {
      this.queued.delete(key);
      this.store.db
        .prepare("UPDATE builds SET status='running' WHERE id=?")
        .run(id);
      this.notify(app);
      try {
        const log = await this.runner(
          path.join(dir, "input"),
          path.join(dir, "output"),
          kind,
          a.profile,
          "bewerbung-build-" + id,
          cvPlan?.mod
            ? { cvMod: true }
            : coverPlan?.mod
              ? { coverMod: true }
              : undefined,
        );
        const pdf = path.join(dir, "output", "document.pdf");
        check(
          fs.existsSync(pdf) &&
            !fs.lstatSync(pdf).isSymbolicLink() &&
            fs.statSync(pdf).size <= 32 * 1024 * 1024,
          "Kein gültiges PDF erzeugt",
        );
        const bytes = fs.readFileSync(pdf);
        check(
          bytes.subarray(0, 5).toString() === "%PDF-",
          "Kein gültiges PDF erzeugt",
        );
        this.store.db
          .prepare("UPDATE builds SET status='success',log=? WHERE id=?")
          .run(log, id);
      } catch (e) {
        this.store.db
          .prepare("UPDATE builds SET status='failed',log=? WHERE id=?")
          .run(String(e).slice(0, 1024 * 1024), id);
        this.store.documents.dropSnapshot(id);
      }
      if (
        this.store.build(app, id).status === "success" &&
        this.store.preferences.settings().autoPruneBuilds
      ) {
        try {
          const removed = this.prune(app, id, kind);
          if (removed)
            this.store.db
              .prepare("UPDATE builds SET log=log||? WHERE id=?")
              .run(`\n${removed} ältere Builds automatisch bereinigt.`, id);
        } catch (error) {
          this.store.db
            .prepare("UPDATE builds SET log=log||? WHERE id=?")
            .run(
              "\nAutomatische Build-Bereinigung fehlgeschlagen: " +
                String(error).slice(-2000),
              id,
            );
        }
      }
      this.notify(app);
    });
    this.notify(app);
    return this.store.build(app, id);
  }
  inputFiles(app: string, id: string) {
    this.store.build(app, id);
    const directory = path.join(this.store.root, "builds", id, "input");
    return fs.existsSync(path.join(directory, "cv-build.json")) ||
      fs.existsSync(path.join(directory, "cover-build.json"))
      ? collect(directory)
      : fileMap(directory);
  }
  documentStatus(app: string) {
    const status: Record<BuildKind, "missing" | "current" | "outdated"> = {
      cv: "missing",
      cover: "missing",
    };
    const history = this.store.builds(app);
    for (const kind of ["cv", "cover"] as const) {
      const build = history.find(
        (entry) => entry.kind === kind && entry.status === "success",
      );
      if (!build) continue;
      status[kind] = "outdated";
      try {
        const artifact = fs.lstatSync(this.artifact(app, String(build.id)));
        if (
          !artifact.isFile() ||
          artifact.isSymbolicLink() ||
          artifact.size <= 5
        )
          continue;
        const cvMarker = path.join(
          this.store.root,
          "builds",
          String(build.id),
          "input",
          "cv-build.json",
        );
        if (kind === "cv" && fs.existsSync(cvMarker)) {
          const marker = JSON.parse(fs.readFileSync(cvMarker, "utf8"));
          if (marker.fingerprint === this.store.cv.fingerprint(app))
            status.cv = "current";
          continue;
        }
        const coverMarker = path.join(
          this.store.root,
          "builds",
          String(build.id),
          "input",
          "cover-build.json",
        );
        if (kind === "cover" && fs.existsSync(coverMarker)) {
          const marker = JSON.parse(fs.readFileSync(coverMarker, "utf8"));
          if (marker.fingerprint === this.store.cover.fingerprint(app))
            status.cover = "current";
          continue;
        }
        if (kind === "cover" && this.store.cover.read(app).modId) continue;
        const current = fileMap(this.store.workspace(app));
        const snapshot = fileMap(
          path.join(this.store.root, "builds", String(build.id), "input"),
        );
        const coverSource =
          snapshot["anschreiben/Anschreiben.tex"]?.toString("utf8");
        const ownCover =
          coverSource !== undefined && decodeCover(coverSource) !== null;
        const relevant = (name: string) =>
          kind === "cv"
            ? name.startsWith("cv/") || name.startsWith("fonts/")
            : name !== "application.json" &&
              (!ownCover ||
                name.startsWith("anschreiben/") ||
                name.startsWith("fonts/"));
        const names = [
          ...new Set([...Object.keys(current), ...Object.keys(snapshot)]),
        ].filter(relevant);
        const profileMatches =
          kind !== "cv" ||
          JSON.parse(snapshot["application.json"]!.toString("utf8")).profile ===
            this.store.app(app).profile;
        if (
          profileMatches &&
          names.every(
            (name) =>
              current[name] &&
              snapshot[name] &&
              current[name]!.equals(snapshot[name]!),
          )
        )
          status[kind] = "current";
      } catch {
        /* A missing snapshot/source must never look current. */
      }
    }
    return status;
  }
  idle() {
    return this.tail;
  }
  artifact(app: string, id: string) {
    const b = this.store.build(app, id);
    check(b.status === "success", "Build ohne erfolgreiches PDF", 409);
    return path.join(this.store.root, "builds", id, "output", "document.pdf");
  }
  finalize(app: string, id: string) {
    this.artifact(app, id);
    this.store.db
      .prepare("UPDATE builds SET finalized=1 WHERE id=? AND app=?")
      .run(id, app);
    return this.store.build(app, id);
  }
}
