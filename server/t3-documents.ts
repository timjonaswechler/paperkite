import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { Store } from "./store.ts";
import { atomicFile, check } from "./files.ts";

// These are independent workspace copies, never links to the central originals.
export function prepareNativeDocuments(store: Store, id: string) {
  const selected = store.documents.selected(id);
  const directory = path.join(store.workspace(id), "bewerbungsunterlagen");
  if (!selected.length && !fs.existsSync(directory)) return;
  let current = store.root;
  for (const part of [
    "applications",
    id,
    "workspace",
    "bewerbungsunterlagen",
  ]) {
    current = path.join(current, part);
    const stat = fs.lstatSync(current, { throwIfNoEntry: false });
    check(
      !stat || (stat.isDirectory() && !stat.isSymbolicLink()),
      "Unterlagenordner wurde außerhalb der Verwaltung verändert; keine Dateien überschrieben.",
      409,
    );
  }
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  store.db.exec(
    "CREATE TABLE IF NOT EXISTS native_document_copies(app TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,document TEXT NOT NULL,filename TEXT NOT NULL,PRIMARY KEY(app,document))",
  );
  const documents = selected.map((document) => {
    check(/^[a-f0-9-]{36}$/.test(document.id), "Ungültige Dokument-ID");
    const extension =
      document.mime === "application/pdf"
        ? ".pdf"
        : document.mime === "image/jpeg"
          ? ".jpg"
          : ".png";
    const filename = document.id + extension,
      target = path.join(directory, filename);
    const previous = store.db
      .prepare(
        "SELECT filename FROM native_document_copies WHERE app=? AND document=?",
      )
      .get(id, document.id);
    let stat = fs.lstatSync(target, { throwIfNoEntry: false });
    check(
      !stat || (stat.isFile() && !stat.isSymbolicLink()),
      "Arbeitskopie ist keine reguläre Datei; zentrale Originale bleiben unverändert.",
      409,
    );
    if (!previous) {
      if (!stat) {
        fs.writeFileSync(target, store.documents.bytes(document.id), {
          flag: "wx",
          mode: 0o600,
        });
        stat = fs.statSync(target);
      }
      store.db
        .prepare(
          "INSERT INTO native_document_copies(app,document,filename) VALUES(?,?,?)",
        )
        .run(id, document.id, filename);
    }
    const workingCopyChanged = Boolean(
      stat &&
      (stat.size !== document.bytes ||
        createHash("sha256").update(fs.readFileSync(target)).digest("hex") !==
          document.sha256),
    );
    return {
      id: document.id,
      name: document.name,
      label: document.label,
      mime: document.mime,
      path: "bewerbungsunterlagen/" + filename,
      originalSha256: document.sha256,
      workingCopyChanged,
      workingCopyMissing: !stat,
    };
  });
  atomicFile(
    path.join(directory, "auswahl.json"),
    JSON.stringify({ generatedBy: "bewerbung", documents }, null, 2),
  );
}
