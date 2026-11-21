import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../server/store.ts";
import { Builds, type BuildKind, type Runner } from "../server/builds.ts";
import { PdfJobs } from "../server/pdf-jobs.ts";
import { Deliveries } from "../server/deliveries.ts";
const pdf = (name: string) => Buffer.from("%PDF-1.7\n" + name);
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), "build-retention-"));
const fake: Runner = async (_input, output, kind) => {
  fs.writeFileSync(path.join(output, "document.pdf"), pdf(kind));
  return "Built";
};
const status = (code: number) => (e: unknown) =>
  (e as { status: number }).status === code;
async function build(b: Builds, app: string, kind: BuildKind = "cv") {
  const job = b.request(app, kind);
  await b.idle();
  assert.equal(b.store.build(app, String(job.id)).status, "success");
  return String(job.id);
}
function auto(store: Store, value: boolean) {
  store.preferences.update({
    revision: store.preferences.settings().revision,
    autoPruneBuilds: value,
  });
}

test("manual build deletion removes only its files/snapshots, releases attachments and updates preview history", async () => {
  const root = temp(),
    store = new Store(root),
    b = new Builds(store, fake);
  try {
    const a = store.create({ company: "A" }),
      other = store.create({ company: "B" }),
      doc = store.documents.upload("certificate.pdf", pdf("certificate"));
    store.documents.assign(a.id, [doc.id]);
    const first = await build(b, a.id),
      second = await build(b, a.id),
      foreign = await build(b, other.id);
    const newest = fs.readFileSync(b.artifact(a.id, second));
    assert.equal(store.documents.get(doc.id).usedBy, 1);
    assert.equal(
      store.db
        .prepare("SELECT count(*) n FROM build_documents WHERE document=?")
        .get(doc.id)!.n,
      2,
    );
    assert.throws(() => b.remove(other.id, first), status(404));
    assert.equal(fs.existsSync(b.artifact(a.id, first)), true);
    assert.deepEqual(b.remove(a.id, first), {
      ok: true,
      cleanupPending: false,
    });
    assert.throws(() => b.artifact(a.id, first), status(404));
    assert.equal(fs.existsSync(path.join(root, "builds", first)), false);
    assert.equal(
      store.db
        .prepare("SELECT count(*) n FROM build_documents WHERE build=?")
        .get(first)!.n,
      0,
    );
    assert.equal(store.documents.get(doc.id).usedBy, 1);
    assert.equal(
      store.db
        .prepare("SELECT count(*) n FROM build_documents WHERE document=?")
        .get(doc.id)!.n,
      1,
    );
    assert.ok(store.documents.bytes(doc.id).equals(pdf("certificate")));
    assert.ok(fs.readFileSync(b.artifact(a.id, second)).equals(newest));
    assert.ok(b.artifact(other.id, foreign));
    assert.equal(b.history(a.id)[0]!.id, second);
    store.documents.assign(a.id, []);
    assert.throws(() => store.documents.remove(doc.id), status(409));
    b.remove(a.id, second);
    store.documents.remove(doc.id);
    assert.deepEqual(b.history(a.id), []);
    assert.equal(b.documentStatus(a.id).cv, "missing");
  } finally {
    await b.idle();
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("automatic cleanup is opt-in, success-only, scoped by app/kind and preserves newer queued jobs", async () => {
  const root = temp(),
    store = new Store(root);
  let mode: "success" | "fail" | "hold" = "success",
    entered: () => void = () => {},
    release: () => void = () => {};
  let gate = Promise.resolve();
  const b = new Builds(store, async (...args) => {
    if (mode === "hold") {
      entered();
      await gate;
    }
    if (mode === "fail") throw Error("Intentional failure");
    return fake(...args);
  });
  try {
    const a = store.create({ company: "A" }),
      other = store.create({ company: "Other" }),
      first = await build(b, a.id),
      second = await build(b, a.id),
      cover = await build(b, a.id, "cover"),
      foreign = await build(b, other.id);
    assert.equal(store.preferences.settings().autoPruneBuilds, false);
    assert.ok(b.artifact(a.id, first));
    auto(store, true);
    assert.ok(b.artifact(a.id, first));
    mode = "fail";
    const failed = String(b.request(a.id, "cv").id);
    await b.idle();
    assert.equal(store.build(a.id, failed).status, "failed");
    assert.ok(b.artifact(a.id, first));
    assert.ok(b.artifact(a.id, second));
    mode = "hold";
    const running = new Promise<void>((r) => (entered = r));
    gate = new Promise<void>((r) => (release = r));
    const keeper = String(b.request(a.id, "cv").id);
    await running;
    assert.throws(() => b.remove(a.id, keeper), status(409));
    const queued = String(b.request(a.id, "cv").id);
    assert.throws(() => b.remove(a.id, queued), status(409));
    assert.ok(b.artifact(a.id, first));
    release();
    await b.idle();
    mode = "success";
    assert.equal(store.build(a.id, queued).status, "success");
    assert.throws(() => store.build(a.id, first), status(404));
    assert.throws(() => store.build(a.id, second), status(404));
    assert.throws(() => store.build(a.id, failed), status(404));
    assert.throws(() => store.build(a.id, keeper), status(404));
    assert.ok(b.artifact(a.id, queued));
    assert.ok(b.artifact(a.id, cover));
    assert.ok(b.artifact(other.id, foreign));
    auto(store, false);
    const retained = await build(b, a.id);
    assert.ok(b.artifact(a.id, queued));
    assert.ok(b.artifact(a.id, retained));
  } finally {
    release();
    await b.idle();
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("finalized builds and saved plan/PDF/delivery references stay protected from manual and automatic deletion", async () => {
  const root = temp(),
    store = new Store(root),
    b = new Builds(store, fake),
    pdfs = new PdfJobs(store, b, async (_input, output) => {
      fs.writeFileSync(path.join(output, "result.pdf"), pdf("assembled"));
      return { pages: 1 };
    }),
    deliveries = new Deliveries(store, b, pdfs);
  try {
    const a = store.create({ company: "Protected" }),
      fixed = await build(b, a.id),
      plan = await build(b, a.id),
      legacyPlan = await build(b, a.id),
      jobSource = await build(b, a.id),
      originalSource = await build(b, a.id),
      removable = await build(b, a.id);
    b.finalize(a.id, fixed);
    deliveries.savePlan(a.id, {
      revision: 0,
      format: "pdf",
      outputs: [
        {
          id: "package",
          label: "Package",
          mode: "original",
          compression: "none",
          items: [{ kind: "build", id: originalSource }],
        },
      ],
    });
    const delivery = deliveries.start(a.id, 1);
    await deliveries.idle();
    assert.equal(deliveries.get(a.id, delivery.id).status, "success");
    deliveries.savePlan(a.id, {
      revision: 1,
      format: "pdf",
      outputs: [
        {
          id: "package",
          label: "Package",
          mode: "original",
          compression: "none",
          items: [{ kind: "build", id: plan }],
        },
      ],
    });
    pdfs.savePlan(a.id, {
      revision: 0,
      compression: "none",
      items: [{ kind: "build", id: legacyPlan }],
    });
    const job = pdfs.start({
      appId: a.id,
      compression: "none",
      items: [{ kind: "build", id: jobSource }],
      label: "Preserved",
    });
    await pdfs.idle();
    assert.equal(pdfs.get(job.id).status, "success");
    for (const id of [fixed, plan, legacyPlan, jobSource, originalSource]) {
      assert.ok(b.history(a.id).find((row) => row.id === id)!.deletionBlocked);
      assert.throws(() => b.remove(a.id, id), status(409));
    }
    auto(store, true);
    const latest = await build(b, a.id);
    assert.throws(() => store.build(a.id, removable), status(404));
    for (const id of [
      fixed,
      plan,
      legacyPlan,
      jobSource,
      originalSource,
      latest,
    ])
      assert.ok(b.artifact(a.id, id));
  } finally {
    await deliveries.idle();
    await pdfs.idle();
    await b.idle();
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("deletion journal rolls back DB errors and retries file cleanup without turning a successful build into failure", async (t) => {
  const root = temp(),
    store = new Store(root),
    b = new Builds(store, fake);
  try {
    const a = store.create({ company: "Journal" }),
      first = await build(b, a.id),
      directory = path.join(root, "builds", first);
    store.db.exec(
      `CREATE TRIGGER reject_build_delete BEFORE DELETE ON builds BEGIN SELECT RAISE(ABORT,'injected delete failure'); END;`,
    );
    assert.throws(() => b.remove(a.id, first), /injected/);
    assert.ok(b.artifact(a.id, first));
    assert.equal(
      store.db.prepare("SELECT count(*) n FROM pending_build_deletions").get()!
        .n,
      0,
    );
    auto(store, true);
    const good = await build(b, a.id);
    assert.equal(store.build(a.id, good).status, "success");
    assert.match(
      String(store.build(a.id, good).log),
      /Bereinigung fehlgeschlagen/,
    );
    assert.ok(b.artifact(a.id, first));
    store.db.exec("DROP TRIGGER reject_build_delete");
    auto(store, false);
    const rm = fs.rmSync;
    const fault = t.mock.method(fs, "rmSync", ((
      target: fs.PathLike,
      options: fs.RmOptions,
    ) => {
      if (String(target) === directory)
        throw Error("injected file cleanup failure");
      return rm(target, options);
    }) as typeof fs.rmSync);
    assert.deepEqual(b.remove(a.id, first), { ok: true, cleanupPending: true });
    assert.throws(() => store.build(a.id, first), status(404));
    assert.equal(fs.existsSync(directory), true);
    fault.mock.restore();
    new Builds(store, fake);
    assert.equal(fs.existsSync(directory), false);
    assert.equal(
      store.db.prepare("SELECT count(*) n FROM pending_build_deletions").get()!
        .n,
      0,
    );
    assert.ok(b.artifact(a.id, good));
  } finally {
    await b.idle();
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
