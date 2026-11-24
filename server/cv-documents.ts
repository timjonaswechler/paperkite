import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { Store } from "./store.ts";
import { check, fileMap, putMap, safeFile } from "./files.ts";
import { parseLiteralLua, type Literal } from "./lua-profile.ts";
import {
  luaData,
  type CvData,
  type CvBlock,
} from "./cv-mod-prototype/model.ts";

import type { CvState, ApplicantBindings } from "../shared/api.ts";
export type { CvState } from "../shared/api.ts";
import { CvFormMods, isFormMod, validateFormValues } from "./cv-form-mods.ts";
import { pdfValues, type Values } from "../shared/cv-form.ts";
import { applicantVariables } from "../shared/applicant-profile.ts";
import {
  applicantBuildFiles,
  bindApplicantCv,
  bindApplicantForm,
  assertApplicantFieldsUnchanged,
  preserveApplicantSourceFields,
} from "./applicant-rendering.ts";
export type ReviewedCvMod = {
  id: string;
  name: string;
  digest: string;
  files: Record<string, Buffer>;
  fields: { key: string; label: string; type: "text"; required: boolean }[];
  applicant?: ApplicantBindings;
};
type RecordValue = { [key: string]: Literal };
const hash = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
const text = (value: unknown) => (typeof value === "string" ? value : "");
const object = (value: Literal): RecordValue => {
  if (Array.isArray(value) && value.length === 0) return {};
  check(
    value && typeof value === "object" && !Array.isArray(value),
    "CV-Quelldaten müssen eine literale Tabelle sein",
  );
  return value as RecordValue;
};
const array = (value: Literal | undefined): RecordValue[] =>
  Array.isArray(value) ? value.map(object) : [];
