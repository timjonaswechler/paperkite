import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { unzipSync } from "fflate";
import { createApp } from "../server/app.ts";

const pdf = (text: string) => Buffer.from("%PDF-1.7\n" + text);
test("organization HTTP routes protect binary uploads, create only validated applications and export only chosen deliverables", async () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "bewerbung-organization-http-"),
  );
  const app = createApp(
    root,
    async (_input, output, kind) => {
      fs.writeFileSync(
        path.join(output, "document.pdf"),
        pdf("Synthetic " + kind),
      );
      return "Synthetic build log";
    },
    3128,
  );
  const server = app.web.listen(3128, "127.0.0.1");
  await once(server, "listening");
  const base = "http://127.0.0.1:3128/bewerbung/api";
  const headers = {
    "Content-Type": "application/json",
    "X-Bewerbung-Request": "1",
  };
  const json = (p: string, method = "GET", body?: unknown) =>
    fetch(base + p, {
      method,
      headers: method === "GET" ? {} : headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const upload = (
    name: string,
    bytes: Buffer,
    extra: Record<string, string> = {},
  ) =>
    fetch(base + "/documents", {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-Bewerbung-Request": "1",
        "X-Bewerbung-Filename": encodeURIComponent(name),
        ...extra,
      },
      body: Uint8Array.from(bytes),
    });
  try {
    const defaults = await (await json("/settings")).json();
    assert.deepEqual(Object.keys(defaults).sort(), [
      "analysisModel",
      "applicantName",
      "autoBuild",
      "autoPruneBuilds",
      "collapsedStatuses",
      "revision",
    ]);
    for (const patch of [
      { theme: "dark" },
      { defaultProvider: "codex" },
      { sendOnEnter: true },
    ]) {
      assert.equal(
        (
          await json("/settings", "PUT", {
            revision: defaults.revision,
            ...patch,
          })
        ).status,
        400,
      );
      assert.deepEqual(await (await json("/settings")).json(), defaults);
    }
    assert.equal(
      (
        await json("/settings", "PUT", {
          revision: defaults.revision,
          autoBuild: true,
          autoPruneBuilds: false,
        })
      ).status,
      200,
    );
    const certificate = pdf("Private synthetic certificate");
    const uploaded = await upload("Prüfungszeugnis.pdf", certificate);
    assert.equal(uploaded.status, 201);
    const document = await uploaded.json();
    const duplicate = await (
      await upload("Zweite Datei.pdf", certificate)
    ).json();
    assert.equal(duplicate.id, document.id);
    assert.equal(duplicate.duplicate, true);
    assert.equal(app.store.documents.list().length, 1);
    assert.equal(
      (
        await upload("evil.pdf", pdf("Other"), {
          Origin: "https://evil.example",
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await upload("missing-header.pdf", pdf("Other"), {
          "X-Bewerbung-Request": "",
        })
      ).status,
      415,
    );
    assert.equal(
      (await upload("evil.pdf", Buffer.from("<html>not a PDF</html>"))).status,
      400,
    );
    assert.equal(
      (await json("/documents", "POST", { text: "not binary" })).status,
      415,
    );
    assert.equal(
      (await upload("large.pdf", Buffer.alloc(25 * 1024 * 1024 + 1))).status,
      413,
    );
    assert.equal(app.store.documents.list().length, 1);
    for (const [body, status] of [
      [{}, 400],
      [{ company: "A" }, 400],
      [{ company: " ", role: "B" }, 400],
      [{ company: "A", role: "B", cvSource: {} }, 400],
      [
        {
          company: "A",
          role: "B",
          documentIds: ["00000000-0000-4000-8000-000000000000"],
        },
        404,
      ],
    ] as const)
      assert.equal((await json("/applications", "POST", body)).status, status);
    assert.equal(app.store.list().length, 0);
    const response = await json("/applications", "POST", {
      company: "Test GmbH",
      role: "Ingenieur",
      documentIds: [document.id],
    });
    assert.equal(response.status, 201);
    const created = await response.json();
    const detail = await (await json("/applications/" + created.id)).json();
    assert.equal(detail.harness.provider, "pi");
    assert.equal(
      app.store.db
        .prepare("SELECT provider FROM harness_choice WHERE app=?")
        .get(created.id),
      undefined,
    );
    assert.deepEqual(
      detail.documents.map((entry: { id: string }) => entry.id),
      [document.id],
    );
    assert.deepEqual((await (await json("/ui-state")).json()).openIds, [
      created.id,
    ]);
    assert.equal(
      (
        await json(`/applications/${created.id}/draft`, "PUT", {
          text: "Noch nicht gesendet",
        })
      ).status,
      200,
    );
    assert.equal(
      (await (await json(`/applications/${created.id}/draft`)).json()).text,
      "Noch nicht gesendet",
    );
    const copyResponse = await json("/applications", "POST", {
      company: "Kopie GmbH",
      role: "Andere Rolle",
      source: created.id,
    });
    assert.equal(copyResponse.status, 201);
    const copy = await copyResponse.json();
    assert.equal(
      (await (await json(`/applications/${copy.id}/draft`)).json()).text,
      "",
    );
    assert.deepEqual(app.store.documents.ids(copy.id), [document.id]);
    assert.equal(
      app.store.db
        .prepare("SELECT COUNT(*) AS count FROM codex_sessions")
        .get()!.count,
      0,
    );
    const delivered = await json(`/documents/${document.id}/file?download=1`);
    assert.equal(delivered.status, 200);
    assert.match(
      delivered.headers.get("content-type") || "",
      /application\/pdf/,
    );
    assert.equal(delivered.headers.get("x-content-type-options"), "nosniff");
    assert.deepEqual(Buffer.from(await delivered.arrayBuffer()), certificate);
    for (const kind of ["cv", "cover"]) {
      const queued = await json(`/applications/${created.id}/builds`, "POST", {
        kind,
      });
      assert.equal(queued.status, 202);
    }
    await app.builds.idle();
    const archive = await json(`/applications/${created.id}/package`);
    assert.equal(archive.status, 200);
    const contents = unzipSync(new Uint8Array(await archive.arrayBuffer()));
    assert.deepEqual(Object.keys(contents).sort(), [
      "Anlagen/01_Prüfungszeugnis.pdf",
      "Anschreiben.pdf",
      "Lebenslauf.pdf",
    ]);
    assert.deepEqual(
      Buffer.from(contents["Anlagen/01_Prüfungszeugnis.pdf"]),
      certificate,
    );
    assert.deepEqual(
      Buffer.from(contents["Lebenslauf.pdf"]),
      pdf("Synthetic cv"),
    );
    const build = app.store
      .builds(created.id)
      .find((entry) => entry.kind === "cv")!;
    assert.equal(
      (await json(`/applications/${copy.id}/builds/${build.id}/zip`)).status,
      404,
    );
    assert.equal(
      (
        await json(`/applications/${created.id}`, "PATCH", {
          revision: created.revision,
          documentIds: [],
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await json(`/applications/${copy.id}`, "PATCH", {
          revision: copy.revision,
          documentIds: [],
        })
      ).status,
      200,
    );
    assert.equal(
      (await json(`/documents/${document.id}`, "PATCH", { label: "Umbenannt" }))
        .status,
      200,
    );
    assert.equal(
      (await json(`/documents/${document.id}`, "DELETE", {})).status,
      409,
    );
    const frozenResponse = await json(
      `/applications/${created.id}/builds/${build.id}/zip`,
    );
    const frozen = unzipSync(
      new Uint8Array(await frozenResponse.arrayBuffer()),
    );
    assert.deepEqual(
      Buffer.from(frozen["Anlagen/01_Prüfungszeugnis.pdf"]),
      certificate,
    );
    assert.equal(
      Object.keys(
        unzipSync(
          new Uint8Array(
            await (
              await json(`/applications/${created.id}/package`)
            ).arrayBuffer(),
          ),
        ),
      ).length,
      2,
    );
    assert.equal(
      (await json(`/applications/${created.id}/close`, "POST", {})).status,
      200,
    );
    assert.equal((await json(`/applications/${created.id}`)).status, 200);
    assert.deepEqual((await (await json("/ui-state")).json()).openIds, [
      copy.id,
    ]);
    assert.equal(
      (await json(`/applications/${created.id}/open`, "POST", {})).status,
      200,
    );
    assert.deepEqual((await (await json("/ui-state")).json()).openIds, [
      created.id,
      copy.id,
    ]);
    assert.deepEqual(
      (await (await json("/search?q=KOPIE&status=In%20Arbeit")).json()).map(
        (entry: { id: string }) => entry.id,
      ),
      [copy.id],
    );
    assert.equal(
      (await json(`/applications/00000000-0000-4000-8000-000000000000/package`))
        .status,
      404,
    );
  } finally {
    server.close();
    await app.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
