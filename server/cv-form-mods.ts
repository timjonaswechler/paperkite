import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  parseForm,
  validateValues,
  type FormMod,
  type FormSpec,
  type Values,
} from "../shared/cv-form.ts";
import { safeRelative } from "./cv-mod-prototype/archive.ts";
import { formBuildFiles } from "./cv-form-model.ts";
import { check, HttpError } from "./files.ts";
import {
  applicantReservedFiles,
  bindApplicantForm,
  type ApplicantRenderContext,
} from "./applicant-rendering.ts";
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
const retiredExamples = [
  "form:efc734bb7b61b4871f0f4a8e0b082f9a18a7dd75f5be3fec1b734829330e0a1a",
  "form:297d74eed2a4fd6e0a9d2a8d5dfc2e5f088db3f33c6024b43673491b1ee55a86",
];
export class CvFormMods {
  resolveImported?: (id: string) => FormMod;
  constructor(private db: DatabaseSync) {
    db.exec(
      "CREATE TABLE IF NOT EXISTS cv_form_mods(id TEXT PRIMARY KEY,payload TEXT NOT NULL)",
    );
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
        !applicantReservedFiles.includes(n.split("/").at(-1)!),
        "Reservierter Bewerberprofil-Buildpfad",
      );
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
  removeRetiredExamples() {
    for (const id of retiredExamples)
      this.db
        .prepare(
          "DELETE FROM cv_form_mods WHERE id=? AND NOT EXISTS (SELECT 1 FROM cv_documents WHERE mod_id=?)",
        )
        .run(id, id);
  }
  pin(id: string) {
    check(
      !retiredExamples.includes(id),
      "Diese Beispielvorlage wurde entfernt",
    );
    this.mod(id);
  }
  mod(id: string): FormMod {
    const row = this.db
        .prepare("SELECT payload FROM cv_form_mods WHERE id=?")
        .get(id),
      mod = row
        ? (JSON.parse(String(row.payload)) as FormMod)
        : this.resolveImported?.(id);
    check(mod, "Formular-Modversion nicht gefunden", 404);
    return mod;
  }
  list() {
    return this.db
      .prepare("SELECT payload FROM cv_form_mods ORDER BY rowid")
      .all()
      .map((r) => JSON.parse(String(r.payload)) as FormMod)
      .filter((mod) => !retiredExamples.includes(mod.id))
      .map(({ files: _files, ...mod }) => mod);
  }
  snapshot(id: string, values: Values, applicant?: ApplicantRenderContext) {
    const mod = this.mod(id);
    values = bindApplicantForm(
      values,
      mod.spec.applicant,
      applicant?.profile || null,
    );
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
      applicant,
    );
  }
}
