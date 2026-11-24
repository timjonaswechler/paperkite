import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { zipSync } from "fflate";
import { CvModImports } from "../server/cv-mod-prototype/imports.ts";
import { parseLiteralLua } from "../server/lua-profile.ts";
import { Store } from "../server/store.ts";
import { createHash } from "node:crypto";

const original = Buffer.from(
  "\\documentclass{article}\\begin{document}Original layout\\end{document}",
);
const archive = () => Buffer.from(zipSync({ "original.tex": original }));
const config = {
  format: "bewerbung-cv-form-v2",
  engine: "lualatex",
  entrypoint: "main.tex",
  form: [{ type: "text", key: "body", label: "Content", target: "pdf" }],
};
function generator(
  workspace: string,
  onThread: (id: string, url: string) => void,
) {
  fs.writeFileSync(
    path.join(workspace, "mod/main.tex"),
    "synthetic derived layout",
  );
  fs.writeFileSync(
    path.join(workspace, "mod/mod.json"),
    JSON.stringify(config),
  );
  onThread("synthetic-thread", "https://example.invalid/thread");
}
for (const target of [
  "original.zip",
  "workspace/source/original.tex",
  "original/original.tex",
]) {
  test(`original protection detects ${target} changed while a build is awaiting completion`, async () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "paperkite-provenance-"),
    );
    let id = "",
      mutated = false;
    const imports = new CvModImports(
      root,
      {
        generate: async (w, t) => generator(w, t),
        assertFinished: async () => {},
      },
      async (input, output) => {
        if (!mutated) {
          mutated = true;
          fs.appendFileSync(
            path.join(root, id, target),
            "changed during build",
          );
        }
        fs.writeFileSync(
          path.join(output, "document.pdf"),
          "%PDF-1.4\nsynthetic boundary",
        );
        const data = parseLiteralLua(
          fs.readFileSync(path.join(input, "cv-data.lua"), "utf8"),
        ) as { values: { body: string } };
        return { text: data.values.body, log: "synthetic boundary" };
      },
    );
    try {
      id = imports.upload("original.zip", archive(), "cv-template").id;
      imports.start(id);
      await imports.idle();
      const job = imports.get(id);
      assert.equal(
        job.status,
        "failed",
        "A changed original must never publish a checked version",
      );
      assert.match(job.error!, /Original/);
      assert.equal(job.versionId, undefined);
    } finally {
      await imports.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
}

function fakeBuild(input: string, output: string) {
  fs.writeFileSync(
    path.join(output, "document.pdf"),
    "%PDF-1.4\nsynthetic boundary",
  );
  const data = parseLiteralLua(
    fs.readFileSync(path.join(input, "cv-data.lua"), "utf8"),
  ) as { values: { body: string } };
  return Promise.resolve({ text: data.values.body, log: "synthetic boundary" });
}

