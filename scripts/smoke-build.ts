import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { Store } from "../server/store.ts";
import { Builds, dockerRunner } from "../server/builds.ts";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "bewerbung-tex-smoke-"));
const store = new Store(root),
  builds = new Builds(
    store,
    dockerRunner(fs.readFileSync("builder/image-id", "utf8").trim()),
  );
try {
  const text: Record<string, string> = {
    "cv/Lebenslauf.tex": String.raw`\documentclass{article}
\usepackage{fontspec}
\setmainfont{Latin Modern Roman}
\begin{document}
Synthetic application, no personal data.\par
\directlua{dofile('lua/loader.lua')}
\end{document}`,
    "cv/lua/loader.lua":
      "local p = dofile('profiles/' .. os.getenv('CV_PROFILE') .. '.lua'); tex.print(p.label)",
    "cv/profiles/test.lua": 'return {label = "CV-PROFILE-TEST"}',
  };
  const template = store.import({
    format: "bewerbung-template-v1",
    files: Object.fromEntries(
      Object.entries(text).map(([p, s]) => [
        p,
        Buffer.from(s).toString("base64"),
      ]),
    ),
  });
  const app = store.create({
    company: "Synthetic TeX test",
    template: template.id,
  });
  const cv = builds.request(app.id, "cv"),
    cover = builds.request(app.id, "cover");
  await builds.idle();
  for (const b of [cv, cover]) {
    const result = store.build(app.id, String(b.id));
    if (result.status !== "success") console.error(result.log);
    assert.equal(result.status, "success");
    assert.ok(fs.statSync(builds.artifact(app.id, String(b.id))).size > 500);
    console.log("PASS isolated real " + b.kind + " PDF, two passes");
  }
  const good = fs.readFileSync(builds.artifact(app.id, String(cv.id)));
  store.save(
    app.id,
    "cv/Lebenslauf.tex",
    "\\undefinedcommand",
    store.app(app.id).revision,
  );
  const failed = builds.request(app.id, "cv");
  await builds.idle();
  assert.equal(store.build(app.id, String(failed.id)).status, "failed");
  assert.deepEqual(
    fs.readFileSync(builds.artifact(app.id, String(cv.id))),
    good,
  );
  console.log("PASS real compile failure retains previous good artifact");
} finally {
  store.close();
  fs.rmSync(root, { recursive: true, force: true });
}
