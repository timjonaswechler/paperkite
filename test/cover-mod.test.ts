import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { zipSync } from "fflate";
import { Store } from "../server/store.ts";
import { Builds, dockerRunner } from "../server/builds.ts";
import { CvModImports } from "../server/cv-mod-prototype/imports.ts";
import { dockerModBuilder } from "../server/cv-mod-prototype/native.ts";
import { coverBuildCases } from "../server/cover-mod.ts";
import { decodeCover } from "../server/cover-letter.ts";
import { importManifest } from "../server/cv-mod-prototype/model.ts";
const manifest = {
  format: "bewerbung-cover-mod-v1" as const,
  engine: "lualatex" as const,
  entrypoint: "main.tex",
};
const files = () => ({
  "mod.json": Buffer.from(JSON.stringify(manifest)),
  "main.tex": fs.readFileSync("test/fixtures/cover-mod/main.tex"),
  "render.lua": fs.readFileSync("test/fixtures/cover-mod/render.lua"),
});
const fields = () => structuredClone(coverBuildCases[0]!.data);
const hash = (b: Buffer) => createHash("sha256").update(b).digest("hex");

test("cover imports publish immutable versions, bind independently of CVs and build real letter PDFs with current snapshots", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cover-mod-")),
    store = new Store(path.join(root, "business"));
  let generations = 0;
  const imports = new CvModImports(
    path.join(root, "imports"),
    {
      generate: async (workspace, onThread) => {
        generations++;
        for (const [name, bytes] of Object.entries(files()))
          fs.writeFileSync(path.join(workspace, "mod", name), bytes);
        onThread("synthetic-cover", "https://example.invalid/cover");
      },
      assertFinished: async () => {},
      remove: async () => {},
    },
    dockerModBuilder(
      fs.readFileSync("builder/image-id", "utf8").trim(),
      fs.readFileSync("pdf-tools/image-id", "utf8").trim(),
    ),
  );
  store.cover.resolveMod = (id) => imports.reviewedCover(id);
  imports.isUsed = (id) =>
    Boolean(
      store.db
        .prepare("SELECT 1 FROM cover_documents WHERE mod_id LIKE ?")
        .get("cover:" + id + ".%"),
    );
  try {
    const zip = Buffer.from(zipSync({ "main.tex": files()["main.tex"] }));
    assert.throws(
      () =>
        imports.upload(
          "wrong.zip",
          zip,
          "cover-template",
          "bewerbung-cv-form-v2",
        ),
      /Zielformat/,
    );
    const job = imports.upload("letter-layout.zip", zip, "cover-template");
    assert.equal(job.targetFormat, "bewerbung-cover-mod-v1");
    assert.match(
      fs.readFileSync(
        path.join(imports.root, job.id, "workspace/ADAPTER-CONTRACT.md"),
        "utf8",
      ),
      /LETTER_DATA_FILE/,
    );
    imports.start(job.id);
    await imports.idle();
    const first = imports.get(job.id);
    assert.equal(first.status, "review", JSON.stringify(first.checks));
    assert.equal(generations, 1);
    assert.equal(
      fs
        .readFileSync(imports.artifact(job.id, "cover-fields"))
        .subarray(0, 5)
        .toString(),
      "%PDF-",
    );
    assert.deepEqual(
      first.checks.map((c) => c.status),
      ["passed", "passed", "passed", "passed"],
    );
    assert(first.versionId!.startsWith("cover:"));
    assert.throws(() => imports.reviewed(first.versionId!), /v2-Editor/);
    assert.throws(() => imports.reviewedForm(first.versionId!), /Formular|v2/);
    const app = store.create({ company: "Synthetic letter" }),
      cv = store.cv.read(app.id),
      initial = fields();
    store.cover.save(app.id, { revision: app.revision, fields: initial });
    const original = store.read(app.id, "anschreiben/Anschreiben.tex");
    let state = store.cover.bind(app.id, {
      ...store.cover.read(app.id),
      modId: first.versionId,
    });
    assert.deepEqual(state.fields, initial);
    assert.deepEqual(store.cv.read(app.id).data, cv.data);
    assert.equal(store.cv.read(app.id).modId, null);
    assert.deepEqual(
      store.read(app.id, "anschreiben/Anschreiben.tex"),
      original,
    );
    state = store.cover.save(app.id, {
      ...state,
      fields: {
        ...state.fields,
        body: "ChangedLetter71 50% & Rust_2026.\n\nAfterMarker73",
      },
    });
    assert.deepEqual(
      store.read(app.id, "anschreiben/Anschreiben.tex"),
      original,
    );
    const builds = new Builds(
      store,
      dockerRunner(fs.readFileSync("builder/image-id", "utf8").trim()),
    );
    const b = builds.request(app.id, "cover");
    await builds.idle();
    assert.equal(
      store.build(app.id, String(b.id)).status,
      "success",
      String(store.build(app.id, String(b.id)).log),
    );
    assert.equal(builds.documentStatus(app.id).cover, "current");
    const goodPdf = hash(
      fs.readFileSync(builds.artifact(app.id, String(b.id))),
    );
    const snapshot = builds.inputFiles(app.id, String(b.id));
    assert(snapshot["cover-build.json"]);
    assert(snapshot["cover-mod.json"]);
    assert(snapshot["cv-data.lua"]!.toString().includes("ChangedLetter71"));
    const copy = store.create({
      source: app.id,
      company: "Independent letter copy",
    });
    store.cover.save(copy.id, {
      ...store.cover.read(copy.id),
      fields: { ...state.fields, body: "OnlyCopy79" },
    });
    assert.equal(store.cover.read(app.id).fields.body, state.fields.body);
    await assert.rejects(
      imports.remove(job.id, imports.get(job.id).updated),
      /verwendet/,
    );
    fs.appendFileSync(
      path.join(imports.root, job.id, "workspace/mod/main.tex"),
      "\n% new layout version\n",
    );
    imports.recheck(job.id);
    await imports.idle();
    const next = imports.get(job.id);
    assert.equal(next.status, "review");
    assert.notEqual(next.versionId, first.versionId);
    assert.equal(store.cover.read(app.id).modId, first.versionId);
    assert.equal(
      hash(fs.readFileSync(builds.artifact(app.id, String(b.id)))),
      goodPdf,
    );
    state = store.cover.save(app.id, {
      ...state,
      fields: { ...state.fields, subject: "NewSubject83" },
    });
    assert.equal(builds.documentStatus(app.id).cover, "outdated");
    const sealed = path.join(
        imports.root,
        job.id,
        "builds",
        first.buildId!,
        "package/main.tex",
      ),
      bytes = fs.readFileSync(sealed);
    fs.appendFileSync(sealed, "\n% tampered\n");
    assert.throws(() => imports.reviewedCover(first.versionId!), /verändert/);
    fs.writeFileSync(sealed, bytes);
    const restored = store.cover.bind(app.id, { ...state, modId: null });
    assert.equal(
      decodeCover(store.read(app.id, "anschreiben/Anschreiben.tex").toString())!
        .body,
      state.fields.body,
    );
    assert.equal(restored.modId, null);
    store.remove(copy.id, store.app(copy.id).revision);
    await imports.remove(job.id, imports.get(job.id).updated);
    assert.throws(
      () => imports.reviewedCover(first.versionId!),
      /nicht gefunden/,
    );
    assert.equal(
      hash(fs.readFileSync(builds.artifact(app.id, String(b.id)))),
      goodPdf,
    );
  } finally {
    await imports.close();
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("cover drafts reject stale source/revision and roll back text and database together; custom TeX is never replaced by choosing a mod", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cover-guards-"));
  let store = new Store(root);
  const resolve = () => ({
    id: "cover:fixed.version",
    name: "Fixture",
    digest: "fixed",
    manifest,
    files: files(),
  });
  store.cover.resolveMod = resolve;
  try {
    const app = store.create({ company: "Guards" });
    let state = store.cover.save(app.id, {
      revision: app.revision,
      fields: fields(),
    });
    const original = store.read(app.id, "anschreiben/Anschreiben.tex"),
      revision = state.revision;
    store.db.exec(
      "CREATE TRIGGER fail_cover BEFORE UPDATE ON cover_documents BEGIN SELECT RAISE(FAIL,'forced rollback'); END;",
    );
    assert.throws(
      () =>
        store.cover.save(app.id, {
          ...state,
          fields: { ...state.fields, body: "MustNotPersist" },
        }),
      /forced rollback/,
    );
    assert.equal(store.app(app.id).revision, revision);
    assert.deepEqual(
      store.read(app.id, "anschreiben/Anschreiben.tex"),
      original,
    );
    assert.deepEqual(store.cover.read(app.id), state);
    store.db.exec("DROP TRIGGER fail_cover");
    fs.appendFileSync(
      path.join(store.workspace(app.id), "anschreiben/Anschreiben.tex"),
      "\n% external\n",
    );
    assert.throws(
      () => store.cover.save(app.id, { ...state, fields: state.fields }),
      /inzwischen/,
    );
    const custom =
      "\\documentclass{article}\\begin{document}CustomSource91\\end{document}";
    store.save(
      app.id,
      "anschreiben/Anschreiben.tex",
      custom,
      store.app(app.id).revision,
    );
    state = store.cover.read(app.id);
    assert(state.requiresConversion);
    assert.throws(
      () => store.cover.save(app.id, { ...state, fields: state.fields }),
      /ausdrücklich/,
    );
    state = store.cover.bind(app.id, {
      ...state,
      modId: "cover:fixed.version",
    });
    assert.equal(
      store.read(app.id, "anschreiben/Anschreiben.tex").toString(),
      custom,
    );
    assert.equal(state.requiresConversion, false);
    store.close();
    store = new Store(root);
    store.cover.resolveMod = resolve;
    assert.deepEqual(store.cover.read(app.id), state);
    state = store.cover.bind(app.id, { ...state, modId: null });
    assert(state.requiresConversion);
    assert.equal(
      store.read(app.id, "anschreiben/Anschreiben.tex").toString(),
      custom,
    );
    assert.throws(
      () => importManifest({ ...manifest, fields: [] }),
      /Manifest/,
    );
    store.update(app.id, { revision: state.revision, status: "Gesendet" });
    const frozen = store.cover.read(app.id);
    assert.throws(
      () =>
        store.cover.bind(app.id, { ...frozen, modId: "cover:fixed.version" }),
      /schreibgeschützt/i,
    );
    assert.throws(
      () =>
        store.cover.save(app.id, {
          ...frozen,
          fields: frozen.fields,
          replaceExisting: true,
        }),
      /schreibgeschützt/i,
    );
    assert.deepEqual(store.cover.read(app.id), frozen);
    assert.equal(
      store.read(app.id, "anschreiben/Anschreiben.tex").toString(),
      custom,
    );
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
