import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { zipSync } from "fflate";
import {
  CvModImports,
  type ModThreadRunner,
} from "../server/cv-mod-prototype/imports.ts";
import { dockerModBuilder } from "../server/cv-mod-prototype/native.ts";
import {
  formAdapterContract,
  formExample,
  formBuildCases,
} from "../server/cv-form-model.ts";
import { parseForm } from "../shared/cv-form.ts";
import { Store } from "../server/store.ts";
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), "cv-v2-import-"));
const archive = () =>
  Buffer.from(
    zipSync({
      "main.tex": Buffer.from(
        "\\documentclass{article}\\begin{document}Synthetic source\\end{document}",
      ),
    }),
  );
function generated(workspace: string) {
  const dir = path.join(workspace, "mod");
  fs.mkdirSync(dir, { recursive: true });
  const spec = JSON.parse(
    fs.readFileSync("test/fixtures/cv-form-mods/portfolio/mod.json", "utf8"),
  );
  spec.form.push({
    type: "text",
    key: "internalNote",
    label: "Internal-only",
    target: "metadata",
  });
  fs.writeFileSync(path.join(dir, "mod.json"), JSON.stringify(spec));
  for (const file of ["main.tex", "format.lua"])
    fs.copyFileSync(
      file === "main.tex"
        ? "test/fixtures/cv-form-mods/portfolio/main.tex"
        : "test/fixtures/cv-form-mods/format.lua",
      path.join(dir, file),
    );
}
const thread = (write: (workspace: string) => void): ModThreadRunner => ({
  generate: async (w, onThread) => {
    write(w);
    onThread("synthetic-v2", "https://example.invalid/thread");
  },
  assertFinished: async () => {},
  remove: async () => {},
});
const hash = (file: string) =>
  createHash("sha256").update(fs.readFileSync(file)).digest("hex");

test("v2 agent contract uses the real primitive parser, explicit binding ABI and independently worked test markers", () => {
  assert.equal(parseForm(formExample).format, "bewerbung-cv-form-v2");
  for (const part of [
    "entries",
    "content",
    "columns",
    "target",
    "metadata",
    "NEEDS-INPUT.md",
    "CV_DATA_FILE",
    "Keine produktiven Änderungen",
  ])
    assert.ok(formAdapterContract.includes(part));
  const spec = parseForm({
    format: "bewerbung-cv-form-v2",
    engine: "lualatex",
    entrypoint: "main.tex",
    form: [
      { type: "text", key: "heading", label: "Heading", target: "pdf" },
      { type: "text", key: "note", label: "Note", target: "metadata" },
      {
        type: "entries",
        key: "rows",
        label: "Rows",
        children: [
          { type: "text", key: "value", label: "Value", target: "pdf" },
        ],
      },
      { type: "content", key: "body", label: "Body", target: "pdf" },
    ],
  });
  const cases = formBuildCases(spec),
    full = cases[0]!;
  assert.deepEqual(full.expected, [
    "CvField1X",
    "CvField3X",
    "CvField5X",
    "CvField7X",
    "CvField8X",
    "CvField9X",
    "50%",
    "Rust_2026",
  ]);
  assert.deepEqual(full.forbidden, ["CvMeta2X"]);
  assert.deepEqual(full.order, [
    ["CvField3X", "CvField5X"],
    ["CvField7X", "CvField8X"],
    ["CvField8X", "CvField9X"],
  ]);
  assert.deepEqual(cases[1]!.order, [
    ["CvField5X", "CvField3X"],
    ["CvField9X", "CvField8X"],
    ["CvField8X", "CvField7X"],
  ]);
  assert.ok(cases[2]!.forbidden.includes("CvField5X"));
  assert.deepEqual(cases[3]!.data.rows, []);
  assert.throws(
    () =>
      formBuildCases(
        parseForm({
          format: "bewerbung-cv-form-v2",
          engine: "lualatex",
          entrypoint: "main.tex",
          form: [],
        }),
      ),
    /PDF-Datenfeld/,
  );
});

