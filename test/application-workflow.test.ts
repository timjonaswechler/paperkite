import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { unzipSync } from "fflate";
import { createApp } from "../server/app.ts";
import { encodeCover, decodeCover } from "../server/cover-letter.ts";
import { deliveryFilename } from "../server/deliveries.ts";

const pdf = (text: string) => Buffer.from("%PDF-1.7\n" + text);
const letter = {
  sender: "Ada Example\nMusterweg 1",
  recipient: "Acme GmbH",
  subject: "Bewerbung als Engineer",
  salutation: "Sehr geehrte Damen und Herren,",
  body: "Ich arbeite mit C++ & C# und erreiche 100%.\n\n\\input{private} ist hier nur Text.",
  closing: "Mit freundlichen Grüßen",
};
const template = {
  format: "bewerbung-template-v1",
  files: Object.fromEntries(
    Object.entries({
      "cv/Lebenslauf.tex": "Synthetic CV",
      "cv/lua/loader.lua": "return {}",
      "cv/profiles/general.lua":
        'return { personal = { name = "Ada" }, experience = {}, engagement = {}, skills = {}, custom = "keep" }',
    }).map(([name, text]) => [name, Buffer.from(text).toString("base64")]),
  ),
};

test("plain letter round-trips exactly and escapes TeX commands instead of executing user text", () => {
  const source = encodeCover(letter);
  assert.deepEqual(decodeCover(source), letter);
  const edited = source.replace("und erreiche", "und erzielte");
  assert.notEqual(edited, source);
  assert.equal(
    decodeCover(edited),
    null,
    "Manual/native TeX changes must not be overwritten from stale editor metadata",
  );
  assert.match(source, /C\+\+ \\& C\\# und erreiche 100\\%/);
  assert.match(source, /\\textbackslash\{\}input\\\{private\\\}/);
  assert.doesNotMatch(source, /\n\\input\{private\}/);
  assert.throws(() => encodeCover({ ...letter, body: "bad\u0000text" }));
  assert.equal(decodeCover("Custom TeX remains custom"), null);
  assert.equal(
    deliveryFilename(
      "Bewerbung",
      "Ada Example",
      "Müller / GmbH",
      "C++ Engineer",
    ),
    "Bewerbung_Ada_Example_Muller_GmbH_C_Engineer.pdf",
  );
});

test("document workflow preserves source revisions and custom fields, builds independent current PDFs and freezes PDF/ZIP outputs", async () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "bewerbung-document-workflow-"),
  );
  const app = createApp(
    root,
    async (_input, output, kind) => {
      fs.writeFileSync(path.join(output, "document.pdf"), pdf(kind));
      return "Synthetic build";
    },
    3188,
    async (input, output) => {
      const plan = JSON.parse(
        fs.readFileSync(path.join(input, "plan.json"), "utf8"),
      );
      assert.ok(["none", "lossless", "compact"].includes(plan.compression));
      const texts = plan.items.map((item: { filename: string }) =>
        fs
          .readFileSync(path.join(input, item.filename))
          .toString("utf8")
          .slice(9),
      );
      fs.writeFileSync(path.join(output, "result.pdf"), pdf(texts.join("|")));
      return { pages: plan.items.length };
    },
    {
      analysisRunner: async (input) => {
        assert.equal(input.modelSelection?.model, "fixture-model");
        return {
          company: "Acme GmbH",
          role: "Engineer",
          requirements: ["TypeScript"],
        };
      },
    },
  );
  const server = app.web.listen(3188, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}/bewerbung/api`;
  const request = (p: string, method = "GET", body?: unknown) =>
    fetch(base + p, {
      method,
      headers: {
        ...(method !== "GET"
          ? { "Content-Type": "application/json", "X-Bewerbung-Request": "1" }
          : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  try {
    const preferences = app.store.preferences.settings();
    app.store.preferences.update({
      revision: preferences.revision,
      analysisModel: { instanceId: "fixture", model: "fixture-model" },
      applicantName: "Ada Example",
    });
    const analysis = await request("/job-analysis", "POST", {
      url: "https://jobs.example/42",
      text: "Acme GmbH sucht Software Engineer mit Erfahrung in TypeScript, Datenbanken und der Entwicklung zuverlässiger Anwendungen.",
    });
    assert.equal(analysis.status, 200);
    assert.equal((await analysis.json()).company, "Acme GmbH");
    assert.equal(
      app.store.list().length,
      0,
      "Analysis must not create a hidden chat or an application",
    );
    const master = app.store.import(template),
      record = app.store.create({
        company: "Acme GmbH",
        role: "Engineer",
        template: master.id,
      });
    const certificate = app.store.documents.upload(
      "Certificate.pdf",
      pdf("ORIGINAL-CERTIFICATE"),
    );
    app.store.update(record.id, {
      revision: record.revision,
      documentIds: [certificate.id],
    });
    const cover = await (
      await request(`/applications/${record.id}/cover-letter`)
    ).json();
    assert.equal(cover.requiresConversion, false);
    const saved = await request(
      `/applications/${record.id}/cover-letter`,
      "PUT",
      { revision: cover.revision, fields: letter },
    );
    assert.equal(saved.status, 200);
    assert.equal(
      (
        await request(`/applications/${record.id}/cover-letter`, "PUT", {
          revision: cover.revision,
          fields: letter,
        })
      ).status,
      409,
    );
    const profile = await (
      await request(
        `/applications/${record.id}/profile?path=cv/profiles/general.lua`,
      )
    ).json();
    profile.entries.personal.name = "Ada Updated";
    assert.equal(
      (
        await request(`/applications/${record.id}/profile`, "PUT", {
          revision: profile.revision,
          path: profile.path,
          entries: profile.entries,
        })
      ).status,
      200,
    );
    assert.equal(
      app.store.profile(record.id, profile.path).entries.custom,
      "keep",
    );
    app.builds.request(record.id, "cv");
    app.builds.request(record.id, "cover");
    await app.builds.idle();
    assert.deepEqual(app.builds.documentStatus(record.id), {
      cv: "current",
      cover: "current",
    });
    app.store.save(
      record.id,
      "anschreiben/Anschreiben.tex",
      encodeCover({ ...letter, body: "Updated cover only" }),
      app.store.app(record.id).revision,
    );
    assert.deepEqual(app.builds.documentStatus(record.id), {
      cv: "current",
      cover: "outdated",
    });
    const plan = app.deliveries.plan(record.id);
    assert.equal(plan.format, "pdf");
    assert.deepEqual(
      plan.outputs[0]!.items.map((item) => item.kind),
      ["build", "build", "document"],
    );
    const combined = app.deliveries.start(record.id, plan.revision);
    await app.deliveries.idle();
    assert.equal(app.deliveries.get(record.id, combined.id).status, "success");
    const combinedBytes = fs.readFileSync(
      app.deliveries.artifact(record.id, combined.id),
    );
    assert.deepEqual(combinedBytes, pdf("cover|cv|ORIGINAL-CERTIFICATE"));
    const zipPlan = app.deliveries.savePlan(record.id, {
      revision: 0,
      format: "zip",
      outputs: [
        {
          id: "original",
          label: "Zeugnis",
          mode: "original",
          compression: "none",
          items: [{ kind: "document", id: certificate.id }],
        },
        { ...plan.outputs[0], id: "combined", label: "Gesamt" },
      ],
    });
    assert.throws(
      () => app.deliveries.savePlan(record.id, { ...zipPlan, revision: 0 }),
      /inzwischen geändert/,
    );
    const zipJob = app.deliveries.start(record.id, zipPlan.revision);
    await app.deliveries.idle();
    const archive = unzipSync(
      fs.readFileSync(app.deliveries.artifact(record.id, zipJob.id)),
    );
    assert.deepEqual(Object.keys(archive).sort(), [
      "Gesamt_Ada_Example_Acme_GmbH_Engineer.pdf",
      "Zeugnis_Ada_Example_Acme_GmbH_Engineer.pdf",
    ]);
    assert.deepEqual(
      Buffer.from(archive["Zeugnis_Ada_Example_Acme_GmbH_Engineer.pdf"]!),
      pdf("ORIGINAL-CERTIFICATE"),
    );
    assert.deepEqual(
      fs.readFileSync(app.deliveries.artifact(record.id, combined.id)),
      combinedBytes,
    );
    assert.deepEqual(
      app.store.documents.bytes(certificate.id),
      pdf("ORIGINAL-CERTIFICATE"),
    );
    const other = app.store.create({ company: "Other" });
    assert.throws(
      () => app.deliveries.artifact(other.id, combined.id),
      /nicht gefunden/,
    );
    const pdfDownload = await request(
      `/applications/${record.id}/deliveries/${combined.id}/file`,
    );
    assert.equal(pdfDownload.status, 200);
    assert.match(
      pdfDownload.headers.get("content-disposition")!,
      /Bewerbung_Ada_Example_Acme_GmbH_Engineer\.pdf/,
    );
    assert.equal(
      (
        await request(
          `/applications/${other.id}/deliveries/${combined.id}/file`,
        )
      ).status,
      404,
    );
    const oldSource =
      "\\documentclass{article}\\begin{document}Private custom cover\\end{document}";
    app.store.save(
      record.id,
      "anschreiben/Anschreiben.tex",
      oldSource,
      app.store.app(record.id).revision,
    );
    const custom = await (
      await request(`/applications/${record.id}/cover-letter`)
    ).json();
    assert.equal(custom.requiresConversion, true);
    assert.equal(
      (
        await request(`/applications/${record.id}/cover-letter`, "PUT", {
          revision: custom.revision,
          fields: letter,
        })
      ).status,
      409,
    );
    assert.equal(
      app.store.read(record.id, "anschreiben/Anschreiben.tex").toString(),
      oldSource,
    );
    app.store.remove(record.id, app.store.app(record.id).revision);
    assert.equal(
      fs.existsSync(path.join(root, "delivery-jobs", combined.id)),
      false,
    );
    assert.deepEqual(
      app.store.documents.bytes(certificate.id),
      pdf("ORIGINAL-CERTIFICATE"),
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await app.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
