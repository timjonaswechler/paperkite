import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  parseForm,
  validateValues,
  pdfValues,
  unmapped,
  type Values,
} from "../shared/cv-form.ts";
import { Store } from "../server/store.ts";
import { Builds, dockerRunner } from "../server/builds.ts";
import { cvDocumentTemplate } from "./fixtures/cv-document-template.ts";
const dir = path.resolve("examples/cv-form-mods");
function fixture(name: string) {
  return {
    spec: JSON.parse(fs.readFileSync(path.join(dir, name, "mod.json"), "utf8")),
    files: {
      "main.tex": fs.readFileSync(path.join(dir, name, "main.tex")),
      "format.lua": fs.readFileSync(path.join(dir, "format.lua")),
    },
  };
}
const sample = (): Values => ({
  fullName: "Alpha51",
  mail: "alpha@example.invalid",
  notes: "MetadataHidden83",
  career: [
    {
      id: "one",
      included: true,
      values: {
        position: "FirstMarker53",
        body: [
          { id: "p1", type: "paragraph", text: "Before55 50% & Rust_2026." },
          {
            id: "list1",
            type: "bulletList",
            items: [{ id: "item1", text: "Middle57" }],
          },
          { id: "p2", type: "paragraph", text: "After59" },
        ],
      },
    },
    { id: "hidden", included: false, values: { position: "ExcludedMarker85" } },
    { id: "two", included: true, values: { position: "SecondMarker61" } },
  ],
});
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), "cv-form-v2-"));
const save = (s: Store, id: string, values: Values) =>
  s.cv.save(id, { ...s.cv.read(id), formValues: values });
async function pdfText(file: string) {
  return (
    await promisify(execFile)(
      "/usr/bin/docker",
      [
        "run",
        "--rm",
        "--network=none",
        "--read-only",
        "--cap-drop=ALL",
        "--user",
        `${process.getuid!()}:${process.getgid!()}`,
        "--mount",
        `type=bind,src=${path.dirname(file)},dst=/input,readonly`,
        "--entrypoint",
        "pdftotext",
        fs.readFileSync("pdf-tools/image-id", "utf8").trim(),
        "/input/" + path.basename(file),
        "-",
      ],
      { timeout: 30000, maxBuffer: 1024 * 1024 },
    )
  ).stdout.replace(/\s+/g, " ");
}

test("B/F: distinct forms validate, unknown primitives/overrides and ambiguous bindings cannot masquerade as controls", () => {
  for (const name of ["cv", "portfolio"])
    assert.equal(parseForm(fixture(name).spec).format, "bewerbung-cv-form-v2");
  const s = fixture("cv").spec;
  for (const mutate of [
    (v: typeof s) =>
      v.form.push({
        type: "script",
        label: "Code",
        key: "evil",
        target: "pdf",
      }),
    (v: typeof s) => (v.form.at(-1).actions = false),
    (v: typeof s) =>
      v.form.push({
        type: "text",
        key: "notes",
        label: "Duplicate",
        target: "pdf",
      }),
    (v: typeof s) => (v.form.at(-1).key = "a.b"),
    (v: typeof s) =>
      v.form.at(-1).children.push({
        type: "entries",
        key: "nested",
        label: "Nested",
        children: [],
      }),
  ]) {
    const copy = structuredClone(s);
    mutate(copy);
    assert.throws(() => parseForm(copy));
  }
  const values = sample();
  validateValues(parseForm(s), values, true);
  for (const excluded of ["ExcludedMarker85", "MetadataHidden83"])
    assert.equal(
      JSON.stringify(pdfValues(parseForm(s), values)).includes(excluded),
      false,
    );
  assert.throws(() =>
    validateValues(parseForm(s), { ...values, fullName: [] }),
  );
  assert.throws(
    () =>
      validateValues(parseForm(s), {
        fullName: "OK",
        career: [
          { id: "x", included: true, values: {} },
          { id: "x", included: false, values: {} },
        ],
      }),
    /eindeutig/,
  );
  validateValues(parseForm(s), { career: [] });
  assert.throws(
    () => validateValues(parseForm(s), { career: [] }, true),
    /Pflichtangabe/,
  );
});

