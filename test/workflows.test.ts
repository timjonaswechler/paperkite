import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../server/store.ts";
import { Builds } from "../server/builds.ts";
import { Harness } from "../server/harness.ts";
import { PdfJobs, pdfInputs } from "../server/pdf-jobs.ts";
import { fileMap } from "../server/files.ts";

const temp = () =>
  fs.mkdtempSync(path.join(os.tmpdir(), "bewerbung-workflows-"));
const pdf = (text: string) => Buffer.from("%PDF-1.7\n" + text);
const master = (text: string) => ({
  format: "bewerbung-template-v1",
  files: Object.fromEntries(
    Object.entries({
      "cv/Lebenslauf.tex": text,
      "cv/lua/loader.lua": "return {}",
      "cv/profiles/general.lua": "return {}",
      "cv/profiles/software.lua": "return {}",
    }).map(([name, value]) => [name, Buffer.from(value).toString("base64")]),
  ),
});
const runner = async (_input: string, output: string) => {
  fs.writeFileSync(path.join(output, "document.pdf"), pdf("BUILD"));
  return "built";
};

test("tags normalize independently, filter literally and reject bad metadata before changing labels or original bytes", () => {
  const root = temp(),
    store = new Store(root);
  try {
    const original = pdf("CERTIFICATE"),
      a = store.documents.upload("Zeugnis.pdf", original),
      b = store.documents.upload("B.pdf", pdf("B"));
    assert.deepEqual(a.tags, []);
    const saved = store.documents.update(a.id, {
      tags: [" Studium ", "STUDIUM", "Abschluss"],
    });
    assert.deepEqual(saved.tags, ["abschluss", "studium"]);
    assert.deepEqual(
      store.documents.list(" STUDIUM ").map((entry) => entry.id),
      [a.id],
    );
    assert.deepEqual(store.documents.list("%_"), []);
    for (const tags of [
      ["bad\nvalue"],
      [""],
      ["x".repeat(41)],
      Array.from({ length: 21 }, (_, i) => String(i)),
      [42],
    ])
      assert.throws(() =>
        store.documents.update(a.id, { label: "MUST NOT CHANGE", tags }),
      );
    assert.equal(store.documents.get(a.id).label, "Zeugnis.pdf");
    assert.deepEqual(store.documents.bytes(a.id), original);
    assert.deepEqual(store.documents.get(b.id).tags, []);
    const duplicate = store.documents.upload("Another.pdf", original);
    assert.equal(duplicate.id, a.id);
    assert.deepEqual(duplicate.tags, ["abschluss", "studium"]);
    store.documents.update(a.id, { tags: [] });
    assert.deepEqual(store.documents.get(a.id).tags, []);
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("template naming/default/copy/export/deletion never rewrites existing applications or silently changes the default", () => {
  const root = temp(),
    store = new Store(root);
  try {
    const first = store.import(master("MASTER A")),
      second = store.import(master("MASTER B"));
    assert.equal(
      store.templates().find((entry) => entry.isDefault)!.id,
      first.id,
    );
    const app = store.create({ company: "Existing", template: first.id });
    const facts = store.app(app.id),
      source = store.read(app.id, "cv/Lebenslauf.tex");
    store.templateLibrary.rename(first.id, "Allgemeiner Lebenslauf");
    assert.equal(
      store.templateLibrary.get(first.id).label,
      "Allgemeiner Lebenslauf",
    );
    store.templateLibrary.setDefault(second.id);
    const copy = store.templateLibrary.copy(second.id);
    assert.equal(copy.label, "Master (Kopie)");
    assert.equal(
      store.templates().find((entry) => entry.isDefault)!.id,
      second.id,
    );
    assert.deepEqual(
      store.templateLibrary.files(copy.id)["cv/Lebenslauf.tex"],
      Buffer.from("MASTER B"),
    );
    const exported = store.templateLibrary.export(first.id);
    assert.equal(exported.format, "bewerbung-template-v1");
    assert.equal(
      Buffer.from(exported.files["cv/Lebenslauf.tex"], "base64").toString(),
      "MASTER A",
    );
    assert.ok(!Object.hasOwn(exported.files, "application.json"));
    assert.throws(
      () => store.templateLibrary.remove(first.id, "stale"),
      /inzwischen geändert/,
    );
    store.templateLibrary.remove(
      first.id,
      store.templateLibrary.get(first.id).digest,
    );
    assert.throws(() => store.templateLibrary.get(first.id), /nicht gefunden/);
    assert.deepEqual(store.app(app.id), facts);
    assert.deepEqual(store.read(app.id, "cv/Lebenslauf.tex"), source);
    const appCopy = store.create({ source: app.id });
    assert.deepEqual(store.read(appCopy.id, "cv/Lebenslauf.tex"), source);
    store.save(app.id, "cv/Lebenslauf.tex", "EDITED APP", app.revision);
    const fromApp = store.templateLibrary.fromFiles(
      fileMap(store.workspace(app.id)),
      "Software",
      "software",
    );
    assert.equal(fromApp.defaultProfile, "software");
    assert.equal(
      store.templateLibrary.files(fromApp.id)["cv/Lebenslauf.tex"].toString(),
      "EDITED APP",
    );
    assert.ok(
      !Object.hasOwn(
        store.templateLibrary.files(fromApp.id),
        "application.json",
      ),
    );
    store.templateLibrary.remove(
      second.id,
      store.templateLibrary.get(second.id).digest,
    );
    assert.equal(
      store.templates().filter((entry) => entry.isDefault).length,
      1,
    );
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("confirmed application deletion removes only its own state/files and retains shared originals, other sessions and auth targets", async () => {
  const parent = temp(),
    root = path.join(parent, "data"),
    store = new Store(root),
    harness = new Harness(store, () => {}),
    builds = new Builds(store, runner);
  try {
    const doc = store.documents.upload("Shared.pdf", pdf("SHARED"));
    const a = store.create({ company: "Delete", documentIds: [doc.id] }),
      b = store.create({ company: "Keep", documentIds: [doc.id] });
    for (const app of [a, b]) {
      store.db
        .prepare("INSERT INTO sessions VALUES(?,?,?,?)")
        .run(app.id, "pi", "synthetic-" + app.id, "test-model");
      store.db
        .prepare("INSERT INTO codex_sessions VALUES(?,?,?,?)")
        .run(app.id, "native-" + app.id, store.workspace(app.id), "model");
      store.db
        .prepare("INSERT INTO harness_choice VALUES(?,?)")
        .run(app.id, "codex");
      store.preferences.open(app.id);
      store.preferences.saveDraft(app.id, "Draft " + app.company);
      store.event(app.id, "user", { text: app.company });
    }
    const builtA = builds.request(a.id, "cover"),
      builtB = builds.request(b.id, "cover");
    await builds.idle();
    const external = path.join(parent, "auth-target"),
      home = path.join(root, "codex", a.id);
    fs.writeFileSync(external, "DO NOT DELETE");
    fs.mkdirSync(home, { recursive: true });
    fs.symlinkSync(external, path.join(home, "auth.json"));
    assert.throws(() => store.remove(a.id, 0), /inzwischen geändert/i);
    assert.equal(store.app(a.id).id, a.id);
    await harness.closeApp(a.id);
    store.remove(a.id, a.revision);
    assert.throws(() => store.app(a.id), /nicht gefunden/);
    assert.equal(fs.existsSync(path.join(root, "applications", a.id)), false);
    assert.equal(
      fs.existsSync(path.join(root, "builds", String(builtA.id))),
      false,
    );
    assert.equal(fs.readFileSync(external, "utf8"), "DO NOT DELETE");
    assert.equal(store.app(b.id).company, "Keep");
    assert.ok(fs.existsSync(builds.artifact(b.id, String(builtB.id))));
    assert.equal(store.documents.get(doc.id).usedBy, 1);
    assert.deepEqual(store.documents.bytes(doc.id), pdf("SHARED"));
    assert.deepEqual(store.preferences.ui().openIds, [b.id]);
    assert.equal(store.preferences.draft(b.id).text, "Draft Keep");
    for (const table of [
      "sessions",
      "codex_sessions",
      "harness_choice",
      "events",
      "builds",
      "application_documents",
      "composer_drafts",
      "open_applications",
    ])
      assert.equal(
        store.db
          .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE app=?`)
          .get(a.id)!.n,
        0,
      );
    assert.equal(
      store.db
        .prepare("SELECT native FROM codex_sessions WHERE app=?")
        .get(b.id)!.native,
      "native-" + b.id,
    );
    assert.equal(
      store.db.prepare("SELECT COUNT(*) AS n FROM pending_deletions").get()!.n,
      0,
    );
  } finally {
    await builds.idle();
    await harness.close();
    store.close();
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("deletion cleanup refuses parent symlinks and retries durably after a restart without deleting the external target", () => {
  const parent = temp(),
    root = path.join(parent, "data");
  let store = new Store(root);
  try {
    const a = store.create({ company: "Delete" }),
      b = store.create({ company: "Keep" });
    const original = path.join(root, "applications"),
      held = path.join(root, "held-applications"),
      outside = path.join(parent, "outside");
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, "sentinel"), "KEEP");
    fs.renameSync(original, held);
    fs.symlinkSync(outside, original);
    store.remove(a.id, a.revision);
    assert.equal(
      fs.readFileSync(path.join(outside, "sentinel"), "utf8"),
      "KEEP",
    );
    assert.equal(
      store.db.prepare("SELECT COUNT(*) AS n FROM pending_deletions").get()!.n,
      1,
    );
    fs.unlinkSync(original);
    fs.renameSync(held, original);
    store.close();
    store = new Store(root);
    assert.equal(
      store.db.prepare("SELECT COUNT(*) AS n FROM pending_deletions").get()!.n,
      0,
    );
    assert.equal(fs.existsSync(path.join(original, a.id)), false);
    assert.ok(fs.existsSync(store.workspace(b.id)));
  } finally {
    store.close();
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("PDF jobs freeze source bytes, retain failed/successful histories and save derivatives without modifying or renaming deduplicated originals", async () => {
  const root = temp(),
    store = new Store(root),
    builds = new Builds(store, runner);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let seen = "";
  const jobs = new PdfJobs(store, builds, async (input, output) => {
    await gate;
    seen = fs.readFileSync(path.join(input, "000.pdf"), "utf8");
    fs.writeFileSync(path.join(output, "result.pdf"), pdf("DERIVED"));
    return { pages: 2 };
  });
  try {
    const original = store.documents.upload("Original.pdf", pdf("ORIGINAL"));
    const job = jobs.start({
      items: [{ kind: "document", id: original.id }],
      compression: "lossless",
    });
    store.documents.rename(original.id, "Renamed after snapshot");
    store.documents.remove(original.id);
    release();
    await jobs.idle();
    assert.equal(seen, pdf("ORIGINAL").toString());
    assert.equal(jobs.get(job.id).status, "success");
    const saved = jobs.save(job.id, { label: "Combined", tags: ["Zeugnisse"] });
    assert.deepEqual(saved.tags, ["zeugnisse"]);
    assert.deepEqual(store.documents.bytes(saved.id), pdf("DERIVED"));
    const duplicate = jobs.save(job.id, {
      label: "MUST NOT RENAME",
      tags: ["other"],
    });
    assert.equal(duplicate.id, saved.id);
    assert.equal(duplicate.label, "Combined");
    assert.deepEqual(duplicate.tags, ["zeugnisse"]);
    assert.ok(!fs.existsSync(path.join(root, "pdf-jobs", job.id, "input")));
    const failing = new PdfJobs(store, builds, async () => {
      throw new Error("Expected corrupt PDF");
    });
    const failure = failing.start({
      items: [{ kind: "document", id: saved.id }],
      compression: "compact",
    });
    await failing.idle();
    assert.equal(failing.get(failure.id).status, "failed");
    assert.throws(() => failing.artifact(failure.id), /noch nicht erfolgreich/);
    assert.deepEqual(fs.readFileSync(jobs.artifact(job.id)), pdf("DERIVED"));
    assert.equal(failing.list().length, 2);
    for (const invalid of [
      [],
      [{ kind: "document", id: saved.id, pages: "0" }],
      [{ kind: "document", id: saved.id, pages: "1;echo x" }],
      [
        { kind: "document", id: saved.id },
        { kind: "document", id: saved.id },
      ],
    ])
      assert.throws(() => pdfInputs(invalid));
    const unavailable = new PdfJobs(store, builds);
    assert.throws(
      () =>
        unavailable.start({
          items: [{ kind: "document", id: saved.id }],
          compression: "lossless",
        }),
      /nicht eingerichtet/,
    );
  } finally {
    release();
    await jobs.idle();
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("PDF plans persist exclusions and CAS independently of app revisions; job sources are scoped to this app's selected documents and builds", async () => {
  const root = temp(),
    store = new Store(root),
    builds = new Builds(store, runner),
    jobs = new PdfJobs(store, builds, async (_i, out) => {
      fs.writeFileSync(path.join(out, "result.pdf"), pdf("RESULT"));
      return { pages: 1 };
    });
  try {
    const first = store.documents.upload("A.pdf", pdf("A")),
      second = store.documents.upload("B.pdf", pdf("B"));
    const a = store.create({ company: "A", documentIds: [first.id] }),
      b = store.create({ company: "B" });
    const own = builds.request(a.id, "cover"),
      foreign = builds.request(b.id, "cv");
    await builds.idle();
    const initial = jobs.plan(a.id);
    assert.equal(initial.revision, 0);
    const saved = jobs.savePlan(a.id, {
      revision: 0,
      items: [{ kind: "document", id: first.id, pages: "1" }],
      compression: "compact",
      excluded: ["build:cover"],
    });
    assert.deepEqual(saved.excluded, ["build:cover"]);
    assert.equal(store.app(a.id).revision, a.revision);
    assert.throws(
      () =>
        jobs.savePlan(a.id, {
          revision: 0,
          items: [],
          compression: "lossless",
        }),
      /inzwischen geändert/,
    );
    assert.throws(
      () =>
        jobs.savePlan(a.id, {
          revision: saved.revision,
          items: [{ kind: "build", id: own.id }],
          compression: "lossless",
          excluded: ["build:cover"],
        }),
      /gleichzeitig/,
    );
    assert.throws(
      () =>
        jobs.start({
          appId: a.id,
          items: [{ kind: "document", id: second.id }],
          compression: "lossless",
        }),
      /Anlagenauswahl/,
    );
    assert.throws(
      () =>
        jobs.start({
          appId: a.id,
          items: [{ kind: "build", id: foreign.id }],
          compression: "lossless",
        }),
      /nicht gefunden/,
    );
    assert.throws(
      () =>
        jobs.start({
          items: [{ kind: "build", id: own.id }],
          compression: "lossless",
        }),
      /benötigen eine Bewerbung/,
    );
    const job = jobs.start({
      appId: a.id,
      items: [
        { kind: "build", id: own.id },
        { kind: "document", id: first.id },
      ],
      compression: "lossless",
    });
    await jobs.idle();
    assert.equal(jobs.get(job.id).pages, 1);
    assert.equal(jobs.list(a.id).length, 1);
    assert.equal(jobs.list(b.id).length, 0);
    assert.equal(jobs.list().length, 0);
  } finally {
    await jobs.idle();
    await builds.idle();
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// A failed renderer/notification/cleanup must not poison the serialized queue; retry cleanup on restart.
test("PDF queue survives renderer errors, disconnected notifications and temporary cleanup failures", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bewerbung-pdf-queue-"));
  const store = new Store(root),
    builds = new Builds(store, async () => "");
  const app = store.create({ company: "Synthetic queue" });
  const document = store.documents.upload(
    "Input.pdf",
    Buffer.from("%PDF-1.7\nORIGINAL"),
  );
  store.update(app.id, { revision: app.revision, documentIds: [document.id] });
  let calls = 0;
  const jobs = new PdfJobs(
    store,
    builds,
    async (_input, out) => {
      if (++calls === 1) throw new Error("Synthetic renderer failure");
      fs.writeFileSync(path.join(out, "result.pdf"), "%PDF-1.7\nSUCCESS");
      return { pages: 1 };
    },
    () => {
      throw new Error("Synthetic disconnected stream");
    },
  );
  const originalRm = fs.rmSync,
    originalWarn = console.warn;
  const warnings: string[] = [];
  try {
    console.warn = (...args: unknown[]) => warnings.push(args.join(" "));
    fs.rmSync = (directory, options) => {
      if (String(directory).endsWith(path.sep + "input"))
        throw new Error("Synthetic EACCES during cleanup");
      originalRm(directory, options);
    };
    const input = {
      appId: app.id,
      items: [{ kind: "document", id: document.id }],
      compression: "lossless",
    };
    const failed = jobs.start(input),
      successful = jobs.start(input);
    await jobs.idle();
    assert.equal(jobs.get(failed.id).status, "failed");
    assert.match(jobs.get(failed.id).error!, /Synthetic renderer failure/);
    assert.equal(jobs.get(successful.id).status, "success");
    assert.equal(
      fs.readFileSync(jobs.artifact(successful.id), "utf8"),
      "%PDF-1.7\nSUCCESS",
    );
    assert.equal(calls, 2);
    for (const job of [failed, successful])
      assert.ok(fs.existsSync(path.join(root, "pdf-jobs", job.id, "input")));
    assert.ok(warnings.some((warning) => warning.includes("Dateibereinigung")));
    assert.ok(warnings.some((warning) => warning.includes("Benachrichtigung")));
    fs.rmSync = originalRm;
    const recovered = new PdfJobs(store, builds);
    for (const job of [failed, successful])
      assert.equal(
        fs.existsSync(path.join(root, "pdf-jobs", job.id, "input")),
        false,
      );
    assert.equal(recovered.get(successful.id).status, "success");
    assert.equal(recovered.get(failed.id).status, "failed");
  } finally {
    fs.rmSync = originalRm;
    console.warn = originalWarn;
    await jobs.idle();
    await builds.idle();
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
