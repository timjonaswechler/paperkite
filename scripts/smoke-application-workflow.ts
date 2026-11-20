import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { unzipSync } from "fflate";
import { chromium, expect } from "@playwright/test";
import { Store } from "../server/store.ts";
import { startT3Application } from "../server/t3-main.ts";

if (process.env.SMOKE_SYNTHETIC !== "1")
  throw new Error("Synthetic opt-in required");
const project = process.cwd();
const runtime = path.resolve(process.env.SMOKE_RUNTIME || "native-t3/runtime");
const output = path.resolve(
  process.env.SMOKE_REPORT_DIR || ".work/application-workflow-proof",
);
fs.mkdirSync(output, { recursive: true, mode: 0o700 });
const root = fs.mkdtempSync(path.join(os.tmpdir(), "bewerbung-workflow-")),
  data = path.join(root, "data"),
  home = path.join(root, "user");
fs.mkdirSync(path.join(root, "native-t3"));
fs.mkdirSync(home);
fs.mkdirSync(path.join(root, "pdf-tools"));
fs.symlinkSync(path.join(project, "builder"), path.join(root, "builder"));
const image =
  process.env.SMOKE_PDF_IMAGE ||
  fs.readFileSync(path.join(project, "pdf-tools/image-id"), "utf8").trim();
fs.writeFileSync(path.join(root, "pdf-tools/image-id"), image);
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
const advertisement =
  "SYNTHETIC LINK COMPANY sucht einen Software Engineer. Erforderlich sind TypeScript, Datenbanken und die Entwicklung zuverlässiger Anwendungen. Die Stelle ist in Berlin und bietet hybrides Arbeiten.";