test("D/G: normal CV documents preserve legacy sources, CAS, copies and unknown values across pinned form mods", () => {
  const root = temp();
  let store = new Store(root);
  try {
    const template = store.import(cvDocumentTemplate()),
      a = store.create({ company: "Form A", template: template.id }),
      b = store.create({ company: "Form B", template: template.id });
    const legacy = store.cv.read(a.id),
      source = store.read(a.id, "cv/profiles/general.lua");
    assert.equal(store.cv.forms.list().length, 2);
    assert.equal(
      store.db.prepare("SELECT count(*) n FROM cv_form_mods").get()!.n,
      0,
    );
    assert.equal(
      store.db.prepare("SELECT count(*) n FROM cv_documents").get()!.n,
      0,
    );
    const f = fixture("cv"),
      p = fixture("portfolio"),
      ma = store.cv.forms.install("CV", f.spec, f.files),
      mb = store.cv.forms.install("Portfolio", p.spec, p.files);
    let d = store.cv.bind(a.id, a.revision, ma.id);
    assert.deepEqual(d.form!.values, {});
    assert.deepEqual(d.data, legacy.data);
    d = save(store, a.id, sample());
    const profile = path.join(store.workspace(a.id), "cv/profiles/general.lua");
    fs.appendFileSync(profile, "\n");
    assert.throws(
      () => store.cv.save(a.id, { ...d, formValues: sample() }),
      /inzwischen/,
    );
    fs.writeFileSync(profile, source);
    const stale = d,
      values = sample();
    values.fullName = "Changed";
    d = save(store, a.id, values);
    assert.throws(
      () => store.cv.save(a.id, { ...stale, formValues: sample() }),
      /inzwischen/,
    );
    assert.equal(store.cv.read(b.id).modId, null);
    assert.equal(store.cv.read(b.id).form, undefined);
    const copy = store.create({ source: a.id, company: "Independent copy" });
    save(store, copy.id, sample());
    assert.equal(store.cv.read(a.id).form!.values.fullName, "Changed");
    const incompatible = structuredClone(f.spec);
    incompatible.form[0].children[0].children[0].type = "content";
    const incompatibleMod = store.cv.forms.install(
      "Incompatible field type",
      incompatible,
      f.files,
    );
    assert.throws(
      () => store.cv.bind(a.id, d.revision, incompatibleMod.id),
      (error) => (error as { status: number }).status === 400,
    );
    assert.deepEqual(store.cv.read(a.id), d);
    d = store.cv.bind(a.id, d.revision, mb.id);
    assert.equal(d.form!.values.fullName, "Changed");
    assert.ok(unmapped(mb.spec, d.form!.values).includes("fullName"));
    const modified = structuredClone(f.spec);
    modified.form[0].children[0].children[0].label = "Different label";
    const next = store.cv.forms.install("CV next", modified, f.files);
    assert.notEqual(ma.id, next.id);
    assert.equal(store.cv.read(copy.id).modId, ma.id);
    assert.deepEqual(store.cv.forms.mod(ma.id).spec, f.spec);
    store.close();
    store = new Store(root);
    assert.deepEqual(store.cv.read(a.id), d);
    const restored = store.cv.bind(a.id, d.revision, null);
    assert.deepEqual(restored.data, legacy.data);
    assert.equal(
      store.read(a.id, "cv/profiles/general.lua").equals(source),
      true,
    );
    assert.deepEqual(
      store.cv.bind(a.id, restored.revision, ma.id).form!.values,
      values,
    );
    store.remove(copy.id, store.app(copy.id).revision);
    assert.equal(
      store.db
        .prepare("SELECT count(*) n FROM cv_form_values WHERE app=?")
        .get(copy.id)!.n,
      0,
    );
    assert.ok(store.cv.read(a.id));
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("E/G: normal application Builds produce real form PDFs, track selected changes and retain old artifacts", async () => {
  const root = temp(),
    store = new Store(root),
    builds = new Builds(
      store,
      dockerRunner(fs.readFileSync("builder/image-id", "utf8").trim()),
    );
  const build = async (id: string) => {
    const job = builds.request(id, "cv");
    await builds.idle();
    const result = store.build(id, String(job.id));
    assert.equal(result.status, "success", String(result.log));
    return {
      id: String(job.id),
      text: await pdfText(builds.artifact(id, String(job.id))),
    };
  };
  try {
    const f = fixture("cv"),
      m = store.cv.forms.install("CV", f.spec, f.files),
      a = store.create({ company: "PDF CV" });
    store.cv.bind(a.id, a.revision, m.id);
    save(store, a.id, sample());
    const first = await build(a.id),
      text = first.text;
    for (const marker of [
      "Alpha51",
      "FirstMarker53",
      "Before55",
      "Middle57",
      "After59",
      "SecondMarker61",
      "50%",
      "Rust_2026",
    ])
      assert.ok(text.includes(marker), marker + " missing");
    for (const no of [
      "ExcludedMarker85",
      "MetadataHidden83",
      "UI-only Notizen",
      "Tätigkeit",
    ])
      assert.equal(text.includes(no), false, no);
    assert.ok(text.indexOf("FirstMarker53") < text.indexOf("SecondMarker61"));
    assert.ok(text.indexOf("Before55") < text.indexOf("Middle57"));
    assert.ok(text.indexOf("Middle57") < text.indexOf("After59"));
    assert.ok(builds.inputFiles(a.id, first.id)["form-mod.json"]);
    assert.equal(builds.documentStatus(a.id).cv, "current");
    const old = fs.readFileSync(builds.artifact(a.id, first.id)),
      edited = sample();
    (edited.career as { values: Values }[])[1]!.values.position =
      "StillExcluded";
    save(store, a.id, edited);
    assert.equal(builds.documentStatus(a.id).cv, "current");
    (edited.career as unknown[]).reverse();
    save(store, a.id, edited);
    assert.equal(builds.documentStatus(a.id).cv, "outdated");
    assert.ok(fs.readFileSync(builds.artifact(a.id, first.id)).equals(old));
    const p = fixture("portfolio"),
      mp = store.cv.forms.install("Portfolio", p.spec, p.files),
      b = store.create({ company: "PDF Portfolio" });
    store.cv.bind(b.id, b.revision, mp.id);
    save(store, b.id, {
      headline: "Portfolio71",
      intro: [],
      projects: [
        {
          id: "project-one",
          included: true,
          values: {
            caption: "Project73",
            stack: "Rust_2026 50% & Lua",
            details: [
              { id: "description", type: "paragraph", text: "Detail75" },
            ],
          },
        },
      ],
    });
    const portfolio = await build(b.id);
    for (const marker of [
      "Portfolio71",
      "Project73",
      "Rust_2026",
      "50%",
      "Detail75",
    ])
      assert.ok(portfolio.text.includes(marker));
    assert.ok(fs.readFileSync(builds.artifact(a.id, first.id)).equals(old));
    save(store, b.id, { headline: "Empty77", projects: [] });
    assert.ok((await build(b.id)).text.includes("Empty77"));
  } finally {
    await builds.idle();
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
