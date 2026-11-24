import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  APPLICATION_STATUSES,
  type Application,
  type ApplicationStatus,
  type NewApplication,
  type SearchResult,
  type TemplateSummary,
} from "../shared/api.ts";
import { DocumentLibrary } from "./documents.ts";
import { Preferences } from "./preferences.ts";
import { Templates } from "./templates.ts";
import { CvDocuments } from "./cv-documents.ts";
import { CoverDocuments } from "./cover-documents.ts";
import { ApplicantProfiles } from "./applicant-profiles.ts";
import {
  deletionSchema,
  cleanDeletions,
  removeApplication,
} from "./application-deletion.ts";
import {
  parseProfile,
  serializeProfile,
  selectEntries,
} from "./lua-profile.ts";
import {
  checkFileChanges,
  check,
  fileMap,
  isText,
  neutralCover,
  putMap,
  safeFile,
  FILE_LIMIT,
} from "./files.ts";

export type { Application } from "../shared/api.ts";
export class Store {
  db: DatabaseSync;
  documents: DocumentLibrary;
  preferences: Preferences;
  applicantProfiles: ApplicantProfiles;
  templateLibrary: Templates;
  cv: CvDocuments;
  cover: CoverDocuments;
  onWorkspaceCommit?: (id: string) => void;
  initializeWorkspace?: (id: string) => void;
  constructor(public root: string) {
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path.join(root, "bewerbung.sqlite"));
    this.db
      .exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS apps(id TEXT PRIMARY KEY,company TEXT NOT NULL,role TEXT NOT NULL,status TEXT NOT NULL,posting TEXT NOT NULL,notes TEXT NOT NULL,profile TEXT NOT NULL,template TEXT,revision INTEGER NOT NULL,created TEXT NOT NULL,updated TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS templates(id TEXT PRIMARY KEY,created TEXT NOT NULL,digest TEXT NOT NULL,bytes INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS builds(id TEXT PRIMARY KEY,app TEXT NOT NULL REFERENCES apps(id),kind TEXT NOT NULL,revision INTEGER NOT NULL,status TEXT NOT NULL,created TEXT NOT NULL,log TEXT NOT NULL DEFAULT '',finalized INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT,app TEXT NOT NULL REFERENCES apps(id),type TEXT NOT NULL,payload TEXT NOT NULL,created TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions(app TEXT PRIMARY KEY REFERENCES apps(id),provider TEXT NOT NULL,native TEXT,model TEXT);
    `);
    this.templateLibrary = new Templates(this.db, root);
    this.documents = new DocumentLibrary(this.db, root);
    this.preferences = new Preferences(this.db);
    this.applicantProfiles = new ApplicantProfiles(this);
    this.cv = new CvDocuments(this);
    this.cover = new CoverDocuments(this);
    this.db
      .prepare(
        "UPDATE builds SET status='failed',log=log || '\nServer während Build beendet.' WHERE status IN ('queued','running')",
      )
      .run();
    this.db.exec(
      "DELETE FROM build_documents WHERE build IN (SELECT id FROM builds WHERE status='failed')",
    );
    deletionSchema(this.db);
    cleanDeletions(this.db, root);
    for (const row of this.db
      .prepare("SELECT id,revision FROM apps WHERE status='Entwurf'")
      .all())
      this.update(String(row.id), {
        revision: row.revision,
        status: "In Arbeit",
      });
  }
  remove(id: string, revision: unknown) {
    return removeApplication(this.db, this.root, id, revision);
  }
  app(id: string): Application {
    const row = this.db.prepare("SELECT * FROM apps WHERE id=?").get(id);
    check(row, "Bewerbung nicht gefunden", 404);
    return row as Application;
  }
  workspace(id: string) {
    this.app(id);
    return path.join(this.root, "applications", id, "workspace");
  }
  list() {
    return this.db
      .prepare("SELECT * FROM apps ORDER BY updated DESC")
      .all() as Application[];
  }
  search(query: unknown, status?: unknown): SearchResult[] {
    check(
      typeof query === "string" && query.length <= 200,
      "Suchtext zu lang oder ungültig",
    );
    check(
      status === undefined ||
        status === "" ||
        APPLICATION_STATUSES.includes(status as ApplicationStatus),
      "Ungültiger Statusfilter",
    );
    const normalize = (value: string) =>
      value.normalize("NFC").toLocaleLowerCase("de-DE");
    const needle = normalize(query.trim().replace(/\s+/g, " "));
    const apps = this.list().filter((a) => !status || a.status === status);
    const byId = new Map(apps.map((a) => [a.id, a]));
    const found = new Map<
      string,
      { match: SearchResult["match"]; text: string }
    >();
    for (const a of apps) {
      for (const match of ["company", "role", "notes", "posting"] as const) {
        if (
          !needle ||
          normalize(a[match].replace(/\s+/g, " ")).includes(needle)
        ) {
          found.set(a.id, { match, text: a[match] });
          break;
        }
      }
    }
    if (needle && found.size < apps.length) {
      for (const row of this.db
        .prepare(
          "SELECT app,json_extract(payload,'$.text') AS text FROM events WHERE type IN ('user','assistant') ORDER BY id DESC",
        )
        .iterate()) {
        const id = String(row.app),
          text = String(row.text || "");
        if (
          byId.has(id) &&
          !found.has(id) &&
          normalize(text.replace(/\s+/g, " ")).includes(needle)
        )
          found.set(id, { match: "chat", text });
        if (found.size === apps.length) break;
      }
    }
    return apps
      .filter((a) => found.has(a.id))
      .slice(0, 50)
      .map((a) => {
        const hit = found.get(a.id)!,
          text = hit.text.replace(/\s+/g, " ").normalize("NFC");
        const start = Math.max(0, normalize(text).indexOf(needle) - 60);
        return {
          id: a.id,
          company: a.company,
          role: a.role,
          status: a.status,
          updated: a.updated,
          match: hit.match,
          preview:
            (start ? "…" : "") +
            text.slice(start, start + 180) +
            (text.length > start + 180 ? "…" : ""),
        };
      });
  }
  templates(): TemplateSummary[] {
    return this.templateLibrary.list();
  }
  import(input: unknown) {
    return this.templateLibrary.import(input);
  }
  private factsFiles(a: Application, files: Record<string, Buffer> = {}) {
    return {
      ...files,
      "application.json": Buffer.from(JSON.stringify(a, null, 2)),
    };
  }
  private validate(a: Application) {
    for (const key of [
      "company",
      "role",
      "posting",
      "notes",
      "profile",
    ] as const)
      check(
        typeof a[key] === "string" &&
          a[key].length <=
            (key === "posting" || key === "notes" ? 100000 : 200),
        "Ungültiges Feld: " + key,
      );
    check(APPLICATION_STATUSES.includes(a.status), "Ungültiger Status");
    check(/^[A-Za-z0-9_-]+$/.test(a.profile), "Ungültiger Profilname");
  }
  create(input: Partial<NewApplication>) {
    for (const key of [
      "company",
      "role",
      "posting",
      "notes",
      "profile",
    ] as const)
      check(
        input[key] === undefined || typeof input[key] === "string",
        "Ungültiges Feld: " + key,
      );
    for (const key of [
      "template",
      "source",
      "cvSource",
      "coverSource",
    ] as const)
      check(
        input[key] === undefined ||
          (typeof input[key] === "string" &&
            (input[key] === "" || /^[a-f0-9-]{36}$/.test(input[key]))),
        "Ungültige Quelle: " + key,
      );
    const id = randomUUID(),
      now = new Date().toISOString();
    let files: Record<string, Buffer> = {},
      template: string | null = null,
      profile = "default";
    let company = input.company || "Neue Bewerbung",
      role = input.role || "",
      posting = "",
      notes = "";
    let inheritedDocuments: string[] = [];
    const area = (from: Record<string, Buffer>, prefixes: string[]) => {
      files = Object.fromEntries(
        Object.entries(files).filter(
          ([name]) => !prefixes.some((prefix) => name.startsWith(prefix)),
        ),
      );
      for (const [name, bytes] of Object.entries(from))
        if (prefixes.some((prefix) => name.startsWith(prefix)))
          files[name] = bytes;
    };
    if (input.source) {
      const source = this.app(input.source);
      files = fileMap(this.workspace(source.id));
      template = source.template;
      profile = source.profile;
      company = input.company ?? source.company + " (Kopie)";
      role = input.role ?? source.role;
      posting = source.posting;
      notes = source.notes;
      inheritedDocuments = this.documents.ids(source.id);
    }
    if (input.template) {
      const masterInfo = this.templateLibrary.get(input.template);
      const master = this.templateLibrary.files(input.template);
      if (input.source) area(master, ["cv/", "fonts/"]);
      else
        files = Object.fromEntries(
          Object.entries(master).filter(
            ([name]) => !/^anschreiben\/[^/]+\.tex$/.test(name),
          ),
        );
      template = input.template;
      profile = masterInfo.defaultProfile || "default";
    }
    if (input.cvSource) {
      const source = this.app(input.cvSource);
      area(fileMap(this.workspace(source.id)), ["cv/", "fonts/"]);
      profile = source.profile;
      template = source.template;
    }
    if (input.coverSource) {
      area(fileMap(this.workspace(input.coverSource)), ["anschreiben/"]);
    } else if (!input.source || input.coverSource === "") {
      files = Object.fromEntries(
        Object.entries(files).filter(
          ([name]) => !/^anschreiben\/[^/]+\.tex$/.test(name),
        ),
      );
      if (this.preferences.settings().prepareCoverLetter)
        files["anschreiben/Anschreiben.tex"] = Buffer.from(neutralCover);
    }
    if (input.profile !== undefined) {
      check(
        typeof input.profile === "string" &&
          /^[A-Za-z0-9_-]+$/.test(input.profile) &&
          Object.hasOwn(files, "cv/profiles/" + input.profile + ".lua"),
        "CV-Profil nicht gefunden",
      );
      profile = input.profile;
    }
    const application: Application = {
      id,
      company,
      role,
      status: input.status === undefined ? "In Arbeit" : input.status,
      posting: input.posting ?? posting,
      notes: input.notes ?? notes,
      profile,
      template,
      revision: 1,
      created: now,
      updated: now,
    };
    this.validate(application);
    const documents = this.documents.validateSelection(
      input.documentIds === undefined ? inheritedDocuments : input.documentIds,
    );
    const workspace = path.join(this.root, "applications", id, "workspace");
    putMap(workspace, this.factsFiles(application, files));
    this.db.exec("BEGIN");
    try {
      this.db
        .prepare(
          "INSERT INTO apps(id,company,role,status,posting,notes,profile,template,revision,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          id,
          company,
          role,
          application.status,
          application.posting,
          application.notes,
          profile,
          template,
          1,
          now,
          now,
        );
      this.documents.assign(id, documents);
      this.applicantProfiles.capture(id, input.source);
      const cvSource =
        input.cvSource || (!input.template ? input.source : undefined);
      if (
        cvSource &&
        (input.profile === undefined ||
          input.profile === this.app(cvSource).profile)
      )
        this.cv.copy(cvSource, id);
      const coverSource =
        input.coverSource ||
        (input.source && input.coverSource !== "" ? input.source : undefined);
      if (coverSource) this.cover.copy(coverSource, id);
      this.initializeWorkspace?.(id);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      fs.rmSync(path.dirname(workspace), { recursive: true, force: true });
      throw error;
    }
    this.onWorkspaceCommit?.(id);
    return this.app(id);
  }
  update(id: string, input: Record<string, unknown>) {
    const a = this.app(id);
    check(
      input.revision === a.revision,
      "Inzwischen geändert. Neu laden.",
      409,
    );
    for (const key of [
      "company",
      "role",
      "posting",
      "notes",
      "profile",
    ] as const) {
      if (input[key] !== undefined) {
        check(typeof input[key] === "string", "Ungültiges Feld: " + key);
        a[key] = input[key];
      }
    }
    if (input.status !== undefined)
      a.status = input.status as ApplicationStatus;
    this.validate(a);
    const documents = this.documents.validateSelection(
      input.documentIds === undefined
        ? this.documents.ids(id)
        : input.documentIds,
    );
    const updated = new Date().toISOString();
    const files = this.factsFiles({ ...a, revision: a.revision + 1, updated });
    checkFileChanges(this.workspace(id), files);
    this.db.exec("BEGIN");
    try {
      this.db
        .prepare(
          "UPDATE apps SET company=?,role=?,status=?,posting=?,notes=?,profile=?,revision=revision+1,updated=? WHERE id=?",
        )
        .run(
          a.company,
          a.role,
          a.status,
          a.posting,
          a.notes,
          a.profile,
          updated,
          id,
        );
      this.documents.assign(id, documents);
      putMap(this.workspace(id), files);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    this.onWorkspaceCommit?.(id);
    return this.app(id);
  }
  bump(id: string, changes: Record<string, Buffer> = {}) {
    const a = this.app(id),
      updated = new Date().toISOString();
    const files = this.factsFiles(
      { ...a, revision: a.revision + 1, updated },
      changes,
    );
    checkFileChanges(this.workspace(id), files);
    this.db
      .prepare("UPDATE apps SET revision=revision+1,updated=? WHERE id=?")
      .run(updated, id);
    putMap(this.workspace(id), files);
    this.onWorkspaceCommit?.(id);
  }
  files(id: string) {
    return Object.entries(fileMap(this.workspace(id))).map(([name, b]) => ({
      name,
      size: b.length,
      text: isText(name),
    }));
  }
  read(id: string, name: string) {
    const file = safeFile(this.workspace(id), name);
    check(fs.existsSync(file), "Datei nicht gefunden", 404);
    return fs.readFileSync(file);
  }
  save(id: string, name: string, content: unknown, revision: unknown) {
    check(
      this.app(id).revision === revision,
      "Inzwischen geändert. Neu laden.",
      409,
    );
    check(
      isText(name) &&
        name !== "application.json" &&
        typeof content === "string" &&
        Buffer.byteLength(content) <= FILE_LIMIT &&
        !content.includes("\0"),
      "Ungültiger Text",
    );
    this.bump(id, { [name]: Buffer.from(content) });
    return this.app(id);
  }
  reuse(id: string, source: string, names: unknown, revision: unknown) {
    check(
      this.app(id).revision === revision,
      "Inzwischen geändert. Neu laden.",
      409,
    );
    check(
      Array.isArray(names) && names.length > 0 && names.length <= 160,
      "Dateiauswahl erwartet",
    );
    const map: Record<string, Buffer> = {};
    for (const name of names) {
      check(
        typeof name === "string" && name !== "application.json",
        "Unzulässige Auswahl",
      );
      map[name] = this.read(source, name);
    }
    this.bump(id, map);
    return this.app(id);
  }
  profile(id: string, name: unknown) {
    check(
      typeof name === "string" &&
        /^cv\/profiles\/[A-Za-z0-9_-]+\.lua$/.test(name),
      "Profil unter cv/profiles/ auswählen",
    );
    return {
      path: name,
      revision: this.app(id).revision,
      entries: parseProfile(this.read(id, name).toString("utf8")),
    };
  }
  reuseEntries(id: string, input: Record<string, unknown>) {
    check(
      typeof input.source === "string" && input.source !== id,
      "Andere Quellbewerbung auswählen",
    );
    const source = this.profile(input.source, input.sourceProfile);
    check(
      source.revision === input.sourceRevision,
      "Quellbewerbung inzwischen geändert. Auswahl neu laden.",
      409,
    );
    const destination = this.profile(id, input.destinationProfile);
    check(
      destination.revision === input.revision,
      "Inzwischen geändert. Neu laden.",
      409,
    );
    const result = selectEntries(
      source.entries,
      destination.entries,
      input.selection,
      input.mode,
    );
    return this.save(
      id,
      destination.path,
      serializeProfile(result),
      input.revision,
    );
  }
  event(app: string, type: string, payload: unknown) {
    const created = new Date().toISOString();
    const r = this.db
      .prepare("INSERT INTO events(app,type,payload,created) VALUES(?,?,?,?)")
      .run(app, type, JSON.stringify(payload), created);
    return { id: Number(r.lastInsertRowid), app, type, payload, created };
  }
  events(app: string, after = 0) {
    this.app(app);
    return this.db
      .prepare(
        "SELECT * FROM events WHERE app=? AND id>? ORDER BY id LIMIT 10000",
      )
      .all(app, after)
      .map((r) => ({
        id: Number(r.id),
        app: String(r.app),
        type: String(r.type),
        created: String(r.created),
        payload: JSON.parse(r.payload as string),
      }));
  }
  build(app: string, id: string) {
    this.app(app);
    const b = this.db
      .prepare("SELECT * FROM builds WHERE id=? AND app=?")
      .get(id, app);
    check(b, "Build nicht gefunden", 404);
    return b;
  }
  builds(app: string) {
    this.app(app);
    return this.db
      .prepare(
        "SELECT * FROM builds WHERE app=? ORDER BY created DESC,rowid DESC",
      )
      .all(app);
  }
  close() {
    this.db.close();
  }
}
