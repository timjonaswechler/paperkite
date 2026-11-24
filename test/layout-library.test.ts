import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Store } from "../server/store.ts";
import type { CoverMod } from "../server/cover-documents.ts";
import { check } from "../server/files.ts";

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "layout-library-"));
  const store = new Store(root);
  const files = {
    "main.tex": Buffer.from(
      "\\documentclass{article}\\begin{document}Layout\\end{document}",
    ),
  };
  const spec = {
    format: "bewerbung-cv-form-v2",
    engine: "lualatex",
    entrypoint: "main.tex",
    form: [{ type: "text", key: "body", label: "Content", target: "pdf" }],
  };
  const a = store.cv.forms.install("CV Alpha", spec, files),
    b = store.cv.forms.install("CV Beta", spec, files);
  const incompatible = store.cv.forms.install(
    "Incompatible",
    {
      ...spec,
      form: [{ type: "content", key: "body", label: "Blocks", target: "pdf" }],
    },
    files,
  );
  const covers: Record<string, CoverMod> = Object.fromEntries(
    ["a", "b"].map((key) => [
      "cover:" + key,
      {
        id: "cover:" + key,
        name: "Letter " + key,
        digest: key.repeat(64),
        files,
        manifest: {
          format: "bewerbung-cover-mod-v1",
          engine: "lualatex",
          entrypoint: "main.tex",
        },
      },
    ]),
  );
  store.cover.resolveMod = (id) => {
    check(covers[id], "Unbekannte Anschreiben-Vorlage");
    return covers[id]!;
  };
  store.preferences.validateLayout = (kind, id) => {
    if (kind === "cv") {
      check(id.startsWith("form:"), "Kein CV-Layout");
      store.cv.forms.mod(id);
    } else store.cover.resolveMod!(id);
    return id;
  };
  return {
    root,
    store,
    a: a.id,
    b: b.id,
    incompatible: incompatible.id,
    close: () => {
      store.close();
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

test("creation uses both visible selections atomically and rejects invalid layouts without leaving applications", () => {
  const f = fixture();
  try {
    const a = f.store.create({
      company: "Selected",
      cvModId: f.a,
      coverModId: "cover:b",
    });
    assert.equal(f.store.cv.read(a.id).modId, f.a);
    assert.equal(f.store.cover.read(a.id).modId, "cover:b");
    assert.equal(a.revision, 1);
    const before = f.store.list().length;
    assert.throws(
      () => f.store.create({ company: "Invalid", cvModId: "form:missing" }),
      /gefunden|Vorlage/,
    );
    assert.equal(f.store.list().length, before);
    assert.equal(
      fs.readdirSync(path.join(f.root, "applications")).length,
      before,
    );
    assert.throws(
      () => f.store.create({ company: "Wrong type", cvModId: "cover:b" }),
      /Vorlage|CV/,
    );
    assert.throws(
      () =>
        f.store.create({
          company: "Second layout invalid",
          cvModId: f.a,
          coverModId: "cover:missing",
        }),
      /Vorlage/,
    );
    assert.equal(f.store.list().length, before);
    assert.equal(
      f.store.db.prepare("SELECT count(*) AS n FROM cv_documents").get()!.n,
      1,
    );
    assert.equal(
      f.store.db.prepare("SELECT count(*) AS n FROM cover_documents").get()!.n,
      1,
    );
    assert.equal(
      fs.readdirSync(path.join(f.root, "applications")).length,
      before,
    );
  } finally {
    f.close();
  }
});

test("independent defaults persist, explicit null overrides them, copies retain their own pins, and changes never update old applications", () => {
  const f = fixture();
  try {
    f.store.preferences.update({
      revision: f.store.preferences.settings().revision,
      defaultCvModId: f.a,
      defaultCoverModId: "cover:a",
    });
    const first = f.store.create({ company: "Defaults A" });
    assert.equal(f.store.cv.read(first.id).modId, f.a);
    assert.equal(f.store.cover.read(first.id).modId, "cover:a");
    f.store.preferences.update({
      revision: f.store.preferences.settings().revision,
      defaultCvModId: f.b,
      defaultCoverModId: "cover:b",
    });
    const second = f.store.create({ company: "Defaults B" });
    assert.equal(f.store.cv.read(second.id).modId, f.b);
    assert.equal(f.store.cover.read(second.id).modId, "cover:b");
    assert.equal(f.store.cv.read(first.id).modId, f.a);
    assert.equal(f.store.cover.read(first.id).modId, "cover:a");
    const copy = f.store.create({ company: "Copy", source: first.id });
    assert.equal(f.store.cv.read(copy.id).modId, f.a);
    assert.equal(f.store.cover.read(copy.id).modId, "cover:a");
    const legacy = f.store.create({
      company: "Explicit old sources",
      cvModId: null,
      coverModId: null,
    });
    assert.equal(f.store.cv.read(legacy.id).modId, null);
    assert.equal(f.store.cover.read(legacy.id).modId, null);
    const reopened = new Store(f.root);
    try {
      assert.equal(reopened.preferences.settings().defaultCvModId, f.b);
      assert.equal(
        reopened.preferences.settings().defaultCoverModId,
        "cover:b",
      );
      assert.equal(reopened.cv.read(first.id).modId, f.a);
    } finally {
      reopened.close();
    }
  } finally {
    f.close();
  }
});

test("a chosen cover layout remains pinned while preparation is disabled and is reused by later deliberate creation", () => {
  const f = fixture();
  try {
    f.store.preferences.update({
      revision: f.store.preferences.settings().revision,
      prepareCoverLetter: false,
    });
    const app = f.store.create({
      company: "Without letter",
      role: "Engineer",
      coverModId: "cover:a",
    });
    assert(
      !f.store
        .files(app.id)
        .some((file) => file.name.startsWith("anschreiben/")),
    );
    const pending = f.store.cover.read(app.id);
    assert.equal(pending.modId, "cover:a");
    assert.equal(pending.prepared, false);
    assert.throws(
      () => f.store.cover.plan(app.id),
      /zuerst ausdrücklich vorbereiten/,
    );
    const copy = f.store.create({ company: "Pending copy", source: app.id });
    assert.equal(f.store.cover.read(copy.id).modId, "cover:a");
    assert(
      !f.store
        .files(copy.id)
        .some((file) => file.name.startsWith("anschreiben/")),
    );
    const ready = f.store.cover.create(app.id, { revision: app.revision });
    assert.equal(ready.modId, "cover:a");
    assert.equal(ready.prepared, true);
    assert.equal(ready.fields.body, "");
    assert.equal(f.store.cover.read(copy.id).prepared, false);
  } finally {
    f.close();
  }
});

test("switching one CV preserves manual values and cover text, incompatible fields reject without changing pins or revision", () => {
  const f = fixture();
  try {
    const app = f.store.create({
      company: "Manual data",
      cvModId: f.a,
      coverModId: "cover:a",
    });
    const cv = f.store.cv.read(app.id);
    f.store.cv.save(app.id, {
      revision: cv.revision,
      fingerprint: cv.fingerprint,
      formValues: { body: "MANUAL CV 37% & unchanged" },
    });
    const letter = f.store.cover.read(app.id);
    f.store.cover.save(app.id, {
      revision: letter.revision,
      fingerprint: letter.fingerprint,
      fields: { ...letter.fields, body: "MANUAL LETTER 83% & unchanged" },
    });
    const before = f.store.cover.read(app.id),
      raw = f.store.read(app.id, "anschreiben/Anschreiben.tex");
    f.store.cv.bind(app.id, f.store.app(app.id).revision, f.b);
    assert.equal(
      f.store.cv.read(app.id).form!.values.body,
      "MANUAL CV 37% & unchanged",
    );
    assert.equal(f.store.cover.read(app.id).modId, "cover:a");
    assert.equal(f.store.cover.read(app.id).fields.body, before.fields.body);
    assert.deepEqual(f.store.read(app.id, "anschreiben/Anschreiben.tex"), raw);
    const revision = f.store.app(app.id).revision;
    assert.throws(
      () => f.store.cv.bind(app.id, revision, f.incompatible),
      /Inhalt|Block|Array|body/,
    );
    assert.equal(f.store.app(app.id).revision, revision);
    assert.equal(f.store.cv.read(app.id).modId, f.b);
    assert.equal(
      f.store.cv.read(app.id).form!.values.body,
      "MANUAL CV 37% & unchanged",
    );
  } finally {
    f.close();
  }
});
