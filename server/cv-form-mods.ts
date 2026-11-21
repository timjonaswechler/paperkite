import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  parseForm,
  validateValues,
  type FormMod,
  type FormSpec,
  type Values,
} from "../shared/cv-form.ts";
import { collect } from "./cv-mod-prototype/imports.ts";
import { safeRelative } from "./cv-mod-prototype/archive.ts";
import { formBuildFiles } from "./cv-form-model.ts";
import { check, HttpError } from "./files.ts";
export function validateFormValues(
  spec: FormSpec,
  values: unknown,
  complete = false,
): asserts values is Values {
  try {
    validateValues(spec, values, complete);
  } catch (error) {
    throw new HttpError(
      400,
      error instanceof Error ? error.message : String(error),
    );
  }
}
export const isFormMod = (id: string | null) =>
  Boolean(id?.startsWith("form:"));
export class CvFormMods {
  resolveImported?: (id: string) => FormMod;
  private examples = new Map<string, FormMod>();
  constructor(private db: DatabaseSync) {
    db.exec(
      "CREATE TABLE IF NOT EXISTS cv_form_mods(id TEXT PRIMARY KEY,payload TEXT NOT NULL)",
    );
    const directory = fileURLToPath(
      new URL("../examples/cv-form-mods/", import.meta.url),
    );
    for (const entry of fs
      .readdirSync(directory, { withFileTypes: true })
      .filter((e) => e.isDirectory())) {
      const files = collect(path.join(directory, entry.name)),
        spec = JSON.parse(files["mod.json"]!.toString());
      delete files["mod.json"];
      files["format.lua"] ||= fs.readFileSync(
        path.join(directory, "format.lua"),
      );
      const mod = this.package(
        "Beispiel · " +
          (entry.name === "cv"
            ? "CV"
            : entry.name[0]!.toUpperCase() + entry.name.slice(1)),
        spec,
        files,
      );
      this.examples.set(mod.id, mod);
    }
  }
  private package(
    name: string,
    input: unknown,
    files: Record<string, Buffer>,
  ): FormMod {
    const spec = parseForm(input);
    check(
      typeof name === "string" && name.length > 0 && name.length <= 200,
      "Modname erwartet",
    );
    let total = 0;
    check(Object.keys(files).length <= 200, "Zu viele Dateien");
    for (const [n, b] of Object.entries(files)) {
      safeRelative(n);
      check(
        ![
          "mod.json",
          "cv-data.lua",
          "form-mod.json",
          "application.json",
          "cv-build.json",
        ].includes(n),
        "Reservierter Buildpfad",
      );
      check(b.length <= 4 * 1024 * 1024, "Datei zu groß");
      total += b.length;
    }
    check(
      total <= 32 * 1024 * 1024 && files[spec.entrypoint],
      "Vorlagenpaket ungültig",
    );
    const payload = {
      name,
      spec,
      files: Object.fromEntries(
        Object.entries(files)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([n, b]) => [n, b.toString("base64")]),
      ),
    };
    return {
      id:
        "form:" +
        createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
      ...payload,
    };
  }
  install(name: string, input: unknown, files: Record<string, Buffer>) {
    const mod = this.package(name, input, files);
    this.persist(mod);
    return mod;
  }
  private persist(mod: FormMod) {
    this.db
      .prepare("INSERT OR IGNORE INTO cv_form_mods VALUES(?,?)")
      .run(mod.id, JSON.stringify(mod));
  }
  pin(id: string) {
    const mod = this.mod(id);
    if (
      this.examples.has(id) ||
      this.db.prepare("SELECT id FROM cv_form_mods WHERE id=?").get(id)
    )
      this.persist(mod);
  }
  mod(id: string): FormMod {
    const row = this.db
        .prepare("SELECT payload FROM cv_form_mods WHERE id=?")
        .get(id),
      mod = row
        ? (JSON.parse(String(row.payload)) as FormMod)
        : this.examples.get(id) || this.resolveImported?.(id);
    check(mod, "Formular-Modversion nicht gefunden", 404);
    return mod;
  }
  list() {
    const local = [
      ...new Map([
        ...this.examples,
        ...this.db
          .prepare("SELECT payload FROM cv_form_mods ORDER BY rowid")
          .all()
          .map((r) => {
            const m = JSON.parse(String(r.payload)) as FormMod;
            return [m.id, m] as const;
          }),
      ]).values(),
    ].map(({ files: _files, ...m }) => m);
    return local;
  }
  snapshot(id: string, values: Values) {
    const mod = this.mod(id);
    validateFormValues(mod.spec, values, true);
    return formBuildFiles(
      mod.spec,
      Object.fromEntries(
        Object.entries(mod.files).map(([n, b]) => [
          n,
          Buffer.from(b, "base64"),
        ]),
      ),
      values,
    );
  }
}
