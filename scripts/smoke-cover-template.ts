import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { zipSync } from "fflate";
import { chromium, expect } from "@playwright/test";
import { Store } from "../server/store.ts";
import { startT3Application } from "../server/t3-main.ts";
import { cvDocumentTemplate } from "../test/fixtures/cv-document-template.ts";
if (process.env.SMOKE_SYNTHETIC !== "1")
  throw Error("Synthetic opt-in required");
const project = process.cwd(),
  runtime = path.resolve(process.env.SMOKE_RUNTIME || "native-t3/runtime"),
  output = path.resolve(
    process.env.SMOKE_REPORT_DIR || ".work/cover-template/browser",
  );
fs.mkdirSync(output, { recursive: true });
const root = fs.mkdtempSync(path.join(os.tmpdir(), "cover-ui-")),
  data = path.join(root, "data"),
  home = path.join(root, "user");
fs.mkdirSync(path.join(root, "native-t3"));
fs.mkdirSync(home);
for (const name of ["builder", "pdf-tools"])
  fs.symlinkSync(path.join(project, name), path.join(root, name));
const config = JSON.parse(fs.readFileSync("native-t3/config.json", "utf8"));
fs.writeFileSync(
  path.join(root, "native-t3/config.json"),
  JSON.stringify({
    ...config,
    directory: runtime,
    sha256: process.env.SMOKE_RUNTIME_SHA || config.sha256,
  }),
);
const store = new Store(data),
  template = store.import(cvDocumentTemplate()),
  a = store.create({ company: "SYNTHETIC COVER", template: template.id }),
  b = store.create({ company: "OTHER COVER", template: template.id });
store.cover.save(a.id, {
  revision: a.revision,
  fields: {
    sender: "Demo Writer\nExample Street",
    recipient: "Demo Employer",
    subject: "OriginalSubject51",
    salutation: "Dear Example,",
    body: "OriginalBody53",
    closing: "Kind regards",
  },
});
const originalSource = store.read(a.id, "anschreiben/Anschreiben.tex"),
  cvBefore = store.cv.read(a.id).data;
store.close();
const origin = "http://127.0.0.1:3190",
  saved = Object.fromEntries(
    [
      "HOME",
      "DATA_DIR",
      "PUBLIC_ORIGIN",
      "PUBLIC_PORT",
      "T3_NATIVE_PORT",
      "LEGACY_PORT",
    ].map((k) => [k, process.env[k]]),
  );
Object.assign(process.env, {
  HOME: home,
  DATA_DIR: data,
  PUBLIC_ORIGIN: origin,
  PUBLIC_PORT: "3190",
  T3_NATIVE_PORT: "3191",
  LEGACY_PORT: "3192",
});
let app: Awaited<ReturnType<typeof startT3Application>> | undefined,
  browser: Awaited<ReturnType<typeof chromium.launch>> | undefined,
  generations = 0,
  logs = "";
