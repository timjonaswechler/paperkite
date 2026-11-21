import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { zipSync } from "fflate";
import { chromium, expect } from "@playwright/test";
import { Store } from "../server/store.ts";
import { startT3Application } from "../server/t3-main.ts";
import { cvDocumentTemplate } from "../test/fixtures/cv-document-template.ts";
if (process.env.SMOKE_SYNTHETIC !== "1")
  throw Error("Synthetic opt-in required");
const project = process.cwd(),
  runtime = path.resolve(process.env.SMOKE_RUNTIME || "native-t3/runtime");
const output = path.resolve(
  process.env.SMOKE_REPORT_DIR || ".work/integrated-cv-proof",
);
fs.mkdirSync(output, { recursive: true });
const root = fs.mkdtempSync(path.join(os.tmpdir(), "integrated-cv-")),
  data = path.join(root, "data"),
  home = path.join(root, "user");
fs.mkdirSync(path.join(root, "native-t3"));
fs.mkdirSync(home);
for (const directory of ["builder", "pdf-tools"])
  fs.symlinkSync(path.join(project, directory), path.join(root, directory));
const config = JSON.parse(
  fs.readFileSync(path.join(project, "native-t3/config.json"), "utf8"),
);
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
  a = store.create({ company: "SYNTHETIC CV A", template: template.id }),
  b = store.create({ company: "SYNTHETIC CV B", template: template.id });
const legacyDraft = store.cv.read(a.id);
legacyDraft.data.sections
  .find((section) => section.kind === "experience")!
  .entries[0]!.content.push({
    id: "old-empty-list",
    type: "bulletList",
    items: [],
  });
