import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { createApp } from "../server/app.ts";

test("workflow HTTP wiring: tags, template operations, PDF plans/jobs and per-app deletion exclusion while only that app closes", async () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "bewerbung-workflow-http-"),
  );
  let releasePdf!: () => void;
  const pdfGate = new Promise<void>((resolve) => (releasePdf = resolve));
  const app = createApp(
    root,
    async () => "",
    3151,
    async (_input, out) => {
      await pdfGate;
      fs.writeFileSync(path.join(out, "result.pdf"), "%PDF-1.7\nRESULT");
      return { pages: 1 };
    },
  );
  const server = app.web.listen(3151, "127.0.0.1");
  await once(server, "listening");
  const base = "http://127.0.0.1:3151/bewerbung/api";
  const api = (route: string, method = "GET", body?: unknown) =>
    fetch(base + route, {
      method,
      headers:
        method === "GET"
          ? {}
          : { "Content-Type": "application/json", "X-Bewerbung-Request": "1" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  let releaseDeletion = () => {};
  let pendingDeletion: Promise<Response> | undefined;
  try {
    assert.equal((await (await api("/health")).json()).pdfProcessing, true);
    const source = await (
      await api("/templates/import", "POST", {
        format: "bewerbung-template-v1",
        files: Object.fromEntries(
          Object.entries({
            "cv/Lebenslauf.tex": "CV",
            "cv/lua/loader.lua": "return {}",
            "cv/profiles/general.lua": "return {}",
          }).map(([k, v]) => [k, Buffer.from(v).toString("base64")]),
        ),
      })
    ).json();
    const a = await (
      await api("/applications", "POST", {
        company: "A",
        role: "Engineer",
        template: source.id,
      })
    ).json();
    const b = await (
      await api("/applications", "POST", { company: "B", role: "Engineer" })
    ).json();
    const saved = await (
      await api("/templates/from-application", "POST", {
        source: a.id,
        label: "Named source",
      })
    ).json();
    assert.equal(saved.label, "Named source");
    assert.equal(
      (await api(`/templates/${saved.id}`, "PATCH", { label: "Renamed" }))
        .status,
      200,
    );
    assert.equal(
      (await api(`/templates/${saved.id}/default`, "POST", {})).status,
      200,
    );
    assert.equal(
      (await (await api("/templates")).json()).find(
        (t: { isDefault: boolean }) => t.isDefault,
      ).id,
      saved.id,
    );
    const exported = await (await api(`/templates/${saved.id}/export`)).json();
    assert.equal(exported.format, "bewerbung-template-v1");
    assert.ok(!exported.files["application.json"]);
    assert.equal(
      (await api(`/templates/${saved.id}`, "DELETE", { digest: "old" })).status,
      409,
    );
    assert.equal(
      (await api(`/templates/${saved.id}`, "DELETE", { digest: saved.digest }))
        .status,
      200,
    );
    assert.equal(app.store.read(a.id, "cv/Lebenslauf.tex").toString(), "CV");
    const doc = app.store.documents.upload(
      "Certificate.pdf",
      Buffer.from("%PDF-1.7\nORIGINAL"),
    );
    assert.equal(
      (
        await api(`/documents/${doc.id}`, "PATCH", {
          tags: [" Beruf ", "BERUF", "Studium"],
        })
      ).status,
      200,
    );
    assert.deepEqual(
      (await (await api("/documents?tag=STUDIUM")).json()).map(
        (d: { id: string }) => d.id,
      ),
      [doc.id],
    );
    let entered!: () => void, release!: () => void;
    const began = new Promise<void>((resolve) => (entered = resolve)),
      gate = new Promise<void>((resolve) => {
        release = resolve;
        releaseDeletion = resolve;
      });
    const originalClose = app.harness.closeApp.bind(app.harness);
    const closed: string[] = [];
    app.harness.closeApp = async (id: string) => {
      closed.push(id);
      entered();
      await gate;
      await originalClose(id);
    };
    let unexpected = 0;
    app.harness.prompt = async () => {
      unexpected++;
      throw new Error("Native prompts must not run in this test");
    };
    app.harness.models = async () => {
      unexpected++;
      throw new Error("Native catalogs must not run in this test");
    };
    assert.equal(
      (await api(`/applications/${a.id}`, "DELETE", { revision: 0 })).status,
      409,
    );
    const deleting = api(`/applications/${a.id}`, "DELETE", {
      revision: a.revision,
    });
    pendingDeletion = deleting;
    await began;
    for (const route of ["prompt", "models"])
      assert.equal(
        (
          await api(`/applications/${a.id}/${route}`, "POST", {
            text: "not sent",
          })
        ).status,
        409,
      );
    assert.equal(
      (
        await api("/pdf-jobs", "POST", {
          appId: a.id,
          items: [{ kind: "document", id: doc.id }],
          compression: "lossless",
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await api(`/applications/${b.id}`, "PATCH", {
          revision: b.revision,
          notes: "Other app remains editable",
        })
      ).status,
      200,
    );
    assert.equal(unexpected, 0);
    release();
    assert.equal((await deleting).status, 200);
    assert.deepEqual(closed, [a.id]);
    assert.equal((await api(`/applications/${a.id}`)).status, 404);
    assert.equal((await api(`/documents/${doc.id}/file`)).status, 200);
    const current = app.store.app(b.id);
    app.store.update(b.id, {
      revision: current.revision,
      documentIds: [doc.id],
    });
    const plan = await (await api(`/applications/${b.id}/pdf-plan`)).json();
    assert.equal(plan.revision, 0);
    assert.equal(
      (
        await api(`/applications/${b.id}/pdf-plan`, "PUT", {
          revision: 0,
          items: [{ kind: "document", id: doc.id, pages: "1" }],
          compression: "lossless",
          excluded: [],
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await api(`/applications/${b.id}/pdf-plan`, "PUT", {
          revision: 0,
          items: [],
          compression: "compact",
        })
      ).status,
      409,
    );
    const jobResponse = await api("/pdf-jobs", "POST", {
      appId: b.id,
      items: [{ kind: "document", id: doc.id }],
      compression: "lossless",
    });
    assert.equal(jobResponse.status, 202);
    const job = await jobResponse.json();
    assert.equal(
      (
        await api(`/applications/${b.id}`, "DELETE", {
          revision: app.store.app(b.id).revision,
        })
      ).status,
      409,
    );
    releasePdf();
    await app.pdfs.idle();
    assert.equal(
      (await (await api(`/pdf-jobs/${job.id}`)).json()).status,
      "success",
    );
    const artifact = await api(`/pdf-jobs/${job.id}/file?download=1`);
    assert.match(artifact.headers.get("content-type")!, /application\/pdf/);
    assert.equal(artifact.headers.get("x-content-type-options"), "nosniff");
    const derivative = await api(`/pdf-jobs/${job.id}/save`, "POST", {
      label: "New derived",
      tags: ["Paket"],
    });
    assert.equal(derivative.status, 201);
    assert.deepEqual((await derivative.json()).tags, ["paket"]);
    assert.equal(
      (await (await api(`/applications/${b.id}/pdf-jobs`)).json()).length,
      1,
    );
    assert.equal((await (await api("/pdf-jobs")).json()).length, 0);
    assert.equal(
      (
        await api(`/applications/${b.id}`, "DELETE", {
          revision: app.store.app(b.id).revision,
        })
      ).status,
      200,
    );
    assert.equal((await api(`/pdf-jobs/${job.id}`)).status, 404);
    assert.equal(fs.existsSync(path.join(root, "pdf-jobs", job.id)), false);
    assert.equal(app.store.documents.list().length, 2);
  } finally {
    releaseDeletion();
    releasePdf();
    await pendingDeletion?.catch(() => {});
    server.close();
    await app.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
