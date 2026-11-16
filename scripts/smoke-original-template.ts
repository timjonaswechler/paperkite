// Read an immutable master, build in disposable storage, export for local Poppler checks.
// No production application, template, reference PDF or installed host tool is modified.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { Store } from "../server/store.ts";
import { Builds, dockerRunner } from "../server/builds.ts";
import { fileMap } from "../server/files.ts";
const master = process.env.BEWERBUNG_MASTER_DIR;
const reference = process.env.BEWERBUNG_REFERENCE_PDF;
const artifacts = process.env.SMOKE_ARTIFACTS;
assert.ok(
  master && reference,
  "Explicit immutable master directory and reference PDF required",
);
assert.ok(
  artifacts &&
    path.resolve(artifacts).startsWith(path.join(os.tmpdir(), "bewerbung-")),
  "Disposable /tmp/bewerbung-* artifact directory required",
);
const root = fs.mkdtempSync(
  path.join(os.tmpdir(), "bewerbung-original-template-"),
);
const store = new Store(root);
const builds = new Builds(
  store,
  dockerRunner(fs.readFileSync("builder/image-id", "utf8").trim()),
);
try {
  const source = fileMap(master);
  const imported = store.import({
    format: "bewerbung-template-v1",
    files: Object.fromEntries(
      Object.entries(source).map(([name, data]) => [
        name,
        data.toString("base64"),
      ]),
    ),
  });
  const application = store.create({
    company: "Isolated original-template verification",
    role: "Verification only",
    template: imported.id,
  });
  assert.equal(application.profile, "general");
  const cv = builds.request(application.id, "cv"),
    cover = builds.request(application.id, "cover");
  await builds.idle();
  for (const build of [cv, cover])
    assert.equal(
      store.build(application.id, String(build.id)).status,
      "success",
      String(store.build(application.id, String(build.id)).log),
    );
  for (const [name, bytes] of Object.entries(source))
    assert.deepEqual(fs.readFileSync(path.join(master, name)), bytes);
  fs.mkdirSync(artifacts, { recursive: true, mode: 0o700 });
  assert.ok(!fs.lstatSync(artifacts).isSymbolicLink());
  fs.copyFileSync(
    builds.artifact(application.id, String(cv.id)),
    path.join(artifacts, "built-cv.pdf"),
  );
  fs.copyFileSync(
    builds.artifact(application.id, String(cover.id)),
    path.join(artifacts, "built-cover.pdf"),
  );
  fs.copyFileSync(reference, path.join(artifacts, "reference-cv.pdf"));
  console.log(
    `PASS real isolated master CV/cover builds: ${Object.keys(source).length} source files unchanged, general selected. PDFs exported for local Poppler checks: ${artifacts}`,
  );
} finally {
  await builds.idle();
  store.close();
  fs.rmSync(root, { recursive: true, force: true });
}
