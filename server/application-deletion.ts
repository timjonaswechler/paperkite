import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { check } from "./files.ts";

const uuid = /^[a-f0-9-]{36}$/;
const folders = new Set(["applications", "sessions", "codex", "builds", "pdf-jobs", "delivery-jobs"]);
export function deletionSchema(db: DatabaseSync) {
  db.exec("CREATE TABLE IF NOT EXISTS pending_deletions(app TEXT PRIMARY KEY,paths TEXT NOT NULL)");
}
// Commit the logical deletion first. A durable cleanup record survives process/file-system failures.
// Never touch the central documents directory, other applications, or referenced auth targets.
export function cleanDeletions(db: DatabaseSync, root: string) {
  for (const row of db.prepare("SELECT * FROM pending_deletions").all()) {
    try {
      const app = String(row.app);
      check(uuid.test(app) && !db.prepare("SELECT id FROM apps WHERE id=?").get(app), "Löschauftrag betrifft vorhandene Bewerbung");
      const paths = JSON.parse(String(row.paths));
      check(Array.isArray(paths) && paths.length <= 10000, "Ungültiger Löschauftrag");
      for (const value of paths) {
        check(typeof value === "string", "Ungültiger Löschpfad");
        const parts = value.split("/"), [folder, id] = parts;
        check(parts.length === 2 && folders.has(folder) && uuid.test(id || ""), "Ungültiger Löschpfad");
        if (["applications", "sessions", "codex"].includes(folder)) check(id === app, "Fremde Bewerbung im Löschauftrag");
        if (folder === "builds") check(!db.prepare("SELECT id FROM builds WHERE id=?").get(id), "Build wird noch verwendet");
        if (folder === "delivery-jobs") check(!db.prepare("SELECT id FROM delivery_jobs WHERE id=?").get(id), "Versandpaket wird noch verwendet");
        const parent = path.join(root, folder);
        check(!fs.lstatSync(parent, { throwIfNoEntry: false })?.isSymbolicLink(), "Löschordner ist ein Symlink");
        fs.rmSync(path.join(parent, id), { recursive: true, force: true });
      }
      db.prepare("DELETE FROM pending_deletions WHERE app=?").run(app);
    } catch (error) {
      // Retained for retry on next startup; don't conceal a whole-app deletion behind a cleanup error.
      console.warn("Bereinigung einer gelöschten Bewerbung ausstehend:", String(row.app), String(error));
    }
  }
}
export function removeApplication(db: DatabaseSync, root: string, id: string, revision: unknown) {
  const app = db.prepare("SELECT revision FROM apps WHERE id=?").get(id);
  check(app, "Bewerbung nicht gefunden", 404);
  check(app.revision === revision, "Inzwischen geändert. Neu laden.", 409);
  check(uuid.test(id), "Ungültige Bewerbungs-ID");
  check(!db.prepare("SELECT id FROM builds WHERE app=? AND status IN ('queued','running')").get(id), "PDF-Build läuft noch", 409);
  const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => String(row.name)));
  if (tables.has("pdf_jobs")) check(!db.prepare("SELECT id FROM pdf_jobs WHERE app=? AND status IN ('queued','running')").get(id), "PDF-Aufbereitung läuft noch", 409);
  if (tables.has("delivery_jobs")) check(!db.prepare("SELECT id FROM delivery_jobs WHERE app=? AND status IN ('queued','running')").get(id), "Versandpaket wird noch erstellt", 409);
  const deliveries = tables.has("delivery_jobs") ? db.prepare("SELECT id FROM delivery_jobs WHERE app=?").all(id).map(row => String(row.id)) : [];
  const builds = db.prepare("SELECT id FROM builds WHERE app=?").all(id).map((row) => String(row.id));
  const jobs = tables.has("pdf_jobs") ? db.prepare("SELECT id FROM pdf_jobs WHERE app=?").all(id).map((row) => String(row.id)) : [];
  check([...builds, ...jobs, ...deliveries].every((value) => uuid.test(value)), "Ungültiger Dokumentstand");
  const paths = [`applications/${id}`, `sessions/${id}`, `codex/${id}`, ...builds.map((value) => `builds/${value}`), ...jobs.map((value) => `pdf-jobs/${value}`), ...deliveries.map(value => `delivery-jobs/${value}`)];
  db.exec("BEGIN");
  try {
    db.prepare("INSERT INTO pending_deletions VALUES(?,?)").run(id, JSON.stringify(paths));
    db.prepare("DELETE FROM build_documents WHERE build IN (SELECT id FROM builds WHERE app=?)").run(id);
    for (const table of ["delivery_plans", "delivery_jobs", "pdf_plans", "pdf_jobs", "application_documents", "composer_drafts", "open_applications", "harness_choice", "codex_sessions", "sessions", "events", "builds"])
      if (tables.has(table)) db.prepare(`DELETE FROM ${table} WHERE app=?`).run(id);
    db.prepare("DELETE FROM apps WHERE id=?").run(id);
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  cleanDeletions(db, root);
  return { ok: true };
}