let analysisRequests = 0;
let firstResponse: http.ServerResponse | undefined;
let firstSeen!: () => void;
let firstFailed!: (error: Error) => void;
const firstRequest = new Promise<void>((resolve, reject) => {
  firstSeen = resolve;
  firstFailed = reject;
});
let firstClosed!: () => void;
const closedFirst = new Promise<void>((resolve) => (firstClosed = resolve));
const provider = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url?.endsWith("/models")) {
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({ data: [{ id: "fixture-model", object: "model" }] }),
    );
    return;
  }
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const payload = JSON.parse(Buffer.concat(chunks).toString());
  assert.equal(payload.model, "fixture-model");
  analysisRequests++;
  const prompt = JSON.stringify(payload.messages);
  assert.match(prompt, /Extract the employer/);
  assert.match(prompt, /untrusted source data/);
  if (prompt.includes("jobs.example/slow")) {
    firstResponse = res;
    res.once("close", firstClosed);
    firstSeen();
    return;
  }
  res.setHeader("Content-Type", "application/json");
  res.end(
    JSON.stringify({
      choices: [
        {
          finish_reason: "stop",
          message: {
            content: JSON.stringify({
              company: "SYNTHETIC LINK COMPANY",
              role: "Software Engineer",
              requirements: ["TypeScript", "Datenbanken"],
            }),
          },
        },
      ],
    }),
  );
});
provider.listen(0, "127.0.0.1");
await once(provider, "listening");
const providerAddress = provider.address();
assert.ok(providerAddress && typeof providerAddress === "object");
fs.mkdirSync(path.join(data, "native-t3/userdata"), { recursive: true });
fs.writeFileSync(
  path.join(data, "native-t3/userdata/settings.json"),
  JSON.stringify({
    textGenerators: {
      "analysis-fixture": {
        kind: "openaiCompatible",
        label: "SYNTHETIC analysis",
        baseUrl: `http://127.0.0.1:${providerAddress.port}/v1`,
        apiKey: "fixture-only",
        enabled: true,
      },
    },
    textGenerationModelSelection: {
      instanceId: "analysis-fixture",
      model: "fixture-model",
    },
  }),
);
const store = new Store(data);
store.import({
  format: "bewerbung-template-v1",
  files: Object.fromEntries(
    Object.entries({
      "cv/Lebenslauf.tex":
        "\\documentclass[a4paper]{article}\n\\begin{document}\nSYNTHETIC CV\\\\\n\\directlua{local p=dofile('profiles/general.lua');tex.sprint(p.personal.name)}\n\\end{document}\n",
      "cv/lua/loader.lua": "return {}",
      "cv/profiles/general.lua":
        'return { personal = { name = "SYNTHETIC APPLICANT" }, experience = {}, engagement = {}, skills = {}, custom = "keep" }',
    }).map(([name, text]) => [name, Buffer.from(text).toString("base64")]),
  ),
});
store.preferences.update({
  revision: store.preferences.settings().revision,
  analysisModel: { instanceId: "analysis-fixture", model: "fixture-model" },
  applicantName: "SYNTHETIC APPLICANT",
});
store.close();
const savedEnvironment = Object.fromEntries(
  [
    "HOME",
    "PUBLIC_ORIGIN",
    "PUBLIC_PORT",
    "T3_NATIVE_PORT",
    "LEGACY_PORT",
    "DATA_DIR",
  ].map((key) => [key, process.env[key]]),
);
Object.assign(process.env, {
  HOME: home,
  PUBLIC_ORIGIN: "http://127.0.0.1:3160",
  PUBLIC_PORT: "3160",
  T3_NATIVE_PORT: "3161",
  LEGACY_PORT: "3162",
  DATA_DIR: data,
});
process.chdir(root);
let application: Awaited<ReturnType<typeof startT3Application>> | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const report: Record<string, unknown> = {
  status: "FAILED",
  paidModelCalls: 0,
  chatTurns: 0,
};
try {
  application = await startT3Application({ logNative: () => {} });
  const unauthenticated = await fetch(
    "http://127.0.0.1:3161/api/bewerbung/analyze",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: advertisement,
        sourceUrl: "https://jobs.example/42",
      }),
    },
  );
  assert.equal(unauthenticated.status, 401);
  assert.equal(analysisRequests, 0);
  report.nativeAnalysisRequiresAuthentication = true;
  browser = await chromium.launch({
    headless: true,
    executablePath:
      "/home/redjoker/.cache/ms-playwright/chromium_headless_shell-1254/chrome-headless-shell-linux64/chrome-headless-shell",
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (
      response.url().endsWith("/bewerbung/api/job-analysis") &&
      response.status() >= 400
    )
      void response
        .text()
        .then((body) =>
          firstFailed(
            new Error(`Analysis failed ${response.status()}: ${body}`),
          ),
        )
        .catch(() => {});
  });
  page.on("websocket", (socket) =>
    socket.on("framesent", (frame) => {
      const text = String(frame.payload);
      if (
        text.includes('"type":"thread.turn.start"') ||
        text.includes('"type":"thread.message.enqueue"')
      )
        report.chatTurns = Number(report.chatTurns) + 1;
    }),
  );
  // Supply a synthetic advertisement at the network boundary, not a fake analysis response.
  // The real business API, native authorization, text-generation service and model HTTP adapter run.
  await page.route("**/bewerbung/api/job-analysis", (route) => {
    const body = route.request().postDataJSON();
    return route.continue({
      postData: JSON.stringify({ ...body, text: advertisement }),
    });
  });
  const origin = "http://127.0.0.1:3160";
  await page.goto(origin + "/bewerbungen");
  await page
    .getByRole("button", { name: "Neue Bewerbung", exact: true })
    .last()
    .click();
  await expect(page.getByLabel("Stellen-Link", { exact: true })).toBeVisible();
  await expect(page.getByText("Ausgangsbasis", { exact: true })).toHaveCount(0);
  const paste = (url: string) =>
    page
      .getByLabel("Stellen-Link", { exact: true })
      .evaluate((element, url) => {
        const clipboard = new DataTransfer();
        clipboard.setData("text/plain", url);
        element.dispatchEvent(
          new ClipboardEvent("paste", {
            bubbles: true,
            cancelable: true,
            clipboardData: clipboard,
          }),
        );
      }, url);
  const nativeDb = new DatabaseSync(
    path.join(data, "native-t3/userdata/statev2.sqlite"),
    {
      readOnly: true,
    },
  );
  const threadsBefore = nativeDb
    .prepare(
      "SELECT thread_id FROM orchestration_v2_projection_threads ORDER BY thread_id",
    )
    .all();
  await paste("https://jobs.example/slow");
  await firstRequest;
  await paste("https://jobs.example/42");
  await expect(page.getByLabel("Unternehmen", { exact: true })).toHaveValue(
    "SYNTHETIC LINK COMPANY",
  );
  if (firstResponse && !firstResponse.writableEnded)
    firstResponse.end(
      JSON.stringify({
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: JSON.stringify({
                company: "WRONG OLD RESULT",
                role: "Wrong",
                requirements: [],
              }),
            },
          },
        ],
      }),
    );
  await closedFirst;
  await expect(page.getByLabel("Unternehmen", { exact: true })).toHaveValue(
    "SYNTHETIC LINK COMPANY",
  );
  assert.equal(application.app.store.list().length, 0);
  assert.deepEqual(
    nativeDb
      .prepare(
        "SELECT thread_id FROM orchestration_v2_projection_threads ORDER BY thread_id",
      )
      .all(),
    threadsBefore,
  );
  nativeDb.close();
  await page
    .getByLabel("Unternehmen", { exact: true })
    .fill("REVIEWED COMPANY");
  await page
    .getByRole("button", { name: "Bewerbung anlegen", exact: true })
    .click();
  await expect(
    page.getByRole("link", {
      name: "Bewerbung öffnen: REVIEWED COMPANY",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Deine Bewerbung vorbereiten",
      exact: true,
    }),
  ).toBeVisible();
  const created = application.app.store.list()[0]!;
  assert.equal(created.company, "REVIEWED COMPANY");
  assert.equal(created.role, "Software Engineer");
  assert.match(created.posting, /https:\/\/jobs.example\/42/);
  assert.match(created.posting, /TypeScript/);
  assert.equal(application.app.store.templates()[0]!.id, created.template);
  await page.screenshot({
    path: path.join(output, "overview-desktop.png"),
    animations: "disabled",
  });
  report.linkOnboarding = true;
  report.canceledAnalysisCannotOverwriteNewLink = true;
  report.noChatOrApplicationBeforeConfirmation = true;
  report.standardTemplateWithoutSourceChoice = true;

  await page.getByRole("button", { name: "Lebenslauf", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Name", exact: true })
    .fill("UPDATED SYNTHETIC APPLICANT");
  await page.getByRole("button", { name: "Hinzufügen", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "Berufserfahrung", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Position", exact: true })
    .fill("SYNTHETIC ROLE");
  const cvBody = page.getByRole("textbox", { name: "Inhalt", exact: true });
  await cvBody.click();
  await page
    .getByRole("button", { name: "Aufzählung umschalten", exact: true })
    .click();
  await cvBody.pressSequentially("SYNTHETIC ACHIEVEMENT");
  const cvQueued = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().endsWith(`/applications/${created.id}/builds`),
  );
  await page
    .getByRole("button", { name: "Speichern & PDF bauen", exact: true })
    .click();
  assert.equal((await cvQueued).status(), 202);
  await application.app.builds.idle();
  await page.getByRole("button", { name: "PDF-Vorschau", exact: true }).click();
  await expect(
    page.getByText("Aktueller Quellenstand", { exact: true }),
  ).toBeVisible();
  assert.equal(
    application.app.store.profile(created.id, "cv/profiles/general.lua").entries
      .custom,
    "keep",
  );
  const cv = application.app.store
    .builds(created.id)
    .find((build) => build.kind === "cv" && build.status === "success");
  assert.ok(cv);
  const certificateBytes = fs.readFileSync(
    application.app.builds.artifact(created.id, String(cv.id)),
  );
  const upload = await page.request.post(origin + "/bewerbung/api/documents", {
    headers: {
      "Content-Type": "application/octet-stream",
      "X-Bewerbung-Request": "1",
      "X-Bewerbung-Filename": "SYNTHETIC-CERTIFICATE.pdf",
    },
    data: certificateBytes,
  });
  assert.equal(upload.status(), 201);
  const certificate = await upload.json();
  await page.getByRole("button", { name: "Anschreiben", exact: true }).click();
  await page
    .getByLabel("Absender", { exact: true })
    .fill("SYNTHETIC APPLICANT\nTestweg 1\n12345 Teststadt");
  await page
    .getByLabel("Anschreibentext", { exact: true })
    .fill(
      "Dies ist ein synthetisches Anschreiben für den integrierten Browsernachweis.\n\nKenntnisse in TypeScript und Datenbanken passen zur ausgeschriebenen Stelle.",
    );
  const coverQueued = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().endsWith(`/applications/${created.id}/builds`),
  );
  await page
    .getByRole("button", { name: "Speichern & PDF bauen", exact: true })
    .click();
  assert.equal((await coverQueued).status(), 202);
  await application.app.builds.idle();
  await expect(
    page.getByText("Aktueller Quellenstand", { exact: true }),
  ).toBeVisible();
  assert.deepEqual(application.app.builds.documentStatus(created.id), {
    cv: "current",
    cover: "current",
  });
  await page.screenshot({
    path: path.join(output, "cover-desktop.png"),
    animations: "disabled",
  });
  report.structuredCvEditor = true;
  report.plainLetterEditor = true;
  report.realOfflinePdfBuilds = true;

  await page.getByRole("button", { name: "Versandpaket", exact: true }).click();
  await page
    .getByRole("button", { name: "Anlagen auswählen", exact: true })
    .click();
  await page
    .getByRole("checkbox", {
      name: "SYNTHETIC-CERTIFICATE.pdf auswählen",
      exact: true,
    })
    .check();
  await page
    .getByRole("button", { name: "Auswahl übernehmen", exact: true })
    .click();
  await expect(
    page.getByRole("checkbox", {
      name: "SYNTHETIC-CERTIFICATE.pdf in Ausgabe 1",
      exact: true,
    }),
  ).toBeChecked();
  await page
    .getByRole("button", { name: "Versandpaket erstellen", exact: true })
    .click();
  await application.app.deliveries.idle();
  await expect(page.getByText("Bereit", { exact: true })).toBeVisible();
  const combinedDownload = page.waitForEvent("download");
  await page
    .getByRole("link", { name: "Herunterladen", exact: true })
    .first()
    .click();
  const combinedFile = await combinedDownload;
  const combinedPath = await combinedFile.path();
  assert.ok(combinedPath);
  assert.match(
    combinedFile.suggestedFilename(),
    /^Bewerbung_SYNTHETIC_APPLICANT_REVIEWED_COMPANY_Software_Engineer\.pdf$/,
  );
  const combinedBytes = fs.readFileSync(combinedPath);
  assert.equal(combinedBytes.subarray(0, 5).toString(), "%PDF-");
  await page.getByLabel("Download-Format", { exact: true }).click();
  await page
    .getByRole("option", {
      name: "ZIP mit getrennten PDF-Dateien",
      exact: true,
    })
    .click();
  await page.getByLabel("Ausgabemodus 3", { exact: true }).click();
  await page
    .getByRole("option", { name: "Eine Original-PDF unverändert", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Versandpaket erstellen", exact: true })
    .click();
  await application.app.deliveries.idle();
  await expect(page.getByText("Bereit", { exact: true })).toHaveCount(2);
  const zipDownload = page.waitForEvent("download");
  await page
    .getByRole("link", { name: "Herunterladen", exact: true })
    .first()
    .click();
  const zipFile = await zipDownload;
  const zipPath = await zipFile.path();
  assert.ok(zipPath);
  const files = unzipSync(fs.readFileSync(zipPath));
  const originalName = Object.keys(files).find((name) =>
    name.startsWith("Anlagen_"),
  );
  assert.ok(originalName);
  assert.deepEqual(Buffer.from(files[originalName]!), certificateBytes);
  assert.deepEqual(
    application.app.store.documents.bytes(certificate.id),
    certificateBytes,
  );
  assert.equal(Object.keys(files).length, 3);
  report.overallPdfAndSeparateZip = true;
  report.originalPdfBytesUnchanged = true;
  report.predefinedDownloadNames = true;
  await page.reload();
  await page.getByRole("button", { name: "Versandpaket", exact: true }).click();
  await expect(page.getByText("Bereit", { exact: true })).toHaveCount(2);
  report.packagePlanAndResultsSurviveReload = true;
  await page.screenshot({
    path: path.join(output, "package-desktop.png"),
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Übersicht", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("heading", {
      name: "Deine Bewerbung vorbereiten",
      exact: true,
    }),
  ).toBeVisible();
  const main = page.locator("main.scrollbar-gutter-both");
  assert.ok(
    await main.evaluate(
      (element) => element.scrollWidth <= element.clientWidth + 1,
    ),
  );
  await page.screenshot({
    path: path.join(output, "overview-mobile.png"),
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Versandpaket", exact: true }).click();
  assert.ok(
    await main.evaluate(
      (element) => element.scrollWidth <= element.clientWidth + 1,
    ),
  );
  await page.screenshot({
    path: path.join(output, "package-mobile.png"),
    animations: "disabled",
  });
  await page
    .getByRole("button", { name: "Chats (optional)", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Optionale KI-Unterstützung",
      exact: true,
    }),
  ).toBeVisible();
  assert.equal(application.app.store.list().length, 1);
  assert.equal(report.chatTurns, 0);
  assert.equal(analysisRequests, 2);
  assert.deepEqual(errors, []);
  report.optionalChats = true;
  report.responsiveWorkspace = true;
  report.analysisRequests = analysisRequests;
  report.status = "PASS";
} catch (error) {
  report.error = String(error)
    .replace(/https?:\/\/[^\s)]+/g, "[URL]")
    .slice(0, 1600);
  process.exitCode = 1;
} finally {
  report.analysisRequests = analysisRequests;
  fs.writeFileSync(
    path.join(output, "workflow-result.json"),
    JSON.stringify(report, null, 2),
    {
      mode: 0o600,
    },
  );
  await browser?.close();
  await application?.close();
  provider.closeAllConnections();
  await new Promise<void>((resolve) => provider.close(() => resolve()));
  process.chdir(project);
  for (const [key, value] of Object.entries(savedEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(root, { recursive: true, force: true });
  console.log(JSON.stringify(report));
}