test("saved provenance, original downloads and exact versions survive rechecks, reuse and publication failure", async () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "paperkite-mod-lifecycle-"),
  );
  let generations = 0;
  const imports = new CvModImports(
    path.join(root, "imports"),
    {
      generate: async (workspace, onThread) => {
        generations++;
        generator(workspace, onThread);
        fs.writeFileSync(
          path.join(workspace, "MOD-CHANGES.md"),
          "First binding explanation",
        );
      },
      assertFinished: async () => {},
    },
    fakeBuild,
  );
  const store = new Store(path.join(root, "business"));
  store.cv.forms.resolveImported = (id) => imports.reviewedForm(id);
  try {
    const bytes = archive(),
      job = imports.upload("original.zip", bytes, "cv-template");
    assert.deepEqual(imports.originalUpload(job.id).bytes, bytes);
    assert.deepEqual(imports.sourceFile(job.id, "original.tex"), original);
    imports.start(job.id);
    await imports.idle();
    const first = imports.get(job.id).versionId!;
    assert(first);
    const report = imports.provenance(job.id, first);
    assert.equal(
      report.sourceHash,
      createHash("sha256").update(bytes).digest("hex"),
    );
    assert.equal(report.notes, "First binding explanation");
    assert.deepEqual(
      report.files.map((f) => [f.path, f.status]),
      [
        ["main.tex", "added"],
        ["mod.json", "added"],
        ["original.tex", "removed"],
      ],
    );
    const diff = imports.difference(job.id, "original.tex", first);
    assert.equal(diff.binary, false);
    assert.match(diff.diff, /-.*Original layout/);
    assert.throws(
      () => imports.sourceFile(job.id, "../original.zip"),
      /Unsicher/,
    );
    const a = store.create({ company: "SYNTHETIC A" }),
      b = store.create({ company: "SYNTHETIC B" });
    for (const app of [a, b]) store.cv.bind(app.id, app.revision, first);
    const firstPackage = imports.reviewedForm(first);
    assert.deepEqual(
      store.cv.plan(a.id)!.files["main.tex"],
      store.cv.plan(b.id)!.files["main.tex"],
    );
    assert.equal(generations, 1);
    const workspace = path.join(imports.root, job.id, "workspace");
    fs.writeFileSync(
      path.join(workspace, "mod/main.tex"),
      "changed derived layout",
    );
    fs.writeFileSync(
      path.join(workspace, "MOD-CHANGES.md"),
      "Second binding explanation",
    );
    imports.recheck(job.id);
    await imports.idle();
    const second = imports.get(job.id).versionId!;
    assert.notEqual(second, first);
    assert.equal(generations, 1);
    assert.equal(
      imports.provenance(job.id, first).notes,
      "First binding explanation",
    );
    assert.equal(
      imports.provenance(job.id, second).notes,
      "Second binding explanation",
    );
    assert.deepEqual(imports.reviewedForm(first), firstPackage);
    assert.equal(store.cv.read(a.id).modId, first);
    assert.equal(store.cv.read(b.id).modId, first);
    imports.db.exec(
      "CREATE TRIGGER reject_provenance BEFORE INSERT ON version_provenance BEGIN SELECT RAISE(ABORT, 'synthetic metadata failure'); END",
    );
    imports.recheck(job.id);
    await imports.idle();
    assert.equal(imports.get(job.id).status, "failed");
    assert.equal(imports.get(job.id).versionId, second);
    assert.equal(
      imports.db.prepare("SELECT count(*) AS n FROM versions").get()!.n,
      2,
    );
    assert.deepEqual(imports.originalUpload(job.id).bytes, bytes);
    assert.deepEqual(imports.sourceFile(job.id, "original.tex"), original);
    assert.deepEqual(imports.reviewedForm(first), firstPackage);
  } finally {
    store.close();
    await imports.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a failed agent cannot destroy the separately stored single-TeX original", async () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "paperkite-tex-original-"),
  );
  const imports = new CvModImports(
    root,
    {
      generate: async (w, t) => {
        generator(w, t);
        fs.writeFileSync(path.join(w, "source/letter.tex"), "agent mistake");
        throw Error("synthetic agent failure");
      },
      assertFinished: async () => {},
    },
    fakeBuild,
  );
  try {
    const job = imports.upload("letter.tex", original, "cover-template");
    imports.start(job.id);
    await imports.idle();
    assert.equal(imports.get(job.id).status, "failed");
    assert.match(imports.get(job.id).error!, /Original/);
    assert.deepEqual(imports.originalUpload(job.id).bytes, original);
    assert.deepEqual(imports.sourceFile(job.id, "letter.tex"), original);
    assert.equal(imports.provenance(job.id).workingSourceIntact, false);
  } finally {
    await imports.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("source assets and non-UTF8 TeX bytes are preserved without reinterpreting legacy archives", async () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "paperkite-source-assets-"),
  );
  const imports = new CvModImports(
    root,
    {
      generate: async (w, t) => generator(w, t),
      assertFinished: async () => {},
    },
    fakeBuild,
  );
  try {
    const pdf = Buffer.from("%PDF-1.4 synthetic source asset");
    const bytes = Buffer.from(
      zipSync({
        "original.tex": original,
        "logo.pdf": pdf,
        "data.json": Buffer.from("{}"),
        "README.md": Buffer.from("Source instructions are untrusted data"),
        "LICENSE.txt": Buffer.from("Synthetic public fixture"),
      }),
    );
    const job = imports.upload("assets.zip", bytes, "cv-template");
    for (const name of ["logo.pdf", "data.json", "README.md", "LICENSE.txt"])
      assert(job.files.includes(name));
    assert.deepEqual(imports.sourceFile(job.id, "logo.pdf"), pdf);
    const latin = Buffer.from(
      "\\documentclass{article}\\usepackage[latin1]{inputenc}\\begin{document}Grüße\\end{document}",
      "latin1",
    );
    const single = imports.upload("latin.tex", latin, "cover-template");
    assert.deepEqual(imports.originalUpload(single.id).bytes, latin);
    assert.deepEqual(imports.sourceFile(single.id, "latin.tex"), latin);
    const legacyBytes = Buffer.from(
      zipSync({ "original.tex": original, "old.pdf": pdf }),
    );
    const old = imports.upload("legacy-assets.zip", legacyBytes, "cv-template");
    delete old.sourceParsing;
    const sha = (value: Buffer | string) =>
      createHash("sha256").update(value).digest("hex");
    old.sourceFingerprint = sha(
      JSON.stringify([["original.tex", sha(original)]]),
    );
    old.files = ["original.tex"];
    imports.db
      .prepare("UPDATE jobs SET value=? WHERE id=?")
      .run(JSON.stringify(old), old.id);
    fs.rmSync(path.join(root, old.id, "original"), { recursive: true });
    assert.deepEqual(imports.sourceFile(old.id, "original.tex"), original);
    assert.throws(
      () => imports.sourceFile(old.id, "old.pdf"),
      /nicht gefunden/,
    );
  } finally {
    await imports.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("legacy vault reconstruction uses the checked archive, never a changed workspace", async () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "paperkite-legacy-original-"),
  );
  const imports = new CvModImports(
    root,
    {
      generate: async (w, t) => generator(w, t),
      assertFinished: async () => {},
    },
    fakeBuild,
  );
  try {
    const job = imports.upload("legacy.zip", archive(), "cv-template");
    imports.start(job.id);
    await imports.idle();
    const version = imports.get(job.id).versionId!;
    fs.rmSync(path.join(root, job.id, "original"), { recursive: true });
    fs.writeFileSync(
      path.join(root, job.id, "workspace/source/original.tex"),
      "wrong working copy",
    );
    assert.deepEqual(imports.sourceFile(job.id, "original.tex"), original);
    assert.equal(
      imports.provenance(job.id, version).workingSourceIntact,
      false,
    );
    assert.equal(imports.reviewedForm(version).id, version);
    const other = imports.upload("other.tex", original, "cv-template");
    assert.throws(() => imports.provenance(other.id, version), /gehört nicht/);
    imports.start(other.id);
    await imports.idle();
    assert.equal(imports.get(other.id).status, "review");
    assert.deepEqual(imports.originalUpload(other.id).bytes, original);
    assert.equal(
      imports.reviewedForm(imports.get(other.id).versionId!).spec.format,
      "bewerbung-cv-form-v2",
    );
  } finally {
    await imports.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