test("new uploads request v2 and reject downgrade, unknown primitives and incomplete PDF mappings without publishing", async () => {
  for (const fault of ["downgrade", "primitive", "missing-content"]) {
    const root = temp();
    let builds = 0;
    const imports = new CvModImports(
      root,
      thread((w) => {
        generated(w);
        const file = path.join(w, "mod/mod.json"),
          spec = JSON.parse(fs.readFileSync(file, "utf8"));
        if (fault === "downgrade")
          Object.assign(spec, {
            format: "bewerbung-cv-mod-prototype-v1",
            fields: [],
          });
        if (fault === "primitive")
          spec.form.push({ type: "hostScript", label: "Unsafe" });
        fs.writeFileSync(file, JSON.stringify(spec));
      }),
      async (_i, o) => {
        builds++;
        fs.writeFileSync(path.join(o, "document.pdf"), "%PDF-1.7\nWrong");
        return { text: "No declared markers", log: "Fixture" };
      },
    );
    try {
      const job = imports.upload("template.zip", archive(), "cv-template");
      assert.equal(job.targetFormat, "bewerbung-cv-form-v2");
      assert.equal(
        fs.readFileSync(
          path.join(root, job.id, "workspace/ADAPTER-CONTRACT.md"),
          "utf8",
        ),
        formAdapterContract,
      );
      imports.start(job.id);
      await imports.idle();
      assert.equal(imports.get(job.id).status, "failed");
      assert.equal(
        imports.db.prepare("SELECT count(*) n FROM versions").get()!.n,
        0,
      );
      assert.equal(builds, fault === "missing-content" ? 4 : 0);
    } finally {
      await imports.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test("v2 questions stay actionable and recheck completes without a replacement model turn", async () => {
  const root = temp();
  let calls = 0;
  const imports = new CvModImports(
    root,
    thread((w) => {
      calls++;
      fs.writeFileSync(
        path.join(w, "NEEDS-INPUT.md"),
        "Welche fehlende Schrift soll bereitgestellt werden?",
      );
    }),
    async (i, o) => {
      const { parseLiteralLua } = await import("../server/lua-profile.ts");
      const data = JSON.parse(
        JSON.stringify(
          parseLiteralLua(fs.readFileSync(path.join(i, "cv-data.lua"), "utf8")),
        ),
      );
      const text = JSON.stringify(data).replace(/\\n/g, " ");
      fs.writeFileSync(path.join(o, "document.pdf"), "%PDF-1.7\nfixture");
      return { text, log: "Boundary fixture only" };
    },
  );
  try {
    const job = imports.upload("questions.zip", archive(), "cv-template");
    imports.start(job.id);
    await imports.idle();
    assert.equal(imports.get(job.id).status, "needs-input");
    assert.match(imports.get(job.id).error!, /Schrift/);
    assert.equal(imports.get(job.id).versionId, undefined);
    imports.recheck(job.id);
    await imports.idle();
    assert.equal(imports.get(job.id).status, "needs-input");
    assert.equal(calls, 1);
    const w = path.join(root, job.id, "workspace");
    generated(w);
    fs.rmSync(path.join(w, "NEEDS-INPUT.md"));
    imports.recheck(job.id);
    await imports.idle();
    assert.equal(
      imports.get(job.id).status,
      "review",
      JSON.stringify(imports.get(job.id).checks),
    );
    assert.equal(calls, 1);
  } finally {
    await imports.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("real v2 import PDFs seal immutable versions that bind to normal CV documents without local ghost copies", async () => {
  const root = temp(),
    store = new Store(path.join(root, "data")),
    imports = new CvModImports(
      path.join(root, "imports"),
      thread(generated),
      dockerModBuilder(
        fs.readFileSync("builder/image-id", "utf8").trim(),
        fs.readFileSync("pdf-tools/image-id", "utf8").trim(),
      ),
    );
  store.cv.forms.resolveImported = (id) => imports.reviewedForm(id);
  imports.isUsed = (id) =>
    Boolean(
      store.db
        .prepare("SELECT 1 FROM cv_documents WHERE mod_id LIKE ?")
        .get("form:" + id + ".%"),
    );
  try {
    const job = imports.upload("real-v2.zip", archive(), "cv-template");
    imports.start(job.id);
    await imports.idle();
    const first = imports.get(job.id);
    assert.equal(first.status, "review", JSON.stringify(first.checks));
    assert.deepEqual(
      first.checks.map((c) => c.status),
      ["passed", "passed", "passed", "passed"],
    );
    assert.ok(first.versionId!.startsWith("form:"));
    const app = store.create({ company: "V2 fixture" }),
      legacy = store.cv.read(app.id).data,
      selected = store.cv.bind(app.id, app.revision, first.versionId!);
    assert.ok(selected.form);
    assert.deepEqual(selected.form!.values, {});
    assert.deepEqual(selected.data, legacy);
    assert.equal(
      store.db.prepare("SELECT count(*) n FROM cv_form_mods").get()!.n,
      0,
    );
    const pdf = imports.artifact(job.id, "form-full"),
      originalHash = hash(pdf),
      old = imports.reviewedForm(first.versionId!);
    assert.ok(old.spec.form.length > 0);
    assert.throws(() => imports.reviewed(first.versionId!), /v2/);
    await assert.rejects(imports.remove(job.id, first.updated), /verwendet/);
    const sealed = path.join(
        imports.root,
        job.id,
        "builds",
        first.buildId!,
        "package/main.tex",
      ),
      sealedBytes = fs.readFileSync(sealed);
    fs.appendFileSync(sealed, "\n% tampered sealed copy");
    assert.throws(() => imports.reviewedForm(first.versionId!), /verändert/);
    fs.writeFileSync(sealed, sealedBytes);
    const actualMod = path.join(imports.root, job.id, "workspace/mod");
    fs.appendFileSync(
      path.join(actualMod, "main.tex"),
      "\n% layout next version",
    );
    imports.recheck(job.id);
    await imports.idle();
    const next = imports.get(job.id);
    assert.equal(next.status, "review", JSON.stringify(next.checks));
    assert.notEqual(next.versionId, first.versionId);
    assert.equal(store.cv.read(app.id).modId, first.versionId);
    assert.deepEqual(imports.reviewedForm(first.versionId!), old);
    assert.equal(hash(pdf), originalHash);
    fs.writeFileSync(path.join(actualMod, "mod.json"), "{}");
    imports.recheck(job.id);
    await imports.idle();
    assert.equal(imports.get(job.id).status, "failed");
    assert.deepEqual(imports.reviewedForm(first.versionId!), old);
    assert.equal(imports.get(job.id).versionId, next.versionId);
    assert.equal(imports.reviewedForm(next.versionId!).id, next.versionId);
    store.cv.bind(app.id, store.app(app.id).revision, null);
    await imports.remove(job.id, imports.get(job.id).updated);
    assert.deepEqual(store.cv.forms.list(), []);
    assert.throws(() => store.cv.forms.mod(first.versionId!), /nicht gefunden/);
  } finally {
    await imports.close();
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
