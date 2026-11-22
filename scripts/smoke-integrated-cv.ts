import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { execFileSync } from "node:child_process";
import { zipSync } from "fflate";
import { chromium, expect, type Locator } from "@playwright/test";
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
assert.deepEqual(
  store.cv.forms.list(),
  [],
  "Normal startup must not preload demo mods",
);
const formFixtures = path.join(project, "test/fixtures/cv-form-mods");
for (const [directory, name] of [
  ["cv", "Prüfvorlage CV"],
  ["portfolio", "Prüfvorlage Portfolio"],
]) {
  store.cv.forms.install(
    name!,
    JSON.parse(
      fs.readFileSync(path.join(formFixtures, directory!, "mod.json"), "utf8"),
    ),
    {
      "main.tex": fs.readFileSync(
        path.join(formFixtures, directory!, "main.tex"),
      ),
      "format.lua": fs.readFileSync(path.join(formFixtures, "format.lua")),
    },
  );
}
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
        if (
          fs
            .readFileSync(path.join(workspace, "ADAPTER-CONTRACT.md"), "utf8")
            .includes("# CV-Mod v2:")
        ) {
          fs.mkdirSync(path.join(workspace, "mod"), { recursive: true });
          for (const file of ["main.tex", "mod.json"])
            fs.copyFileSync(
              path.join(formFixtures, "portfolio", file),
              path.join(workspace, "mod", file),
            );
          fs.copyFileSync(
            path.join(formFixtures, "format.lua"),
            path.join(workspace, "mod/format.lua"),
          );
          onThread(
            "synthetic-v2-thread",
            origin + "/synthetic-environment/synthetic-v2-thread",
          );
          return;
        }
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
  await context.addInitScript(
    `window.__orderDrag = []; for (const type of ['dragstart','dragover','drop','dragend']) document.addEventListener(type, event => { const row = event.target.closest?.('[data-entry]'); window.__orderDrag.push({type, entry:row?.dataset.entry, prevented:event.defaultPrevented, payload:event.dataTransfer?.getData('application/x-bewerbung-entry')}); if(window.__orderDrag.length>40)window.__orderDrag.shift(); });`,
  );
  page.setDefaultTimeout(20000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (dialog) => void dialog.accept());
  const dragEntry = async (handle: Locator, target: Locator, y = 4) => {
    await page.evaluate("window.__orderDrag = []");
    await handle.scrollIntoViewIfNeeded();
    const from = (await handle.boundingBox())!;
    const x = from.x + from.width / 2,
      top = from.y + from.height / 2;
    await page.mouse.move(x, top);
    await page.mouse.down();
    await page.mouse.move(x + 12, top, { steps: 4 });
    await target.scrollIntoViewIfNeeded();
    const to = (await target.boundingBox())!;
    await page.mouse.move(to.x + 12, to.y + y, { steps: 12 });
    await page.mouse.move(to.x + 14, to.y + y + 1);
    await page.mouse.up();
    assert(
      await page.evaluate(
        "window.__orderDrag.some(event => event.type === 'dragstart')",
      ),
      "A real native drag must have started",
    );
  };
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
  const legacySection = page.locator('[data-cv-section="experience"]');
  const legacyRows = legacySection.locator("[data-cv-entry]");
  for (const title of ["LegacyNewA", "LegacyNewB"]) {
    if (title === "LegacyNewA") {
      await page
        .getByRole("button", { name: "Hinzufügen", exact: true })
        .click();
      await page
        .getByRole("menuitem", { name: "Berufserfahrung", exact: true })
        .click();
    } else {
      await legacySection
        .getByRole("button", { name: "Eintrag hinzufügen", exact: true })
        .click();
    }
    await legacyRows
      .first()
      .getByRole("textbox", { name: "Position", exact: true })
      .fill(title);
    await expect(legacyRows.first()).toContainText(title);
  }
  const originalRow = legacyRows.filter({ hasText: "PositionMarker" });
  await originalRow
    .getByRole("button", { name: "Ganz nach oben", exact: true })
    .click();
  await expect(legacyRows.first()).toContainText("PositionMarker");
  await legacyRows
    .filter({ hasText: "LegacyNewA" })
    .getByRole("textbox", { name: "Position", exact: true })
    .fill("LegacyEditedA");
  await legacySection
    .getByRole("button", { name: "Verschiebung rückgängig", exact: true })
    .click();
  await expect(legacyRows.first()).toContainText("LegacyNewB");
  await expect(legacyRows.nth(1)).toContainText("LegacyEditedA");
  await expect(legacyRows.last()).toContainText("PositionMarker");
  const beforeCrossScope = await legacySection
    .getByRole("textbox", { name: "Position", exact: true })
    .allTextContents();
  await dragEntry(
    originalRow.getByRole("button", { name: "Eintrag ziehen", exact: true }),
    education.locator("[data-cv-entry]").first(),
  );
  assert.deepEqual(
    await legacySection
      .getByRole("textbox", { name: "Position", exact: true })
      .allTextContents(),
    beforeCrossScope,
  );
  await dragEntry(
    originalRow.getByRole("button", { name: "Eintrag ziehen", exact: true }),
    legacyRows.first(),
  );
  await expect(legacyRows.first()).toContainText("PositionMarker");
  await originalRow.press("Alt+End");
  await expect(legacyRows.last()).toContainText("PositionMarker");
  await legacyRows
    .filter({ hasText: "LegacyNewB" })
    .getByRole("button", { name: "Eintrag löschen", exact: true })
    .click();
  await legacyRows
    .filter({ hasText: "LegacyEditedA" })
    .getByRole("button", { name: "Eintrag löschen", exact: true })
    .click();
  await expect(legacyRows).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Speichern", exact: true }),
  ).toBeDisabled();
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
  const legacyUpload = await context.request.post(
    origin + "/bewerbung/api/cv-mods/jobs",
    {
      headers: { "X-Bewerbung-Request": "1" },
      data: {
        name: "synthetic-layout.zip",
        documentType: "cv-template",
        targetFormat: "bewerbung-cv-mod-prototype-v1",
        zipBase64: zip.toString("base64"),
      },
    },
  );
  assert.equal(legacyUpload.status(), 201);
  await page.reload();
  await page.getByRole("button", { name: "Lebenslauf", exact: true }).click();
  await page.getByText("LaTeX-Vorlage hochladen", { exact: true }).click();
  const started = page.waitForResponse(
    (r) => r.request().method() === "POST" && r.url().endsWith("/start"),
  );
  await imports
    .getByRole("button", { name: "KI starten", exact: true })
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
  await choose(/Formular · Prüfvorlage CV/);
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
  const inlineName = page.getByRole("textbox", { name: "Name", exact: true });
  await expect(inlineName).toHaveAttribute("contenteditable", "true");
  await expect(
    page.locator(
      "[data-form-mod] input:not([type=checkbox]):not([type=hidden])",
    ),
  ).toHaveCount(0);
  await inlineName.focus();
  await inlineName.press("End");
  await inlineName.pressSequentially("Tail");
  await expect(inlineName).toHaveText("IntegratedForm11Tail");
  await inlineName.press("Escape");
  await expect(inlineName).toHaveText("IntegratedForm11");
  const notes = page.getByRole("textbox", {
    name: "UI-only Notizen",
    exact: true,
  });
  await notes.focus();
  await notes.press("Control+A");
  await notes.evaluate((element) => {
    const clipboard = new DataTransfer();
    clipboard.setData("text/plain", "<b>PlainPaste</b>");
    clipboard.setData("text/html", "<b>RichPaste</b>");
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: clipboard,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await expect(notes).toHaveText("<b>PlainPaste</b>");
  await expect(notes.locator("b")).toHaveCount(0);
  await notes.press("Escape");
  await expect(notes).toHaveText("HiddenNotes13");
  const collection = page.locator('[data-collection="career"]'),
    entries = collection.locator("[data-entry]");
  for (const title of ["HiddenRole19", "SecondRole17", "FirstRole15"]) {
    await collection
      .getByRole("button", { name: "Eintrag hinzufügen", exact: true })
      .click();
    await collection
      .getByRole("textbox", { name: "Tätigkeit", exact: true })
      .first()
      .fill(title);
    await expect(entries.first()).toContainText(title);
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
  await entries
    .nth(2)
    .getByRole("button", { name: "Ganz nach oben", exact: true })
    .click();
  await expect(entries.first()).toContainText("HiddenRole19");
  const firstRole = entries.filter({ hasText: "FirstRole15" });
  await firstRole
    .getByRole("textbox", { name: "Inhalt", exact: true })
    .fill("EditedWhileMoved27");
  await collection
    .getByRole("button", { name: "Verschiebung rückgängig", exact: true })
    .click();
  await expect(entries.first()).toContainText("SecondRole17");
  await expect(
    firstRole.getByRole("textbox", { name: "Inhalt", exact: true }),
  ).toContainText("EditedWhileMoved27");
  await firstRole
    .getByRole("textbox", { name: "Inhalt", exact: true })
    .fill("IntegratedBody21 50% & Rust_2026.");
  await entries
    .first()
    .getByRole("button", { name: "Ganz nach unten", exact: true })
    .click();
  await expect(entries.last()).toContainText("SecondRole17");
  await entries
    .last()
    .getByRole("button", { name: "Ganz nach oben", exact: true })
    .click();
  await entries
    .first()
    .getByRole("button", { name: "Nach unten", exact: true })
    .click();
  await entries
    .nth(1)
    .getByRole("button", { name: "Nach oben", exact: true })
    .click();
  await dragEntry(
    entries
      .first()
      .getByRole("button", { name: "Eintrag ziehen", exact: true }),
    entries.last(),
    20,
  );
  // Drop the first entry ahead of the last; a real same-collection move must occur.
  await expect(entries.first()).toContainText("FirstRole15");
  await collection
    .getByRole("button", { name: "Verschiebung rückgängig", exact: true })
    .click();
  await expect(entries.first()).toContainText("SecondRole17");
  await entries.first().press("Alt+End");
  await expect(entries.last()).toContainText("SecondRole17");
  await collection
    .getByRole("button", { name: "Verschiebung rückgängig", exact: true })
    .click();
  await collection
    .getByRole("button", { name: "Eintrag hinzufügen", exact: true })
    .click();
  await entries
    .first()
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
  ).toHaveText("IntegratedForm11");
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
  const builtForm = app.app.store
    .builds(a.id)
    .find((row) => row.kind === "cv" && row.status === "success")!;
  const formPdf = app.app.builds.artifact(a.id, String(builtForm.id));
  const actualFormText = execFileSync(
    "docker",
    [
      "run",
      "--rm",
      "--network=none",
      "--read-only",
      "--cap-drop=ALL",
      "--user",
      `${process.getuid!()}:${process.getgid!()}`,
      "--mount",
      `type=bind,src=${path.dirname(formPdf)},dst=/input,readonly`,
      "--entrypoint",
      "pdftotext",
      fs.readFileSync(path.join(project, "pdf-tools/image-id"), "utf8").trim(),
      "/input/" + path.basename(formPdf),
      "-",
    ],
    { encoding: "utf8" },
  );
  assert(actualFormText.indexOf("SecondRole17") >= 0);
  assert(
    actualFormText.indexOf("SecondRole17") <
      actualFormText.indexOf("FirstRole15"),
  );
  assert(!actualFormText.includes("HiddenRole19"));
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
  await choose(/Formular · Prüfvorlage Portfolio/);
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
  await choose(/Formular · Prüfvorlage CV/);
  await expect(
    page.getByRole("textbox", { name: "Name", exact: true }),
  ).toHaveText("IntegratedForm11");
  await page.getByText("LaTeX-Vorlage hochladen", { exact: true }).click();
  await imports.getByLabel("Datei für Vorlagenimport auswählen").setInputFiles({
    name: "v2-portfolio.zip",
    mimeType: "application/zip",
    buffer: zip,
  });
  const v2Started = page.waitForResponse(
    (r) => r.request().method() === "POST" && r.url().endsWith("/start"),
  );
  await imports
    .getByRole("button", { name: "Hochladen & KI starten", exact: true })
    .click();
  assert.equal((await v2Started).status(), 202);
  await app.cvMods!.idle();
  const v2Job = app
    .cvMods!.list()
    .find((job) => job.name === "v2-portfolio.zip")!;
  assert.equal(v2Job.status, "review", JSON.stringify(v2Job.checks));
  assert.ok(v2Job.versionId!.startsWith("form:"));
  const importedRow = imports.locator(`[data-cv-mod-job="${v2Job.id}"]`);
  await expect(
    importedRow.getByText("Geprüft · zur Durchsicht", { exact: true }),
  ).toBeVisible();
  await importedRow
    .getByRole("button", { name: "Für diese Bewerbung verwenden", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Überschrift", exact: true }),
  ).toBeVisible();
  assert.equal(app.app.store.cv.read(a.id).modId, v2Job.versionId);
  assert.equal(
    app.app.store.db
      .prepare("SELECT 1 FROM cv_form_mods WHERE id=?")
      .get(v2Job.versionId!),
    undefined,
  );
  await page
    .getByRole("textbox", { name: "Überschrift", exact: true })
    .fill("ImportedV2Marker83");
  const importedBuild = page.waitForResponse(
    (r) => r.request().method() === "POST" && r.url().endsWith("/builds"),
  );
  await page
    .getByRole("button", { name: "Speichern & PDF bauen", exact: true })
    .click();
  assert.equal((await importedBuild).status(), 202);
  await app.app.builds.idle();
  assert.equal(app.app.builds.documentStatus(a.id).cv, "current");
  const boundDelete = await context.request.delete(
    origin + "/bewerbung/api/cv-mods/jobs/" + v2Job.id,
    {
      headers: { "X-Bewerbung-Request": "1" },
      data: { updated: v2Job.updated },
    },
  );
  assert.equal(boundDelete.status(), 409);
  await page.reload();
  await page.getByRole("button", { name: "Lebenslauf", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Überschrift", exact: true }),
  ).toHaveText("ImportedV2Marker83");
  await page.getByText("LaTeX-Vorlage hochladen", { exact: true }).click();
  await imports
    .locator(`[data-cv-mod-job="${v2Job.id}"]`)
    .getByText("Build-Prüfungen und Vorschau", { exact: true })
    .click();
  const proofLinks = imports
    .locator(`[data-cv-mod-job="${v2Job.id}"]`)
    .getByRole("link", { name: "PDF öffnen", exact: true });
  await expect(proofLinks).toHaveCount(4);
  const proof = await context.request.get(
    new URL((await proofLinks.first().getAttribute("href"))!, origin).href,
  );
  assert.equal(proof.status(), 200);
  assert.equal((await proof.body()).subarray(0, 5).toString(), "%PDF-");
  assert.equal(generated, 2);
  await choose(/Formular · Prüfvorlage CV/);
  const removedV2 = page.waitForResponse(
    (r) =>
      r.request().method() === "DELETE" &&
      r.url().endsWith("/cv-mods/jobs/" + v2Job.id),
  );
  await imports
    .locator(`[data-cv-mod-job="${v2Job.id}"]`)
    .getByRole("button", { name: "Entfernen", exact: true })
    .click();
  assert.equal((await removedV2).status(), 200);
  await expect(imports.locator(`[data-cv-mod-job="${v2Job.id}"]`)).toHaveCount(
    0,
  );
  await choice.click();
  await expect(
    page.getByRole("option", { name: /v2-portfolio.zip/ }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.screenshot({
    path: path.join(output, "v2-import-mobile.png"),
    animations: "disabled",
  });
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
    realOfflinePdfBuilds: 14,
    v2UploadToPublishedForm: true,
    v1Compatibility: true,
    v2UsedImportDeletionBlocked: true,
    v2ProofPdfDownload: true,
    v2NoGhostPackageCopies: true,
    v2UnboundImportRemovalUpdatesChoices: true,
    formModsInNormalWorkspace: true,
    formEntryActionsAndReload: true,
    universalEntryOrdering: true,
    newEntriesAtTop: true,
    sameSectionNativeDragAndDrop: true,
    crossSectionDropBlocked: true,
    keyboardAndFirstLastMoves: true,
    orderUndoKeepsLatestContent: true,
    pdfMatchesManualOrder: true,
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
  report.stack = e instanceof Error ? e.stack : undefined;
  report.dragTrace = await page?.evaluate("window.__orderDrag").catch(() => []);
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
  fs.rmSync(root, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 100,
  });
}