store.cv.save(a.id, legacyDraft);
store.close();
const modTex = fs.readFileSync(
  path.join(project, "test/fixtures/cv-mod-synthetic.tex"),
);
const origin = "http://127.0.0.1:3190";
const saved = Object.fromEntries(
  [
    "HOME",
    "DATA_DIR",
    "PUBLIC_ORIGIN",
    "PUBLIC_PORT",
    "T3_NATIVE_PORT",
    "LEGACY_PORT",
  ].map((key) => [key, process.env[key]]),
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
  generated = 0,
  logs = "";
const report: Record<string, unknown> = {
  status: "FAILED",
  paidModelCalls: 0,
  realNativeAdapterGenerationTested: false,
};
try {
  process.chdir(root);
  app = await startT3Application({
    logNative: (line) => {
      logs += line;
    },
    modThreads: {
      generate: async (workspace, onThread) => {
        generated++;
        fs.mkdirSync(path.join(workspace, "mod/layout"), { recursive: true });
        fs.writeFileSync(path.join(workspace, "mod/layout/main.tex"), modTex);
        fs.writeFileSync(
          path.join(workspace, "mod/mod.json"),
          JSON.stringify({
            format: "bewerbung-cv-mod-prototype-v1",
            engine: "lualatex",
            entrypoint: "layout/main.tex",
            fields: [
              {
                key: "person.role",
                label: "Rolle / Berufsbezeichnung",
                type: "text",
                required: false,
              },
            ],
          }),
        );
        onThread(
          "synthetic-thread",
          origin + "/synthetic-environment/synthetic-thread",
        );
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
    }),
    page = await context.newPage();
  page.setDefaultTimeout(20000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(origin + "/bewerbungen/" + a.id);
  await page.getByRole("button", { name: "Lebenslauf", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Vorname", exact: true }),
  ).toHaveText("Demo");
  assert.equal(
    app.app.store.db.prepare("SELECT count(*) n FROM cv_documents").get()!.n,
    1,
  );
  await expect(
    page.getByRole("textbox", {
      name: "Rolle / Berufsbezeichnung",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("textbox", { name: "Inhalt", exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Speichern", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("textbox", { name: "Vorname", exact: true })
    .fill("BrowserApplicant");
  const position = page.getByRole("textbox", { name: "Position", exact: true });
  await position.fill("MustBeReverted");
  await position.press("Escape");
  await expect(position).toHaveText("PositionMarker");
  const experience = page.locator("[data-cv-entry]").filter({ has: position });
  const body = experience.getByRole("textbox", { name: "Inhalt", exact: true });
  await expect(body).toHaveCount(1);
  await expect(
    page.getByRole("button", {
      name: /^(?:Stichpunkt|Kenntnis|\+ Absatz|\+ Liste)$/,
    }),
  ).toHaveCount(0);
  await body.click();
  await body.press("Control+Home");
  await body.press("End");
  await body.press("Enter");
  await expect(body).toBeFocused();
  await body.pressSequentially("BrowserBulletMarker");
  await body.press("Control+End");
  await body.press("Enter");
  await body.press("Enter");
  await body.pressSequentially("BrowserParagraphMarker 50% & Rust_2026.");
  await page
    .locator('[data-cv-section="education"]')
    .getByRole("checkbox")
    .uncheck();
  const savedResponse = page.waitForResponse(
    (r) => r.request().method() === "PUT" && r.url().endsWith("/cv-data"),
  );
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  assert.equal((await savedResponse).status(), 200);
  assert.equal(app.app.store.cv.read(b.id).data.person.firstName, "Demo");
  await page.reload();
  await page.getByRole("button", { name: "Lebenslauf", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Vorname", exact: true }),
  ).toHaveText("BrowserApplicant");
  await expect(
    experience.getByRole("textbox", { name: "Inhalt", exact: true }),
  ).toContainText("BrowserParagraphMarker 50% & Rust_2026.");
  const stored = app.app.store.cv.read(a.id).data;
  assert.equal(
    stored.sections.find((s) => s.kind === "education")!.entries[0]!.included,
    false,
  );
  const content = stored.sections.find((s) => s.kind === "experience")!
    .entries[0]!.content;
  assert.deepEqual(
    content.flatMap((b) =>
      b.type === "bulletList" ? b.items.map((i) => i.text) : [],
    ),
    ["BulletMarkerA", "BrowserBulletMarker", "BulletMarkerB"],
  );
  assert.equal(content.at(-1)?.type, "paragraph");
  await page.getByRole("button", { name: "Lesen", exact: true }).click();
  await expect(page.locator('[data-cv-section="education"]')).toHaveCount(0);
  await expect(
    page.getByText("Fachrichtung / Zusatz", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("textbox", { name: "Vorname", exact: true }),
  ).toHaveAttribute("contenteditable", "false");
  await expect(
    page.getByRole("button", { name: "Hinzufügen", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Bearbeiten", exact: true }).click();
  const education = page.locator('[data-cv-section="education"]');
  await education.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Lesen", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Fachrichtung / Zusatz", exact: true }),
  ).toHaveText("FieldMarker");
  await expect(
    page.getByText("Fachrichtung / Zusatz", { exact: true }),
  ).toBeHidden();
  await page.getByRole("button", { name: "Bearbeiten", exact: true }).click();
  await education.getByRole("checkbox").uncheck();
  await expect(
    page.getByRole("button", { name: "Speichern", exact: true }),
  ).toBeDisabled();
  const queued = page.waitForResponse(
    (r) => r.request().method() === "POST" && r.url().endsWith("/builds"),
  );
  await page.getByRole("button", { name: "PDF bauen", exact: true }).click();
  assert.equal((await queued).status(), 202);
  await app.app.builds.idle();
  const firstBuild = app.app.store
    .builds(a.id)
    .find((row) => row.kind === "cv" && row.status === "success");
  assert.ok(firstBuild);
  await page.screenshot({
    path: path.join(output, "cv-desktop.png"),
    animations: "disabled",
  });
  await page.getByText("LaTeX-Vorlage hochladen", { exact: true }).click();
  const imports = page.locator("[data-cv-mod-import]");
  await imports.getByLabel("Datei für Vorlagenimport auswählen").setInputFiles({
    name: "not-a-template.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4"),
  });
  await imports
    .getByRole("button", { name: "Hochladen & KI starten", exact: true })
    .click();
  await expect(imports.getByRole("alert")).toContainText("PDF allein");
  assert.equal(generated, 0);
  const zip = Buffer.from(
    zipSync({
      "main.tex": Buffer.from(
        "\\documentclass{article}\\begin{document}Synthetic\\end{document}",
      ),
    }),
  );
  await imports.getByLabel("Datei für Vorlagenimport auswählen").setInputFiles({
    name: "synthetic-layout.zip",
    mimeType: "application/zip",
    buffer: zip,
  });
  const started = page.waitForResponse(
    (r) => r.request().method() === "POST" && r.url().endsWith("/start"),
  );
  await imports
    .getByRole("button", { name: "Hochladen & KI starten", exact: true })
    .click();
  assert.equal((await started).status(), 202);
  await app.cvMods!.idle();
  await expect(
    imports.getByText("Geprüft · zur Durchsicht", { exact: true }),
  ).toBeVisible();
  assert.equal(generated, 1);
  assert.equal(app.app.store.list().length, 2);
  await imports
    .getByRole("button", { name: "Für diese Bewerbung verwenden", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", {
      name: "Rolle / Berufsbezeichnung",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Rolle / Berufsbezeichnung", exact: true })
    .fill("BrowserRoleMarker");
  const modBuild = page.waitForResponse(
    (r) => r.request().method() === "POST" && r.url().endsWith("/builds"),
  );
  await page
    .getByRole("button", { name: "Speichern & PDF bauen", exact: true })
    .click();
  assert.equal((await modBuild).status(), 202);
  await app.app.builds.idle();
  const bound = app.app.store.cv.read(a.id);
  assert.ok(bound.modId?.includes("."));
  assert.equal(bound.data.person.role, "BrowserRoleMarker");
  assert.equal(app.app.builds.documentStatus(a.id).cv, "current");
  assert.equal(generated, 1);
  await page.reload();
  await page.getByRole("button", { name: "Lebenslauf", exact: true }).click();
  await expect(
    page.getByRole("textbox", {
      name: "Rolle / Berufsbezeichnung",
      exact: true,
    }),
  ).toHaveText("BrowserRoleMarker");
  const job = app.cvMods!.list()[0]!;
  const deletion = await context.request.delete(
    origin + "/bewerbung/api/cv-mods/jobs/" + job.id,
    { headers: { "X-Bewerbung-Request": "1" }, data: { updated: job.updated } },
  );
  assert.equal(deletion.status(), 409);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  await page.screenshot({
    path: path.join(output, "cv-mobile.png"),
    animations: "disabled",
  });
  await page.goto(origin + "/settings/projects");
  await expect(
    page
      .locator("[data-cv-mod-import]")
      .getByText("synthetic-layout.zip", { exact: true }),
  ).toBeVisible();
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  await page.screenshot({
    path: path.join(output, "settings-mobile.png"),
    animations: "disabled",
  });
  // Exercise form mods through the same CV workspace, API and application build queue.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(origin + "/bewerbungen/" + a.id);
  await page.getByRole("button", { name: "Lebenslauf", exact: true }).click();
  await expect(
    page.getByRole("textbox", {
      name: "Rolle / Berufsbezeichnung",
      exact: true,
    }),
  ).toHaveText("BrowserRoleMarker");
  const beforeForm = app.app.store.cv.read(a.id),
    sourceBefore = app.app.store.read(a.id, "cv/profiles/general.lua");
  const choice = page.getByRole("combobox", {
    name: "LaTeX-Vorlage für diesen Lebenslauf",
    exact: true,
  });
  page.on("dialog", (dialog) => void dialog.accept());
  const choose = async (name: RegExp | string) => {
    const response = page.waitForResponse(
      (r) => r.request().method() === "PUT" && r.url().endsWith("/cv-mod"),
    );
    await choice.click();
    await page
      .getByRole("option", { name, exact: typeof name === "string" })
      .click();
    assert.equal((await response).status(), 200);
  };
  await choose(/Formular · Beispiel · CV/);
  await expect(page.locator("[data-form-mod]")).toBeVisible();
  await expect(
    page.getByRole("textbox", {
      name: "Rolle / Berufsbezeichnung",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Speichern", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("textbox", { name: "Name", exact: true })
    .fill("IntegratedForm11");
  await page
    .getByRole("textbox", { name: "UI-only Notizen", exact: true })
    .fill("HiddenNotes13");
  const collection = page.locator('[data-collection="career"]'),
    entries = collection.locator("[data-entry]");
  for (const title of ["FirstRole15", "SecondRole17", "HiddenRole19"]) {
    await collection
      .getByRole("button", { name: "Eintrag hinzufügen", exact: true })
      .click();
    await collection
      .getByRole("textbox", { name: "Tätigkeit", exact: true })
      .last()
      .fill(title);
  }
  await entries
    .first()
    .getByRole("textbox", { name: "Inhalt", exact: true })
    .fill("IntegratedBody21 50% & Rust_2026.");
  await entries
    .nth(2)
    .getByRole("checkbox", { name: "Im PDF", exact: true })
    .uncheck();
  await entries
    .nth(1)
    .getByRole("button", { name: "Nach oben", exact: true })
    .click();
  await collection
    .getByRole("button", { name: "Eintrag hinzufügen", exact: true })
    .click();
  await entries
    .last()
    .getByRole("button", { name: "Eintrag löschen", exact: true })
    .click();
  await expect(entries).toHaveCount(3);
  const formSaved = page.waitForResponse(
    (r) => r.request().method() === "PUT" && r.url().endsWith("/cv-data"),
  );
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  assert.equal((await formSaved).status(), 200);
  await expect(
    page.getByRole("button", { name: "Speichern", exact: true }),
  ).toBeDisabled();
  const formData = app.app.store.cv.read(a.id),
    career = formData.form!.values.career as {
      id: string;
      included: boolean;
      values: { position: string };
    }[];
  assert.deepEqual(
    career.map((e) => e.values.position),
    ["SecondRole17", "FirstRole15", "HiddenRole19"],
  );
  assert.equal(career[2]!.included, false);
  await page.reload();
  await page.getByRole("button", { name: "Lebenslauf", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Name", exact: true }),
  ).toHaveValue("IntegratedForm11");
  assert.deepEqual(
    app.app.store.cv.read(a.id).form!.values,
    formData.form!.values,
  );
  await page.getByRole("button", { name: "Lesen", exact: true }).click();
  await expect(entries).toHaveCount(2);
  await expect(page.getByText("HiddenRole19", { exact: true })).toHaveCount(0);
  await expect(page.getByText("HiddenNotes13", { exact: true })).toHaveCount(0);
  await expect(
    page.locator("[data-form-mod]").getByText("Kopf", { exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Bearbeiten", exact: true }).click();
  await entries
    .nth(2)
    .getByRole("checkbox", { name: "Im PDF", exact: true })
    .check();
  await page.getByRole("button", { name: "Lesen", exact: true }).click();
  await expect(entries).toHaveCount(3);
  await page.getByRole("button", { name: "Bearbeiten", exact: true }).click();
  await entries
    .nth(2)
    .getByRole("checkbox", { name: "Im PDF", exact: true })
    .uncheck();
  await expect(
    page.getByRole("button", { name: "Speichern", exact: true }),
  ).toBeDisabled();
  const formBuild = page.waitForResponse(
    (r) => r.request().method() === "POST" && r.url().endsWith("/builds"),
  );
  await page.getByRole("button", { name: "PDF bauen", exact: true }).click();
  assert.equal((await formBuild).status(), 202);
  await app.app.builds.idle();
  assert.equal(app.app.builds.documentStatus(a.id).cv, "current");
  await page.screenshot({
    path: path.join(output, "form-cv-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  await page.screenshot({
    path: path.join(output, "form-cv-mobile.png"),
    fullPage: true,
  });
  await choose(/Formular · Beispiel · Portfolio/);
  await expect(
    page.getByRole("textbox", { name: "Name", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("textbox", { name: "Überschrift", exact: true })
    .fill("PortfolioForm31");
  await page
    .getByRole("textbox", { name: "Einleitung", exact: true })
    .fill("Intro33");
  const projects = page.locator('[data-collection="projects"]');
  await projects
    .getByRole("button", { name: "Eintrag hinzufügen", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Projektname", exact: true })
    .fill("Project35");
  await page
    .getByRole("textbox", { name: "Technologien", exact: true })
    .fill("Rust & Lua");
  await page
    .getByRole("textbox", { name: "Beschreibung", exact: true })
    .fill("Description37");
  const portfolioBuild = page.waitForResponse(
    (r) => r.request().method() === "POST" && r.url().endsWith("/builds"),
  );
  await page
    .getByRole("button", { name: "Speichern & PDF bauen", exact: true })
    .click();
  assert.equal((await portfolioBuild).status(), 202);
  await app.app.builds.idle();
  assert.equal(app.app.builds.documentStatus(a.id).cv, "current");
  assert.equal(
    app.app.store.cv.read(a.id).form!.values.fullName,
    "IntegratedForm11",
  );
  assert.ok(
    app.app.store.read(a.id, "cv/profiles/general.lua").equals(sourceBefore),
  );
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  await page.screenshot({
    path: path.join(output, "form-portfolio-mobile.png"),
    fullPage: true,
  });
  await choose("synthetic-layout.zip");
  await expect(
    page.getByRole("textbox", {
      name: "Rolle / Berufsbezeichnung",
      exact: true,
    }),
  ).toHaveText("BrowserRoleMarker");
  assert.deepEqual(app.app.store.cv.read(a.id).data, beforeForm.data);
  await choose(/Formular · Beispiel · CV/);
  await expect(
    page.getByRole("textbox", { name: "Name", exact: true }),
  ).toHaveValue("IntegratedForm11");
  const db = new DatabaseSync(
    path.join(data, "native-t3/userdata/statev2.sqlite"),
    { readOnly: true },
  );
  assert.equal(
    db
      .prepare("SELECT count(*) n FROM orchestration_v2_projection_threads")
      .get()!.n,
    0,
  );
  db.close();
  assert.deepEqual(errors, []);
  Object.assign(report, {
    status: "PASS",
    mockAdapterGenerations: generated,
    realOfflinePdfBuilds: 9,
    formModsInNormalWorkspace: true,
    formEntryActionsAndReload: true,
    formModRoundTripRetainsLegacyAndUnknownData: true,
    documentEditorPersistence: true,
    escapeRestoresField: true,
    enterAddsFocusedBullet: true,
    excludedEntryRetainedAndOmitted: true,
    singleContentEditor: true,
    emptyLegacyListEditable: true,
    readMode: true,
    modSelectionAndPersistence: true,
    usedModDeletionBlocked: true,
    settingsIntegration: true,
    mobileNoOverflow: true,
    independentApplications: true,
    nativeModelThreads: 0,
    errors,
  });
} catch (e) {
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
  report.error = String(e);
  throw e;
} finally {
  await browser?.close();
  await app?.close();
  process.chdir(project);
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.writeFileSync(
    path.join(output, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  fs.writeFileSync(path.join(output, "native.log"), logs);
  fs.rmSync(root, { recursive: true, force: true });
}