const kinds = ["education", "experience", "engagement", "skills"];
const labels: Record<string, string> = {
  education: "Bildung",
  experience: "Berufliche Erfahrungen",
  engagement: "Engagement und Gremienarbeit",
  skills: "Kenntnisse und Fähigkeiten",
};
const personMap: Record<string, string> = {
  firstName: "first_name",
  lastName: "last_name",
  postalCode: "postalcode",
};
const aliases: Record<string, string> = {
  date: "period",
  org: "organization",
  degree: "title",
};
function strings(value: RecordValue, map: Record<string, string> = {}) {
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, v]) => typeof v === "string")
      .map(([k, v]) => [map[k] || k, String(v)]),
  );
}
function content(entry: RecordValue): CvBlock[] {
  const stored = entry.content;
  if (Array.isArray(stored)) {
    // An empty Lua table is ambiguous: the literal reader returns {}, not [].
    const blocks = stored.map((value) => {
      const block = object(value);
      return block.type === "bulletList" &&
        block.items &&
        !Array.isArray(block.items) &&
        typeof block.items === "object" &&
        Object.keys(block.items).length === 0
        ? { ...block, items: [] }
        : block;
    }) as unknown as CvBlock[];
    check(
      blocks.every(
        (b) =>
          b &&
          (b.type === "paragraph"
            ? typeof b.text === "string"
            : b.type === "bulletList" &&
              Array.isArray(b.items) &&
              b.items.every((i) => i && typeof i.text === "string")),
      ),
      "Ungültige Inhaltsblöcke in der CV-Quelle",
      409,
    );
    const list = Array.isArray(entry.bullets)
      ? entry.bullets
      : Array.isArray(entry.items)
        ? entry.items
        : undefined;
    const projected = blocks.flatMap((b) =>
      b.type === "bulletList" ? b.items.map((i) => i.text) : [],
    );
    check(
      !list || JSON.stringify(list) === JSON.stringify(projected),
      "Inhaltsblöcke und alte Stichpunktliste widersprechen sich. CV-Quelle prüfen.",
      409,
    );
    return blocks;
  }
  check(
    !Array.isArray(entry.bullets) ||
      entry.bullets.every((v) => typeof v === "string"),
    "Stichpunkte in der CV-Quelle müssen Texte sein",
    409,
  );
  check(
    !Array.isArray(entry.items) ||
      entry.items.every((v) => typeof v === "string"),
    "Kenntnisse in der CV-Quelle müssen Texte sein",
    409,
  );
  const blocks: CvBlock[] = [];
  if (typeof entry.text === "string" && entry.text)
    blocks.push({ id: "text", type: "paragraph", text: entry.text });
  if (Array.isArray(entry.bullets) && entry.bullets.length)
    blocks.push({
      id: "bullets",
      type: "bulletList",
      items: entry.bullets.map((b, i) => ({
        id: "bullet-" + i,
        text: text(b),
      })),
    });
  if (Array.isArray(entry.items) && entry.items.length)
    blocks.push({
      id: "items",
      type: "bulletList",
      items: entry.items.map((b, i) => ({ id: "item-" + i, text: text(b) })),
    });
  return blocks;
}
export function validateCv(value: unknown): asserts value is CvData {
  check(
    value && typeof value === "object" && !Array.isArray(value),
    "CV-Daten erwartet",
  );
  const d = value as CvData;
  check(
    d.schemaVersion === 1 &&
      d.person &&
      typeof d.person === "object" &&
      !Array.isArray(d.person) &&
      Array.isArray(d.sections) &&
      d.sections.length <= 40,
    "Ungültige CV-Struktur",
  );
  const ids = new Set<string>();
  let nodes = 0,
    bytes = 0;
  function id(s: unknown) {
    check(
      typeof s === "string" && s.length > 0 && s.length <= 160 && !ids.has(s),
      "CV-IDs müssen eindeutig sein",
    );
    ids.add(s);
    check(++nodes <= 5000, "Zu viele CV-Einträge");
  }
  function fields(r: unknown) {
    check(
      r && typeof r === "object" && !Array.isArray(r),
      "CV-Felder erwartet",
    );
    for (const [k, v] of Object.entries(r)) {
      check(
        k.length > 0 &&
          k.length <= 100 &&
          !["__proto__", "constructor", "prototype"].includes(k) &&
          typeof v === "string" &&
          v.length <= 40000 &&
          !v.includes("\0"),
        "Ungültiges CV-Textfeld",
      );
      bytes += Buffer.byteLength(v);
    }
  }
  fields(d.person);
  for (const section of d.sections) {
    id(section.id);
    check(
      typeof section.kind === "string" &&
        section.kind.length <= 80 &&
        typeof section.label === "string" &&
        section.label.length <= 200 &&
        Array.isArray(section.entries),
      "Ungültiger CV-Abschnitt",
    );
    for (const entry of section.entries) {
      id(entry.id);
      check(
        entry.included === undefined || typeof entry.included === "boolean",
        "Ungültige PDF-Auswahl",
      );
      fields(entry.fields);
      check(Array.isArray(entry.content), "CV-Inhaltsblöcke erwartet");
      for (const block of entry.content) {
        id(block.id);
        if (block.type === "paragraph") fields({ text: block.text });
        else {
          check(
            block.type === "bulletList" && Array.isArray(block.items),
            "Unbekannter CV-Inhaltsblock",
          );
          for (const item of block.items) {
            id(item.id);
            fields({ text: item.text });
          }
        }
      }
    }
  }
  check(bytes <= 2 * 1024 * 1024, "CV-Inhalte größer als 2 MiB");
}
export class CvDocuments {
  readonly forms: CvFormMods;
  resolveMod?: (id: string) => ReviewedCvMod;
  constructor(private store: Store) {
    this.forms = new CvFormMods(store.db);
    store.db.exec(
      "CREATE TABLE IF NOT EXISTS cv_form_values(app TEXT PRIMARY KEY REFERENCES apps(id) ON DELETE CASCADE,data TEXT NOT NULL)",
    );
    store.db.exec(
      "CREATE TABLE IF NOT EXISTS cv_documents(app TEXT PRIMARY KEY REFERENCES apps(id) ON DELETE CASCADE,data TEXT NOT NULL,source_fingerprint TEXT NOT NULL,mod_id TEXT)",
    );
    this.forms.removeRetiredExamples();
  }
  private load(id: string) {
    const app = this.store.app(id),
      dir = this.store.workspace(id),
      profilePath = `cv/profiles/${app.profile}.lua`;
    const paths = [
      profilePath,
      "cv/profile/personal.lua",
      "cv/profile/education.lua",
    ];
    const raw = Object.fromEntries(
      paths
        .filter((p) => fs.existsSync(path.join(dir, p)))
        .map((p) => [p, this.store.read(id, p)]),
    );
    const fingerprint = hash(
      JSON.stringify(Object.entries(raw).map(([p, b]) => [p, hash(b)])),
    );
    const row = this.store.db
      .prepare("SELECT * FROM cv_documents WHERE app=?")
      .get(id);
    const saved =
      row && row.source_fingerprint === fingerprint
        ? (JSON.parse(String(row.data)) as CvData)
        : undefined;
    const profile = raw[profilePath]
      ? object(parseLiteralLua(raw[profilePath]!.toString("utf8")))
      : {};
    const personal = raw[paths[1]!]
      ? object(parseLiteralLua(raw[paths[1]!]!.toString("utf8")))
      : profile.personal
        ? object(profile.personal)
        : {};
    const education = raw[paths[2]!]
      ? object(parseLiteralLua(raw[paths[2]!]!.toString("utf8")))
      : {};
    const sourceEntries = new Map<string, RecordValue>(),
      educationKeys = new Map<string, string>();
    const order = Array.isArray(personal.sections)
      ? personal.sections.filter((x): x is string => typeof x === "string")
      : kinds;
    const present = [
      ...new Set([
        ...order,
        ...kinds.filter((k) => Array.isArray(profile[k]) && profile[k]!.length),
      ]),
    ];
    const formatterSource = raw["cv/lua/formatter.lua"]?.toString("utf8") || "";
    const layoutLabels: Record<string, string> = {};
    for (const kind of ["experience", "engagement"]) {
      const found = formatterSource.match(
        new RegExp(
          String.raw`section\s*==\s*["']${kind}["'][\s\S]{0,140}?print_experience\(["']([^"']+)`,
        ),
      );
      if (found) layoutLabels[kind] = found[1]!;
    }
    for (const kind of ["education", "skills"]) {
      const found = formatterSource.match(
        new RegExp(
          String.raw`function print_${kind}[\s\S]{0,160}?Abschnitt\}\{([^}]+)`,
        ),
      );
      if (found) layoutLabels[kind] = found[1]!;
    }
    const sectionLabels = strings(object(personal.section_labels || {}));
    const sections: CvData["sections"] = [];
    for (const kind of present) {
      const isEducation =
        kind === "education" && Object.keys(education).length > 0;
      const selected = isEducation
        ? Array.isArray(personal.education)
          ? personal.education.filter((x): x is string => typeof x === "string")
          : Object.keys(education)
        : [];
      const entries = isEducation
        ? selected.map((key) => object(education[key]!))
        : array(profile[kind]);
      if (!entries.length && !saved?.sections.some((s) => s.kind === kind))
        continue;
      const savedSection = saved?.sections.find((s) => s.kind === kind);
      sections.push({
        id: savedSection?.id || "section-" + kind,
        kind,
        label:
          savedSection?.label ||
          sectionLabels[kind] ||
          layoutLabels[kind] ||
          labels[kind] ||
          kind,
        entries: entries.map((entry, index) => {
          const eid =
            savedSection?.entries[index]?.id ||
            "entry-" +
              hash(
                kind + ":" + (isEducation ? selected[index] : String(index)),
              ).slice(0, 20);
          sourceEntries.set(eid, entry);
          if (isEducation) educationKeys.set(eid, selected[index]!);
          return {
            id: eid,
            included: entry.cv_included !== false,
            fields: Object.fromEntries(
              Object.entries(strings(entry, aliases)).filter(
                ([key]) => key !== "text",
              ),
            ),
            content: content(entry).map((b, bi) =>
              b.type === "paragraph"
                ? { ...b, id: eid + "-block-" + bi }
                : {
                    ...b,
                    id: eid + "-block-" + bi,
                    items: b.items.map((item, ii) => ({
                      ...item,
                      id: eid + "-block-" + bi + "-item-" + ii,
                    })),
                  },
            ),
          };
        }),
      });
    }
    const personAliases = Object.fromEntries(
      Object.entries(personMap).map(([a, b]) => [b, a]),
    );
    const person = strings(personal, { ...personAliases, name: "displayName" });
    if (!Object.keys(person).length)
      Object.assign(person, {
        displayName: this.store.applicantProfiles.snapshot(id)
          ? applicantVariables(this.store.applicantProfiles.snapshot(id)!).name
          : "",
        email: "",
        phone: "",
        city: "",
      });
    if (!person.displayName)
      person.displayName = [person.firstName, person.lastName]
        .filter(Boolean)
        .join(" ");
    const data = saved || { schemaVersion: 1 as const, person, sections };
    const main = fs.existsSync(path.join(dir, "cv/Lebenslauf.tex"))
      ? this.store.read(id, "cv/Lebenslauf.tex").toString("utf8")
      : "";
    const compatible =
      main.includes("lua/loader") &&
      fs.existsSync(path.join(dir, "cv/preamble/commands.tex"));
    return {
      app,
      dir,
      profilePath,
      raw,
      personal,
      education,
      profile,
      fingerprint,
      data,
      sourceEntries,
      educationKeys,
      modId: row?.mod_id ? String(row.mod_id) : null,
      compatible,
      main,
    };
  }
  private formValues(id: string): Values {
    const row = this.store.db
      .prepare("SELECT data FROM cv_form_values WHERE app=?")
      .get(id);
    return row ? JSON.parse(String(row.data)) : {};
  }
  read(id: string): CvState {
    const s = this.load(id);
    validateCv(s.data);
    let mod: CvState["mod"];
    let modWarning: string | undefined;
    let form: CvState["form"];
    let applicantBindings: ApplicantBindings | undefined;
    const profile = this.store.applicantProfiles.snapshot(id);
    if (s.modId) {
      try {
        if (isFormMod(s.modId)) {
          const value = this.forms.mod(s.modId);
          applicantBindings = value.spec.applicant;
          const values = bindApplicantForm(
            this.formValues(id),
            applicantBindings,
            profile,
          );
          validateFormValues(value.spec, values);
          mod = { id: value.id, name: value.name, fields: [] };
          form = { spec: value.spec, values };
        } else {
          check(this.resolveMod, "Vorlagen-Mods nicht verfügbar", 503);
          const value = this.resolveMod(s.modId);
          applicantBindings = value.applicant;
          mod = { id: value.id, name: value.name, fields: value.fields };
        }
      } catch (e) {
        mod = { id: s.modId, name: "Vorlage nicht verfügbar", fields: [] };
        modWarning = e instanceof Error ? e.message : String(e);
      }
    }
    return {
      data: bindApplicantCv(
        s.data,
        isFormMod(s.modId) ? undefined : applicantBindings,
        profile,
      ),
      revision: s.app.revision,
      fingerprint: s.fingerprint,
      modId: s.modId,
      paragraphsSupported: s.compatible || Boolean(s.modId) || !s.main.trim(),
      ...(mod ? { mod } : {}),
      ...(form ? { form } : {}),
      ...(modWarning ? { modWarning } : {}),
      ...(applicantBindings ? { applicantBindings } : {}),
    };
  }
  private commit(
    id: string,
    changes: Record<string, Buffer>,
    record: () => void,
  ) {
    const workspace = this.store.workspace(id);
    const original = Object.fromEntries(
      [...new Set([...Object.keys(changes), "application.json"])].map(
        (name) => [
          name,
          fs.existsSync(safeFile(workspace, name))
            ? this.store.read(id, name)
            : null,
        ],
      ),
    );
    this.store.db.exec("BEGIN IMMEDIATE");
    try {
      this.store.bump(id, changes);
      record();
      this.store.db.exec("COMMIT");
    } catch (error) {
      this.store.db.exec("ROLLBACK");
      for (const [name, bytes] of Object.entries(original)) {
        if (bytes) putMap(workspace, { [name]: bytes });
        else fs.rmSync(safeFile(workspace, name), { force: true });
      }
      this.store.onWorkspaceCommit?.(id);
      throw error;
    }
  }
  save(
    id: string,
    input: {
      revision: unknown;
      fingerprint: unknown;
      data?: unknown;
      formValues?: unknown;
    },
  ) {
    const s = this.load(id);
    check(
      s.app.revision === input.revision && s.fingerprint === input.fingerprint,
      "CV oder Quellen inzwischen geändert. Neu laden.",
      409,
    );
    if (s.modId && isFormMod(s.modId)) {
      const mod = this.forms.mod(s.modId);
      validateFormValues(mod.spec, input.formValues);
      const profile = this.store.applicantProfiles.snapshot(id);
      const effective = bindApplicantForm(
        input.formValues,
        mod.spec.applicant,
        profile,
      );
      if (profile)
        assertApplicantFieldsUnchanged(
          input.formValues,
          effective,
          mod.spec.applicant,
        );
      const values = preserveApplicantSourceFields(
        input.formValues,
        this.formValues(id),
        mod.spec.applicant,
      );
      this.commit(id, {}, () =>
        this.store.db
          .prepare(
            "INSERT INTO cv_form_values VALUES(?,?) ON CONFLICT(app) DO UPDATE SET data=excluded.data",
          )
          .run(id, JSON.stringify(values)),
      );
      return this.read(id);
    }
    validateCv(input.data);
    const bindings = s.modId ? this.resolveMod?.(s.modId).applicant : undefined;
    const profileSnapshot = this.store.applicantProfiles.snapshot(id);
    const effective = bindApplicantCv(input.data, bindings, profileSnapshot);
    if (profileSnapshot)
      assertApplicantFieldsUnchanged(
        input.data.person,
        effective.person,
        bindings,
        "person.",
      );
    const data = {
      ...input.data,
      person: preserveApplicantSourceFields(
        input.data.person,
        s.data.person,
        bindings,
        "person.",
      ),
    };
    if (!s.compatible && !s.modId && s.main.trim())
      check(
        !data.sections.some((section) =>
          section.entries.some((e) =>
            e.content.some((b) => b.type === "paragraph"),
          ),
        ),
        "Diese individuelle Vorlage benötigt für Fließtext zuerst eine Mod-Anbindung.",
        409,
      );
    const profile = { ...s.profile },
      personal = { ...s.personal },
      education = { ...s.education };
    for (const [k, v] of Object.entries(data.person))
      personal[personMap[k] || k] = v;
    if (
      typeof s.personal.name === "string" ||
      !s.raw["cv/profile/personal.lua"]
    )
      personal.name = data.person.displayName || "";
    personal.sections = data.sections.map((section) => section.kind);
    personal.section_labels = Object.fromEntries(
      data.sections.map((section) => [section.kind, section.label]),
    );
    for (const kind of new Set([
      ...kinds,
      ...data.sections.map((x) => x.kind),
    ])) {
      const section = data.sections.find((x) => x.kind === kind),
        entries = section?.entries || [];
      const result = entries.map((entry) => {
        const old = s.sourceEntries.get(entry.id) || {},
          next: RecordValue = { ...old };
        for (const [k, v] of Object.entries(entry.fields))
          next[
            k === "period"
              ? "date"
              : k === "organization"
                ? "org"
                : k === "title" && kind === "education"
                  ? "degree"
                  : k
          ] = v;
        next.cv_included = entry.included !== false;
        const bullets = entry.content.flatMap((b) =>
          b.type === "bulletList" ? b.items.map((x) => x.text) : [],
        );
        if (entry.content.length <= 1) delete next.content;
        else next.content = entry.content as unknown as Literal;
        next[kind === "skills" ? "items" : "bullets"] = bullets;
        const paragraphs = entry.content.filter(
          (b): b is Extract<CvBlock, { type: "paragraph" }> =>
            b.type === "paragraph",
        );
        if (paragraphs.length)
          next.text = paragraphs.map((x) => x.text).join("\n\n");
        else if ("text" in next) delete next.text;
        return next;
      });
      if (kind === "education" && Object.keys(s.education).length) {
        const keys = entries.map((entry, index) => {
          const key =
            s.educationKeys.get(entry.id) ||
            "cv_" + hash(entry.id).slice(0, 20);
          education[key] = result[index]!;
          return key;
        });
        personal.education = keys;
      } else profile[kind] = result;
    }
    if (!s.raw["cv/profile/personal.lua"]) profile.personal = personal;
    const changes: Record<string, Buffer> = {
      [s.profilePath]: Buffer.from("return " + luaData(profile) + "\n"),
    };
    if (s.raw["cv/profile/personal.lua"])
      changes["cv/profile/personal.lua"] = Buffer.from(
        "return " + luaData(personal) + "\n",
      );
    if (s.raw["cv/profile/education.lua"])
      changes["cv/profile/education.lua"] = Buffer.from(
        "return " + luaData(education) + "\n",
      );
    this.commit(id, changes, () => {
      const nextFingerprint = this.load(id).fingerprint;
      this.store.db
        .prepare(
          "INSERT INTO cv_documents VALUES(?,?,?,?) ON CONFLICT(app) DO UPDATE SET data=excluded.data,source_fingerprint=excluded.source_fingerprint",
        )
        .run(id, JSON.stringify(data), nextFingerprint, s.modId);
    });
    return this.read(id);
  }
  bind(id: string, revision: unknown, modId: unknown) {
    const s = this.load(id);
    check(
      s.app.revision === revision,
      "Bewerbung inzwischen geändert. Neu laden.",
      409,
    );
    check(modId === null || typeof modId === "string", "Ungültige Mod-ID");
    let version: string | null = null;
    if (modId !== null) {
      if (isFormMod(modId)) {
        const mod = this.forms.mod(modId);
        validateFormValues(mod.spec, this.formValues(id));
        version = mod.id;
      } else {
        check(this.resolveMod, "Vorlagen-Mods nicht verfügbar", 503);
        version = this.resolveMod(modId).id;
      }
    }
    this.commit(id, {}, () => {
      if (version && isFormMod(version)) this.forms.pin(version);
      this.store.db
        .prepare(
          "INSERT INTO cv_documents VALUES(?,?,?,?) ON CONFLICT(app) DO UPDATE SET data=excluded.data,source_fingerprint=excluded.source_fingerprint,mod_id=excluded.mod_id",
        )
        .run(id, JSON.stringify(s.data), s.fingerprint, version);
    });
    return this.read(id);
  }
  copy(source: string, destination: string) {
    if (
      !this.store.db
        .prepare("SELECT 1 FROM cv_documents WHERE app=?")
        .get(source)
    )
      return;
    const s = this.load(source),
      target = this.load(destination);
    this.store.db
      .prepare("INSERT INTO cv_documents VALUES(?,?,?,?)")
      .run(destination, JSON.stringify(s.data), target.fingerprint, s.modId);
    const values = this.store.db
      .prepare("SELECT data FROM cv_form_values WHERE app=?")
      .get(source);
    if (values)
      this.store.db
        .prepare("INSERT INTO cv_form_values VALUES(?,?)")
        .run(destination, String(values.data));
  }
  private buildData(data: CvData): CvData {
    return {
      ...data,
      sections: data.sections
        .map((section) => ({
          ...section,
          entries: section.entries
            .filter((entry) => entry.included !== false)
            .map(({ included: _included, ...entry }) => entry),
        }))
        .filter((section) => section.entries.length > 0),
    };
  }
  fingerprint(id: string) {
    const s = this.load(id),
      data = this.buildData(s.data);
    if (s.modId) {
      if (isFormMod(s.modId)) {
        const mod = this.forms.mod(s.modId);
        return hash(
          JSON.stringify({
            mod: mod.id,
            values: pdfValues(
              mod.spec,
              bindApplicantForm(
                this.formValues(id),
                mod.spec.applicant,
                this.store.applicantProfiles.snapshot(id),
              ),
            ),
            applicant: mod.spec.applicant
              ? this.store.applicantProfiles.fingerprint(id)
              : undefined,
          }),
        );
      }
      check(this.resolveMod, "Vorlagen-Mods nicht verfügbar", 503);
      const mod = this.resolveMod(s.modId);
      return hash(
        JSON.stringify({
          data: bindApplicantCv(
            data,
            mod.applicant,
            this.store.applicantProfiles.snapshot(id),
          ),
          mod: mod.id,
          digest: mod.digest,
          applicant: mod.applicant
            ? this.store.applicantProfiles.fingerprint(id)
            : undefined,
        }),
      );
    }
    const files = fileMap(s.dir);
    return hash(
      JSON.stringify({
        data,
        files: Object.keys(files)
          .filter(
            (p) =>
              (p.startsWith("cv/") || p.startsWith("fonts/")) &&
              (!s.compatible || !Object.hasOwn(s.raw, p)),
          )
          .sort()
          .map((p) => [p, hash(files[p]!)]),
      }),
    );
  }
  plan(id: string): { files: Record<string, Buffer>; mod: boolean } | null {
    if (
      !this.store.db.prepare("SELECT 1 FROM cv_documents WHERE app=?").get(id)
    )
      return null;
    const s = this.load(id);
    validateCv(s.data);
    const data = this.buildData(s.data);
    const marker = Buffer.from(
      JSON.stringify({ fingerprint: this.fingerprint(id) }),
    );
    if (s.modId) {
      if (isFormMod(s.modId))
        return {
          mod: true,
          files: {
            ...this.forms.snapshot(
              s.modId,
              this.formValues(id),
              this.store.applicantProfiles.renderContext(
                id,
                this.forms.mod(s.modId).spec.applicant,
              ),
            ),
            "application.json": this.store.read(id, "application.json"),
            "cv-build.json": marker,
          },
        };
      check(this.resolveMod, "Vorlagen-Mods nicht verfügbar", 503);
      const mod = this.resolveMod(s.modId);
      const boundData = bindApplicantCv(
        data,
        mod.applicant,
        this.store.applicantProfiles.snapshot(id),
      );
      for (const field of mod.fields.filter((f) => f.required)) {
        const [scope, key] = field.key.split(".");
        if (scope === "person")
          check(
            boundData.person[key!]?.trim(),
            `Benötigte Vorlagenangabe fehlt: ${field.label}`,
            409,
          );
        else
          for (const section of data.sections.filter(
            (section) => scope === "entry" || section.kind === scope,
          ))
            for (const entry of section.entries)
              check(
                entry.fields[key!]?.trim(),
                `Benötigte Vorlagenangabe fehlt: ${field.label}`,
                409,
              );
      }
      return {
        mod: true,
        files: {
          ...mod.files,
          "cv-data.lua": Buffer.from("return " + luaData(boundData) + "\n"),
          ...applicantBuildFiles(
            mod.applicant,
            this.store.applicantProfiles.renderContext(id, mod.applicant),
          ),
          "application.json": this.store.read(id, "application.json"),
          "cv-build.json": marker,
        },
      };
    }
    if (!s.compatible) {
      check(
        !s.data.sections.some((section) =>
          section.entries.some((entry) => entry.included === false),
        ),
        "Diese individuelle Vorlage benötigt für die PDF-Auswahl eine Mod-Anbindung.",
        409,
      );
      check(
        s.main.includes("profiles/"),
        "Für diese Vorlage zuerst einen geprüften Lebenslauf-Mod auswählen oder die erweiterten Quellen bauen.",
        409,
      );
      return null;
    }
    const oldFormatter = this.store
      .read(id, "cv/lua/formatter.lua")
      .toString("utf8");
    const accent = /\\\\AkzentFarbe\{([0-9, ]+)\}/.exec(oldFormatter)?.[1];
    const legacyAccent =
      accent &&
      accent.split(",").length === 3 &&
      accent
        .split(",")
        .every(
          (v) =>
            Number.isInteger(Number(v)) && Number(v) >= 0 && Number(v) <= 255,
        )
        ? accent
        : undefined;
    return {
      mod: false,
      files: {
        ...fileMap(s.dir),
        "cv/lua/loader.lua": Buffer.from(
          "return {load=function() return dofile('lua/cv-data.lua') end}\n",
        ),
        "cv/lua/validate.lua": Buffer.from("return {run=function() end}\n"),
        "cv/lua/formatter.lua": Buffer.from(compatFormatter),
        "cv/lua/cv-data.lua": Buffer.from(
          "return " +
            luaData({
              ...data,
              ...(legacyAccent ? { _legacyAccent: legacyAccent } : {}),
            }) +
            "\n",
        ),
        "cv-build.json": marker,
      },
    };
  }
}
const compatFormatter = String.raw`local out={}
local escapes={['\\']='\\textbackslash{}',['#']='\\#',['$']='\\$',['%']='\\%',['&']='\\&',['_']='\\_',['{']='\\{',['}']='\\}',['~']='\\textasciitilde{}',['^']='\\textasciicircum{}'}
local function esc(v) return (tostring(v or ''):gsub('.',function(c) return escapes[c] or c end)) end
local function blocks(entry)
 for _,block in ipairs(entry.content or {}) do
  if block.type=='paragraph' then tex.print(esc(block.text)..'\\par')
  elseif block.type=='bulletList' and #block.items>0 then tex.print('\\begin{cvbullets}');for _,item in ipairs(block.items) do tex.print('\\item '..esc(item.text)) end;tex.print('\\end{cvbullets}') end
 end
end
function out.render(cv)
 if cv._legacyAccent then tex.print('\\AkzentFarbe{'..cv._legacyAccent..'}') end
 local p=cv.person
 tex.print('\\Name{'..esc(p.firstName or p.displayName)..'}{'..esc(p.lastName)..'}')
 for _,pair in ipairs({{'Strasse','street'},{'TelefonNummer','phone'},{'Email','email'},{'Ort','city'},{'Geburtstag','birthday'},{'Geburtsort','birthplace'},{'FotoPfad','photo'},{'SignaturPfad','signature'}}) do tex.print('\\'..pair[1]..'{'..esc(p[pair[2]])..'}') end
 tex.print('\\PlzOrt{'..esc(p.postalCode and (p.postalCode..' '..(p.city or '')) or p.city)..'}\\Header')
 for _,section in ipairs(cv.sections) do
  if #section.entries>0 then
   tex.print('\\begin{Abschnitt}{'..esc(section.label)..'}')
   for _,entry in ipairs(section.entries) do
    local f=entry.fields
    if section.kind=='education' then tex.print('\\cveducation{'..esc(f.period)..'}{'..esc(f.title)..'}{'..esc(f.subtitle)..'}{'..esc(f.grade)..'}{'..esc(f.organization)..'}');if #entry.content>0 then tex.print('\\cvrow{}{');blocks(entry);tex.print('}') end
    elseif section.kind=='skills' then
     if #entry.content==1 and entry.content[1].type=='bulletList' then
      local values={};for _,item in ipairs(entry.content[1].items) do table.insert(values,esc(item.text)) end
      tex.print('\\cvsmallitem{'..esc(f.label or f.title)..'}{'..table.concat(values,', ')..'}')
     else tex.print('\\cvrow{'..esc(f.label or f.title)..'}{');blocks(entry);tex.print('}') end
    else tex.print('\\begin{cvdetails}{'..esc(f.period)..'}{'..esc(f.title)..'}{'..esc(f.organization)..'}');blocks(entry);tex.print('\\end{cvdetails}') end
   end
   tex.print('\\end{Abschnitt}')
  end
 end
 tex.print('\\Unterschrift')
end
return out
`;
