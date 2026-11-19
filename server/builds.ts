import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn, execFile } from "node:child_process";
import { check, fileMap, putMap } from "./files.ts";
import { Store } from "./store.ts";
export type BuildKind = "cv" | "cover";
export type Runner = (
  input: string,
  output: string,
  kind: BuildKind,
  profile: string,
  name: string,
) => Promise<string>;
export function dockerRunner(image: string): Runner {
  check(
    /^sha256:[a-f0-9]{64}$/.test(image),
    "Builder-Image muss per ID gepinnt sein",
    503,
  );
  return (input, output, kind, profile, name) =>
    new Promise((resolve, reject) => {
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
}
export class Builds {
  private tail: Promise<void> = Promise.resolve();
  private queued = new Map<string, string>();
  constructor(
    public store: Store,
    private runner: Runner,
    private notify: (app: string) => void = () => {},
  ) {}
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
    fs.mkdirSync(path.join(dir, "output"), { recursive: true, mode: 0o700 });
    putMap(path.join(dir, "input"), fileMap(this.store.workspace(app)));
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
      this.notify(app);
    });
    this.notify(app);
    return this.store.build(app, id);
  }
  documentStatus(app: string) {
    const status: Record<BuildKind, "missing" | "current" | "outdated"> = { cv: "missing", cover: "missing" };
    const history = this.store.builds(app);
    for (const kind of ["cv", "cover"] as const) {
      const build = history.find(entry => entry.kind === kind && entry.status === "success");
      if (!build) continue;
      status[kind] = "outdated";
      try {
        const current = fileMap(this.store.workspace(app));
        const snapshot = fileMap(path.join(this.store.root, "builds", String(build.id), "input"));
        const ownCover = snapshot["anschreiben/Anschreiben.tex"]?.toString("utf8").startsWith("% bewerbung-cover-v1 ");
        const relevant = (name: string) => kind === "cv" ? name.startsWith("cv/") || name.startsWith("fonts/") : name !== "application.json" && (!ownCover || name.startsWith("anschreiben/") || name.startsWith("fonts/"));
        const names = [...new Set([...Object.keys(current), ...Object.keys(snapshot)])].filter(relevant);
        const profileMatches = kind !== "cv" || JSON.parse(snapshot["application.json"]!.toString("utf8")).profile === this.store.app(app).profile;
        if (profileMatches && names.every(name => current[name] && snapshot[name] && current[name]!.equals(snapshot[name]!))) status[kind] = "current";
      } catch { /* A missing snapshot/source must never look current. */ }
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
