import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { zipSync } from "fflate";
import { chromium, expect } from "@playwright/test";
import { createApp } from "../server/app.ts";
import { CvModImports } from "../server/cv-mod-prototype/imports.ts";
import { cvModPrototypeRoutes } from "../server/cv-mod-prototype/routes.ts";

if (process.env.SMOKE_SYNTHETIC !== "1")
  throw new Error("SMOKE_SYNTHETIC=1 required; no production fixture or model");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "cv-mod-browser-")),
  output = path.resolve(".work/cv-mod-prototype-start/browser");
fs.mkdirSync(output, { recursive: true, mode: 0o700 });
const port = Number(process.env.SMOKE_PORT || 3180),
  origin = "http://127.0.0.1:" + port;
let generated = 0;
const texts: Record<string, string> = {
  bullets:
    "Demo Applicant Engineer Example Company 2020 BulletMarker17 BulletMarker29 SecondEntryMarker61",
  paragraphs: "ParagraphMarker31 with 50% & Rust_2026.",
  mixed: "BeforeMarker41 MiddleMarker43 AfterMarker47",
  "optional-role": "RoleMarker42 OptionalMarker53",
  empty: "EmptyMarker59",
};
const imports = new CvModImports(
  path.join(root, "mod-imports"),
  {
    generate: async (w, onThread) => {
      generated++;
      fs.mkdirSync(path.join(w, "mod", "layout"), { recursive: true });
      fs.writeFileSync(
        path.join(w, "mod", "layout", "main.tex"),
        fs.readFileSync("test/fixtures/cv-mod-synthetic.tex"),
      );
      fs.writeFileSync(
        path.join(w, "mod", "mod.json"),
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
  },
  async (input, out) => {
    fs.writeFileSync(
      path.join(out, "document.pdf"),
      "%PDF-1.4\nsynthetic UI boundary only",
    );
    return {
      text: texts[path.basename(path.dirname(input))]!,
      log: "synthetic builder boundary",
    };
  },
);
const app = createApp(path.join(root, "app"), async () => "", port, undefined, {
  configureApi: (api) =>
    cvModPrototypeRoutes(api, imports, {
      publicOrigin: origin,
      cookieName: "prototype_session",
      token: async () => "synthetic-owner",
    }),
});
const server = app.web.listen(port, "127.0.0.1");
await new Promise<void>((r) => server.once("listening", r));
const browser = await chromium.launch({
  headless: true,
  executablePath:
    "/home/redjoker/.cache/ms-playwright/chromium_headless_shell-1254/chrome-headless-shell-linux64/chrome-headless-shell",
});
const report: Record<string, unknown> = {
  status: "FAILED",
  paidModelCalls: 0,
  errors: [],
};
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1050 },
  });
  await context.addCookies([
    { name: "prototype_session", value: "synthetic-owner", url: origin },
  ]);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(origin + "/bewerbung/api/prototype/cv-mods");
  await expect(
    page.getByRole("heading", { name: "Vorlage hochladen", exact: true }),
  ).toBeVisible();
  await page.locator("#document-type").selectOption("document");
  await page.locator("#file").setInputFiles({
    name: "invalid.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4"),
  });
  await expect(page.getByRole("alert")).toContainText("Eine PDF allein");
  assert.equal(generated, 0);
  const zip = Buffer.from(
    zipSync({
      "cv/main.tex": Buffer.from(
        "\\documentclass{article}\\begin{document}Synthetic\\end{document}",
      ),
      "cv/build/old.pdf": Buffer.from("ignore"),
    }),
  );
  await page.locator("#file").setInputFiles({
    name: "synthetic-cv.zip",
    mimeType: "application/zip",
    buffer: zip,
  });
  await expect(
    page.getByRole("button", { name: "Hochladen & KI starten", exact: true }),
  ).toBeDisabled();
  assert.equal(generated, 0);
  await page.locator("#document-type").selectOption("cv-template");
  await page.screenshot({ path: path.join(output, "upload-desktop.png") });
  await page
    .getByRole("button", { name: "Hochladen & KI starten", exact: true })
    .click();
  await expect(page.locator("#job-status")).toHaveText("Zur Durchsicht", {
    timeout: 15000,
  });
  assert.equal(generated, 1);
  assert.equal(app.store.list().length, 0);
  await expect(
    page.getByRole("link", { name: "KI-Thread öffnen ↗", exact: true }),
  ).toHaveAttribute("href", origin + "/synthetic-environment/synthetic-thread");
  await expect(page.locator("#checks li")).toHaveCount(5);
  await expect(page.locator("#fields")).toContainText("Optional");
  await page.screenshot({ path: path.join(output, "review-desktop.png") });
  const pdf = await context.request.get(
    origin +
      "/bewerbung/api/prototype/cv-mods/jobs/" +
      imports.list()[0]!.id +
      "/pdf/mixed",
  );
  assert.equal(pdf.status(), 200);
  assert.equal(pdf.headers()["content-type"], "application/pdf");
  await page.reload();
  await page
    .getByRole("button")
    .filter({ hasText: "synthetic-cv.zip" })
    .click();
  await expect(page.locator("#job-status")).toHaveText("Zur Durchsicht");
  assert.equal(generated, 1);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  await page.screenshot({ path: path.join(output, "review-mobile.png") });
  assert.deepEqual(errors, []);
  Object.assign(report, {
    status: "PASS",
    mockAdapterGenerations: generated,
    documentTypeGate: true,
    invalidPdfRejected: true,
    persistedJobAfterReload: true,
    optionalModFields: true,
    pdfEndpoint: true,
    zeroApplicationsCreated: true,
    mobileNoOverflow: true,
    errors,
  });
} finally {
  await browser.close();
  await imports.close();
  await app.close();
  await new Promise<void>((r) => server.close(() => r()));
  fs.rmSync(root, { recursive: true, force: true });
  fs.writeFileSync(
    path.join(output, "report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
}
