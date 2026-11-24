import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import http from "node:http";
import { createApp } from "../server/app.ts";
import { cvModRoutes } from "../server/cv-mod-prototype/routes.ts";
import { zipSync } from "fflate";
import { CvModImports } from "../server/cv-mod-prototype/imports.ts";
import { Store } from "../server/store.ts";
import { parseLiteralLua } from "../server/lua-profile.ts";

const tex = Buffer.from(
  "\\documentclass{article}\\begin{document}Original\\end{document}",
);
const zip = (files: Record<string, Buffer>) => Buffer.from(zipSync(files));
function fixture(profile = true) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "template-onboarding-"));
  let calls = 0;
  const imports = new CvModImports(
    path.join(root, "imports"),
    {
      generate: async (workspace, onThread) => {
        calls++;
        fs.writeFileSync(
          path.join(workspace, "mod/main.tex"),
          "derived layout",
        );
        fs.writeFileSync(
          path.join(workspace, "mod/mod.json"),
          JSON.stringify({
            format: "bewerbung-cv-form-v2",
            engine: "lualatex",
            entrypoint: "main.tex",
            form: [{ type: "text", key: "body", label: "Body", target: "pdf" }],
            ...(profile
              ? { applicant: { fields: {}, signature: "none" } }
              : {}),
          }),
        );
        onThread("same-native-thread", "https://example.invalid/thread");
      },
      assertFinished: async () => {},
    },
    async (input, output) => {
      fs.writeFileSync(
        path.join(output, "document.pdf"),
        "%PDF-1.4\ncontrolled compiler boundary",
      );
      const data = parseLiteralLua(
        fs.readFileSync(path.join(input, "cv-data.lua"), "utf8"),
      ) as {
        values: { body: string };
      };
      return { text: data.values.body, log: "controlled compiler boundary" };
    },
  );
  return {
    root,
    imports,
    calls: () => calls,
    close: async () => {
      await imports.close();
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

test("ambiguous main sources cannot start a model before explicit selection", async () => {
  const f = fixture();
  try {
    const job = f.imports.upload(
      "two.zip",
      zip({ "one.tex": tex, "two.tex": tex }),
      "cv-template",
    );
    assert.throws(() => f.imports.start(job.id), /Hauptdatei/);
    assert.equal(f.calls(), 0);
    assert.equal(f.imports.get(job.id).status, "uploaded");
    f.imports.selectSource(job.id, "two.tex", job.updated);
    f.imports.start(job.id);
    await f.imports.idle();
    assert.equal(f.calls(), 1);
    assert.equal(
      JSON.parse(
        fs.readFileSync(
          path.join(f.root, "imports", job.id, "workspace/IMPORT-SOURCE.json"),
          "utf8",
        ),
      ).entrypoint,
      "two.tex",
    );
    assert.deepEqual(
      f.imports.originalUpload(job.id).bytes,
      zip({ "one.tex": tex, "two.tex": tex }),
    );
  } finally {
    await f.close();
  }
});

test("retrying an upload receipt reuses one import, rejects changed input, and never restarts its model", async () => {
  const f = fixture();
  try {
    const requestId = randomUUID();
    const first = f.imports.upload("cv.tex", tex, "cv-template", undefined, {
      requestId,
    });
    assert.equal(f.calls(), 0);
    const retry = () =>
      f.imports.upload("cv.tex", tex, "cv-template", undefined, { requestId });
    assert.equal(retry().id, first.id);
    assert.throws(
      () =>
        f.imports.upload("other.tex", tex, "cv-template", undefined, {
          requestId,
        }),
      /ander/,
    );
    f.imports.start(first.id);
    f.imports.start(first.id);
    await f.imports.idle();
    assert.equal(retry().id, first.id);
    assert.equal(retry().status, "review");
    assert.equal(f.calls(), 1);
    assert.equal(f.imports.list().length, 1);
  } finally {
    await f.close();
  }
});

test("human approval gates new bindings, is version-specific, survives reopening, and never unbinds existing documents", async () => {
  const f = fixture();
  const store = new Store(path.join(f.root, "business"));
  store.cv.forms.resolveImported = (id) => f.imports.reviewedForm(id);
  store.cv.assertModUsable = (id) => f.imports.assertUsable(id);
  try {
    const job = f.imports.upload("cv.tex", tex, "cv-template");
    f.imports.start(job.id);
    await f.imports.idle();
    const checked = f.imports.get(job.id),
      first = checked.versionId!;
    const app = store.create({ company: "Example", role: "Engineer" });
    assert.throws(
      () => store.cv.bind(app.id, app.revision, first),
      /freigegeben/,
    );
    assert.throws(() => f.imports.approve(job.id, first, "stale"), /geändert/);
    f.imports.approve(job.id, first, checked.updated);
    assert.equal(f.calls(), 1);
    const bound = store.cv.bind(app.id, store.app(app.id).revision, first);
    assert.equal(bound.modId, first);
    f.imports.recheck(job.id);
    await f.imports.idle();
    const second = f.imports.get(job.id).versionId!;
    assert.notEqual(first, second);
    assert.equal(store.cv.read(app.id).modId, first);
    assert.throws(
      () => store.cv.bind(app.id, store.app(app.id).revision, second),
      /freigegeben/,
    );
    f.imports.assertUsable(first);
    assert.throws(
      () => f.imports.approve(job.id, first, f.imports.get(job.id).updated),
      /Prüfstand/,
    );
    const reopened = new CvModImports(
      path.join(f.root, "imports"),
      {
        generate: async () => {
          throw Error("No generation");
        },
        assertFinished: async () => {},
      },
      async () => {
        throw Error("No build");
      },
    );
    try {
      reopened.assertUsable(first);
      assert.throws(() => reopened.assertUsable(second), /freigegeben/);
    } finally {
      await reopened.close();
    }
  } finally {
    store.close();
    await f.close();
  }
});

test("new imports require profile metadata for approval while preexisting unbound mods remain compatible", async () => {
  const f = fixture(false);
  try {
    const job = f.imports.upload("old-compatible.tex", tex, "cv-template");
    f.imports.start(job.id);
    await f.imports.idle();
    const checked = f.imports.get(job.id);
    assert.throws(
      () => f.imports.approve(job.id, checked.versionId, checked.updated),
      /Profilbindung/,
    );
    delete checked.reviewWorkflow;
    f.imports.db
      .prepare("UPDATE jobs SET value=? WHERE id=?")
      .run(JSON.stringify(checked), job.id);
    f.imports.approve(job.id, checked.versionId, checked.updated);
    f.imports.assertUsable(checked.versionId!);
    assert.equal(f.calls(), 1);
  } finally {
    await f.close();
  }
});

test("the library exposes only approved immutable stands and labels never replace original filenames or trigger generation", async () => {
  const f = fixture();
  try {
    const job = f.imports.upload("cv.tex", tex, "cv-template");
    assert.deepEqual(f.imports.catalogue(), []);
    f.imports.start(job.id);
    await f.imports.idle();
    const first = f.imports.get(job.id);
    assert.deepEqual(f.imports.catalogue(), []);
    f.imports.approve(job.id, first.versionId, first.updated);
    const approved = f.imports.get(job.id);
    f.imports.rename(job.id, "Distinct CV layout", approved.updated);
    assert.equal(f.imports.get(job.id).name, "cv.tex");
    assert.deepEqual(f.imports.originalUpload(job.id).bytes, tex);
    assert.equal(f.imports.catalogue()[0]!.label, "Distinct CV layout");
    assert.equal(f.imports.catalogue()[0]!.kind, "cv");
    assert.equal(
      f.imports.selectLayout("cv", first.versionId!),
      first.versionId,
    );
    assert.throws(
      () => f.imports.selectLayout("cover", first.versionId!),
      /Dokumenttyp/,
    );
    assert.throws(
      () => f.imports.rename(job.id, "", f.imports.get(job.id).updated),
      /Vorlagenname/,
    );
    assert.throws(() => f.imports.rename(job.id, "Wrong", "stale"), /geändert/);
    f.imports.recheck(job.id);
    await f.imports.idle();
    assert.deepEqual(
      f.imports.catalogue().map((row) => row.versionId),
      [first.versionId],
    );
    const second = f.imports.get(job.id);
    f.imports.approve(job.id, second.versionId, second.updated);
    assert.equal(f.imports.catalogue().length, 2);
    const packageFile = path.join(
      f.root,
      "imports",
      job.id,
      "builds",
      first.buildId!,
      "package/main.tex",
    );
    fs.appendFileSync(packageFile, "tampered checked package");
    const old = f.imports
      .catalogue()
      .find((row) => row.versionId === first.versionId)!;
    assert.equal(old.available, false);
    assert.match(old.error!, /verändert/);
    assert.equal(
      f.imports.catalogue().find((row) => row.versionId === second.versionId)!
        .available,
      true,
    );
    assert.equal(f.calls(), 1);
  } finally {
    await f.close();
  }
});

test("source inspection distinguishes companions, ambiguous mains and invalid inputs without creating jobs", async () => {
  const f = fixture();
  try {
    const source = Buffer.from(
      "\\documentclass{article}\n\\graphicspath{{images/}}\n\\input{parts/header}\n\\includegraphics{logo}\n\\includegraphics{missing}\n\\addbibresource{literature.bib}\n% \\input{commented}\n",
    );
    const inspected = f.imports.inspect(
      "bundle.zip",
      zip({
        "project/main.tex": source,
        "project/parts/header.tex": Buffer.from("Header"),
        "project/images/logo.png": Buffer.from("asset"),
        "project/literature.bib": Buffer.from("entry"),
      }),
    );
    assert.deepEqual(inspected.entrypoints, ["main.tex"]);
    assert.equal(inspected.warnings.length, 1);
    assert.match(inspected.warnings[0]!, /main.tex: missing.*includegraphics/);
    assert.equal(f.imports.inspect("main.tex", source).warnings.length, 4);
    assert.throws(
      () => f.imports.inspect("file.pdf", Buffer.from("%PDF-")),
      /LaTeX/,
    );
    assert.throws(
      () => f.imports.inspect("bad.zip", Buffer.from("not a ZIP")),
      /ZIP/,
    );
    assert.throws(() => f.imports.inspect("empty.tex", Buffer.alloc(0)), /TeX/);
    assert.throws(
      () => f.imports.inspect("large.tex", Buffer.alloc(4 * 1024 * 1024 + 1)),
      /4 MiB/,
    );
    assert.throws(
      () => f.imports.inspect("bad.tex", Buffer.from("no main")),
      /Hauptdatei/,
    );
    assert.deepEqual(f.imports.list(), []);
    assert.equal(f.calls(), 0);
  } finally {
    await f.close();
  }
});

test("questions and missing dependencies resume in the same native thread without generation on recheck", async () => {
  const f = fixture();
  try {
    const job = f.imports.upload("missing.tex", tex, "cv-template");
    const questions = path.join(
      f.root,
      "imports",
      job.id,
      "workspace/NEEDS-INPUT.md",
    );
    fs.writeFileSync(
      questions,
      "Bitte logo.png und ein ausgefülltes Briefbeispiel im vorhandenen Thread nachreichen.",
    );
    f.imports.start(job.id);
    await f.imports.idle();
    const waiting = f.imports.get(job.id);
    assert.equal(waiting.status, "needs-input");
    assert.equal(waiting.versionId, undefined);
    assert.match(waiting.error!, /logo.png/);
    fs.unlinkSync(questions);
    f.imports.recheck(job.id);
    await f.imports.idle();
    const checked = f.imports.get(job.id);
    assert.equal(checked.status, "review");
    assert.equal(checked.threadId, waiting.threadId);
    assert.equal(checked.threadUrl, waiting.threadUrl);
    assert.equal(f.calls(), 1);
    assert.deepEqual(f.imports.originalUpload(job.id).bytes, tex);
  } finally {
    await f.close();
  }
});

test("native-session HTTP flow protects inspection, preserves receipts and enforces approval before binding", async () => {
  const f = fixture(),
    server = http.createServer();
  server.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}`;
  const app = createApp(
    path.join(f.root, "http"),
    async () => "",
    address.port,
    undefined,
    {
      configureApi: (api) =>
        cvModRoutes(api, f.imports, {
          publicOrigin: origin,
          cookieName: "owner",
          token: async () => "synthetic-session",
        }),
    },
  );
  app.store.cv.forms.resolveImported = (id) => f.imports.reviewedForm(id);
  app.store.cv.assertModUsable = (id) => f.imports.assertUsable(id);
  server.on("request", app.web);
  const headers = {
    cookie: "owner=synthetic-session",
    "content-type": "application/json",
    "x-bewerbung-request": "1",
  };
  const post = (route: string, body: unknown, extra = {}) =>
    fetch(origin + "/bewerbung/api" + route, {
      method: "POST",
      headers: { ...headers, ...extra },
      body: JSON.stringify(body),
    });
  const body = {
    name: "main.tex",
    zipBase64: tex.toString("base64"),
    documentType: "cv-template",
    requestId: randomUUID(),
  };
  try {
    assert.equal(
      (
        await fetch(origin + "/bewerbung/api/cv-mods/inspect", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-bewerbung-request": "1",
          },
          body: JSON.stringify(body),
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await post("/cv-mods/inspect", body, {
          authorization: "Bearer restricted",
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await post("/cv-mods/inspect", body, {
          origin: "https://foreign.invalid",
        })
      ).status,
      403,
    );
    const inspection = await post("/cv-mods/inspect", body);
    assert.equal(inspection.status, 200);
    assert.deepEqual((await inspection.json()).entrypoints, ["main.tex"]);
    assert.equal(f.imports.list().length, 0);
    assert.equal(
      (await post("/cv-mods/jobs", { ...body, documentType: "document" }))
        .status,
      400,
    );
    const created = await post("/cv-mods/jobs", body);
    assert.equal(created.status, 201);
    const job = await created.json();
    assert.equal((await (await post("/cv-mods/jobs", body)).json()).id, job.id);
    assert.equal(f.calls(), 0);
    assert.equal((await post(`/cv-mods/jobs/${job.id}/start`, {})).status, 202);
    await f.imports.idle();
    const checked = f.imports.get(job.id);
    const application = app.store.create({
      company: "Synthetic",
      role: "HTTP",
    });
    const bind = () =>
      fetch(origin + `/bewerbung/api/applications/${application.id}/cv-mod`, {
        method: "PUT",
        headers,
        body: JSON.stringify({
          revision: app.store.app(application.id).revision,
          modId: checked.versionId,
        }),
      });
    assert.equal((await bind()).status, 409);
    assert.equal(
      (
        await post(`/cv-mods/jobs/${job.id}/approve`, {
          versionId: checked.versionId,
          updated: "stale",
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await post(
          `/cv-mods/jobs/${job.id}/approve`,
          { versionId: checked.versionId, updated: checked.updated },
          { authorization: "Bearer restricted" },
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await post(`/cv-mods/jobs/${job.id}/approve`, {
          versionId: checked.versionId,
          updated: checked.updated,
        })
      ).status,
      200,
    );
    assert.equal((await bind()).status, 200);
    assert.equal(f.calls(), 1);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await app.close();
    await f.close();
  }
});