const report: Record<string, unknown> = { status: "FAILED", paidModelCalls: 0 };
try {
  process.chdir(root);
  app = await startT3Application({
    logNative: (line) => (logs += line),
    modThreads: {
      generate: async (workspace, onThread) => {
        generations++;
        assert(
          fs
            .readFileSync(path.join(workspace, "ADAPTER-CONTRACT.md"), "utf8")
            .startsWith("# Anschreiben-Mod:"),
        );
        fs.mkdirSync(path.join(workspace, "mod/layout"), { recursive: true });
        fs.copyFileSync(
          path.join(project, "test/fixtures/cover-mod-pdflatex/main.tex"),
          path.join(workspace, "mod/layout/main.tex"),
        );
        fs.writeFileSync(
          path.join(workspace, "mod/mod.json"),
          JSON.stringify({
            format: "bewerbung-cover-mod-v1",
            engine: "pdflatex",
            entrypoint: "layout/main.tex",
          }),
        );
        onThread("synthetic-cover", origin + "/synthetic/cover");
      },
      assertFinished: async () => {},
      remove: async () => {},
    },
  });
  browser = await chromium.launch({
    headless: true,
    executablePath:
      "/home/redjoker/.cache/ms-playwright/chromium_headless_shell-1254/chrome-headless-shell-linux64/chrome-headless-shell",
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  await context.addInitScript(
    "Object.defineProperty(navigator,'pdfViewerEnabled',{value:false,configurable:true})",
  );
  const page = await context.newPage(),
    errors: string[] = [];
  page.setDefaultTimeout(20000);
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (dialog) => void dialog.accept());
  await page.goto(origin + "/bewerbungen/" + a.id);
  await page.getByRole("button", { name: "Anschreiben", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Anschreibentext", exact: true }),
  ).toHaveValue("OriginalBody53");
  await page
    .getByText("Anschreiben-Vorlage hochladen", { exact: true })
    .click();
  const panel = page.locator("[data-cv-mod-import]");
  await panel.getByLabel("Datei für Vorlagenimport auswählen").setInputFiles({
    name: "not-a-letter.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4"),
  });
  await panel
    .getByRole("button", { name: "Hochladen & KI starten", exact: true })
    .click();
  await expect(panel.getByRole("alert")).toContainText(
    "Anschreiben-Vorlage als LaTeX-ZIP",
  );
  assert.equal(generations, 0);
  const zip = Buffer.from(
    zipSync({
      "main.tex": fs.readFileSync(
        path.join(project, "test/fixtures/cover-mod-pdflatex/main.tex"),
      ),
    }),
  );
  await panel.getByLabel("Datei für Vorlagenimport auswählen").setInputFiles({
    name: "synthetic-letter-layout.zip",
    mimeType: "application/zip",
    buffer: zip,
  });
  const start = page.waitForResponse(
    (r) => r.request().method() === "POST" && r.url().endsWith("/start"),
  );
  await panel
    .getByRole("button", { name: "Hochladen & KI starten", exact: true })
    .click();
  assert.equal((await start).status(), 202);
  await app.cvMods!.idle();
  const job = app.cvMods!.list()[0]!;
  assert.equal(job.documentType, "cover-template");
  assert.equal(job.manifest?.engine, "pdflatex");
  assert.equal(job.status, "review", JSON.stringify(job.checks));
  assert.equal(generations, 1);
  const row = panel.locator(`[data-cv-mod-job="${job.id}"]`);
  await expect(
    row.getByText("Geprüft · zur Durchsicht", { exact: true }),
  ).toBeVisible();
  const bound = page.waitForResponse(
    (r) => r.request().method() === "PUT" && r.url().endsWith("/cover-mod"),
  );
  await row
    .getByRole("button", {
      name: "Für dieses Anschreiben verwenden",
      exact: true,
    })
    .click();
  assert.equal((await bound).status(), 200);
  await expect(
    page.getByRole("textbox", { name: "Anschreibentext", exact: true }),
  ).toHaveValue("OriginalBody53");
  assert.deepEqual(
    app.app.store.read(a.id, "anschreiben/Anschreiben.tex"),
    originalSource,
  );
  assert.deepEqual(app.app.store.cv.read(a.id).data, cvBefore);
  assert.equal(app.app.store.cv.read(a.id).modId, null);
  await page
    .getByRole("textbox", { name: "Betreff", exact: true })
    .fill("EditedSubject61");
  await page
    .getByRole("textbox", { name: "Anschreibentext", exact: true })
    .fill("EditedCoverBody71 50% & Rust_2026.\n\nSecondParagraph73");
  const build = page.waitForResponse(
    (r) => r.request().method() === "POST" && r.url().endsWith("/builds"),
  );
  await page
    .getByRole("button", { name: "Speichern & PDF bauen", exact: true })
    .click();
  assert.equal((await build).status(), 202);
  await app.app.builds.idle();
  assert.equal(app.app.builds.documentStatus(a.id).cover, "current");
  await expect(page.locator("[data-pdf-text-layer]")).toContainText(
    "EditedCoverBody71",
  );
  await expect(page.locator("canvas").first()).toBeVisible();
  assert.deepEqual(
    app.app.store.read(a.id, "anschreiben/Anschreiben.tex"),
    originalSource,
  );
  const denied = await context.request.delete(
    origin + "/bewerbung/api/cv-mods/jobs/" + job.id,
    { headers: { "X-Bewerbung-Request": "1" }, data: { updated: job.updated } },
  );
  assert.equal(denied.status(), 409);
  assert.equal(app.app.store.cover.read(b.id).modId, null);
  await page.screenshot({
    path: path.join(output, "cover-template-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  await panel
    .getByRole("button", { name: "Hochladen & KI starten", exact: true })
    .scrollIntoViewIfNeeded();
  await expect(
    panel.getByRole("button", { name: "Hochladen & KI starten", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: path.join(output, "cover-template-mobile.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Lebenslauf", exact: true }).click();
  const cvChoice = page.getByRole("combobox", {
    name: "LaTeX-Vorlage für diesen Lebenslauf",
    exact: true,
  });
  await cvChoice.click();
  await expect(
    page.getByRole("option", { name: /synthetic-letter-layout/ }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Anschreiben", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "Anschreiben", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Anschreibentext", exact: true }),
  ).toHaveValue("EditedCoverBody71 50% & Rust_2026.\n\nSecondParagraph73");
  await page
    .getByText("Anschreiben-Vorlage hochladen", { exact: true })
    .click();
  const proofRow = panel.locator(`[data-cv-mod-job="${job.id}"]`);
  await proofRow
    .getByText("Build-Prüfungen und Vorschau", { exact: true })
    .click();
  const proofs = proofRow.getByRole("link", {
    name: "PDF öffnen",
    exact: true,
  });
  await expect(proofs).toHaveCount(4);
  const p = await context.request.get(
    new URL((await proofs.first().getAttribute("href"))!, origin).href,
  );
  assert.equal(p.status(), 200);
  assert.equal((await p.body()).subarray(0, 5).toString(), "%PDF-");
  const choice = page.getByRole("combobox", {
    name: "LaTeX-Vorlage für dieses Anschreiben",
    exact: true,
  });
  const unbound = page.waitForResponse(
    (r) => r.request().method() === "PUT" && r.url().endsWith("/cover-mod"),
  );
  await choice.click();
  await page
    .getByRole("option", {
      name: "Bestehende Anschreiben-Vorlage",
      exact: true,
    })
    .click();
  assert.equal((await unbound).status(), 200);
  await expect(
    page.getByRole("textbox", { name: "Anschreibentext", exact: true }),
  ).toHaveValue("EditedCoverBody71 50% & Rust_2026.\n\nSecondParagraph73");
  assert.equal(app.app.store.cover.read(a.id).modId, null);
  assert.equal(app.app.builds.documentStatus(a.id).cover, "outdated");
  const normalBuild = page.waitForResponse(
    (r) => r.request().method() === "POST" && r.url().endsWith("/builds"),
  );
  await page.getByRole("button", { name: "PDF bauen", exact: true }).click();
  assert.equal((await normalBuild).status(), 202);
  await app.app.builds.idle();
  assert.equal(app.app.builds.documentStatus(a.id).cover, "current");
  const removed = page.waitForResponse(
    (r) =>
      r.request().method() === "DELETE" &&
      r.url().endsWith("/cv-mods/jobs/" + job.id),
  );
  await proofRow
    .getByRole("button", { name: "Entfernen", exact: true })
    .click();
  assert.equal((await removed).status(), 200);
  await choice.click();
  await expect(
    page.getByRole("option", { name: /synthetic-letter-layout/ }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  assert.equal(generations, 1);
  assert.deepEqual(errors, []);
  Object.assign(report, {
    status: "PASS",
    mockGenerations: 1,
    proofPdfs: 4,
    coverEngine: "pdflatex",
    normalCoverPdf: true,
    standardCoverRoundTrip: true,
    realOfflinePdfs: 6,
    letterFieldsPreserved: true,
    cvUnchanged: true,
    usedImportDeletionBlocked: true,
    coverAbsentFromCvSelector: true,
    pdfJsVisibleContent: true,
    proofDownload: true,
    reload: true,
    mobileNoOverflow: true,
    errors,
  });
} catch (e) {
  report.error = String(e);
  report.stack = e instanceof Error ? e.stack : undefined;
  const page = browser?.contexts()[0]?.pages()[0];
  if (page) {
    await page
      .screenshot({ path: path.join(output, "failure.png") })
      .catch(() => {});
    fs.writeFileSync(
      path.join(output, "failure-dom.txt"),
      await page
        .locator("body")
        .innerText()
        .catch(() => ""),
    );
  }
  throw e;
} finally {
  await browser?.close();
  await app?.close();
  process.chdir(project);
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  fs.writeFileSync(
    path.join(output, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  fs.writeFileSync(path.join(output, "native.log"), logs);
  fs.rmSync(root, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 100,
  });
}
