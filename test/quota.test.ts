import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../server/store.ts";
import { DATA_LIMIT, FILE_LIMIT, writeDocument } from "../server/files.ts";

const chunk = "x".repeat(3_500_000);
const name = (n: number) => `cv/profiles/chunk${n}.lua`;
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bewerbung-quota-"));
  const store = new Store(root);
  const app = store.create({ company: "Synthetic quota fixture" });
  for (let n = 0; n < 4; n++)
    store.save(app.id, name(n), chunk, store.app(app.id).revision);
  return { root, store, id: app.id };
}

test("cumulative edits reject overflow before changing files or revision, but replacements and smaller edits work", () => {
  const { root, store, id } = fixture();
  try {
    const before = store.app(id);
    const facts = store.read(id, "application.json");
    assert.throws(
      () => store.save(id, name(4), chunk, before.revision),
      /insgesamt zu groß/,
    );
    assert.equal(store.app(id).revision, before.revision);
    assert.deepEqual(store.read(id, "application.json"), facts);
    assert.equal(fs.existsSync(path.join(store.workspace(id), name(4))), false);
    assert.ok(store.files(id).reduce((n, f) => n + f.size, 0) < DATA_LIMIT);
    // Replacing an existing file must subtract its previous size.
    store.save(id, name(0), "y".repeat(3_600_000), before.revision);
    assert.equal(store.read(id, name(0)).length, 3_600_000);
    store.save(id, name(0), "return {}", store.app(id).revision);
    store.save(id, name(4), chunk, store.app(id).revision);
    assert.equal(store.read(id, name(4)).length, 3_500_000);
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("bulk reuse validates the complete result before replacing any destination file", () => {
  const { root, store, id } = fixture();
  try {
    const source = store.create({ company: "Synthetic reuse source" });
    store.save(source.id, name(0), "y".repeat(3_500_000), source.revision);
    store.save(source.id, name(4), chunk, store.app(source.id).revision);
    const revision = store.app(id).revision;
    assert.throws(
      () => store.reuse(id, source.id, [name(0), name(4)], revision),
      /insgesamt zu groß/,
    );
    assert.equal(store.read(id, name(0)).toString(), chunk);
    assert.equal(store.app(id).revision, revision);
    assert.equal(fs.existsSync(path.join(store.workspace(id), name(4))), false);
    assert.equal(
      store.read(source.id, name(0)).toString(),
      "y".repeat(3_500_000),
    );
    assert.ok(store.files(id).reduce((n, f) => n + f.size, 0) < DATA_LIMIT);
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("metadata growth is validated before mutation and a full imported template cannot create an unloadable application", () => {
  const { root, store, id } = fixture();
  try {
    const used = store.files(id).reduce((n, f) => n + f.size, 0);
    store.save(
      id,
      name(4),
      "x".repeat(DATA_LIMIT - used - 100),
      store.app(id).revision,
    );
    const before = store.app(id);
    const facts = store.read(id, "application.json");
    assert.throws(
      () =>
        store.update(id, {
          revision: before.revision,
          notes: "n".repeat(1000),
        }),
      /insgesamt zu groß/,
    );
    assert.equal(store.app(id).notes, before.notes);
    assert.equal(store.app(id).revision, before.revision);
    assert.deepEqual(store.read(id, "application.json"), facts);

    const files: Record<string, string> = {
      "cv/Lebenslauf.tex": Buffer.from("CV").toString("base64"),
      "cv/lua/loader.lua": Buffer.from("return {}").toString("base64"),
    };
    let remaining = DATA_LIMIT - 11;
    for (let n = 0; remaining; n++) {
      const length = Math.min(4 * 1024 * 1024, remaining);
      files[name(n)] = Buffer.alloc(length, "x").toString("base64");
      remaining -= length;
    }
    const template = store.import({ format: "bewerbung-template-v1", files });
    const count = store.list().length;
    assert.throws(
      () => store.create({ template: template.id }),
      /insgesamt zu groß/,
    );
    assert.equal(store.list().length, count);
    assert.ok(store.files(id).reduce((n, f) => n + f.size, 0) <= DATA_LIMIT);
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Pi mutation operations recheck quotas at commit time even for already-approved sibling writes", async () => {
  const { root, store, id } = fixture();
  try {
    const workspace = store.workspace(id);
    const outcomes = await Promise.allSettled(
      [5, 6].map(async (n) => {
        writeDocument(
          workspace,
          path.join(workspace, name(n)),
          "y".repeat(1_500_000),
        );
      }),
    );
    assert.deepEqual(
      outcomes.map((r) => r.status),
      ["fulfilled", "rejected"],
    );
    assert.equal(store.read(id, name(5)).length, 1_500_000);
    assert.equal(fs.existsSync(path.join(workspace, name(6))), false);
    assert.throws(
      () =>
        writeDocument(
          workspace,
          path.join(workspace, name(5)),
          "x".repeat(FILE_LIMIT + 1),
        ),
      /Datei zu groß/,
    );
    assert.equal(store.read(id, name(5)).length, 1_500_000);
    assert.throws(
      () =>
        writeDocument(
          workspace,
          path.join(workspace, "application.json"),
          "{}",
        ),
      /Nur Textdokumente/,
    );
    store.bump(id);
    assert.ok(store.files(id).reduce((n, f) => n + f.size, 0) <= DATA_LIMIT);
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
