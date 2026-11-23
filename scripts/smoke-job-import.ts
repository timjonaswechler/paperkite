import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import assert from "node:assert/strict";
import { once } from "node:events";
import { chromium, expect } from "@playwright/test";
import { Store } from "../server/store.ts";
import { startT3Application } from "../server/t3-main.ts";

// Real public job fetch + native dialog/API/model adapter, but only a local
// deterministic provider. No application, chat turn or paid model call is made.
if (process.env.SMOKE_SYNTHETIC !== "1")
  throw new Error("Synthetic opt-in required");
const project = process.cwd();
const capture = JSON.parse(
  fs.readFileSync(
    path.join(
      project,
      "test/fixtures/job-postings/tu-darmstadt-58396.capture.json",
    ),
    "utf8",
  ),
);
const root = fs.mkdtempSync(path.join(os.tmpdir(), "paperkite-job-import-"));
const data = path.join(root, "data");
const home = path.join(root, "home");
const output = path.resolve(
  process.env.SMOKE_REPORT_DIR || ".work/job-import-proof",
);
fs.mkdirSync(output, { recursive: true, mode: 0o700 });
fs.mkdirSync(home);
fs.mkdirSync(path.join(root, "native-t3"));
fs.symlinkSync(path.join(project, "builder"), path.join(root, "builder"));
const config = JSON.parse(fs.readFileSync("native-t3/config.json", "utf8"));
fs.writeFileSync(
  path.join(root, "native-t3/config.json"),
  JSON.stringify({ ...config, directory: path.resolve(config.directory) }),
);
let calls = 0;
let providerError: unknown;
const provider = http.createServer(async (req, res) => {
  try {
    res.setHeader("Content-Type", "application/json");
    if (req.method === "GET" && req.url?.endsWith("/models")) {
      res.end(
        JSON.stringify({ data: [{ id: "fixture-model", object: "model" }] }),
      );
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const payload = JSON.parse(Buffer.concat(chunks).toString());
    assert.equal(payload.model, "fixture-model");
    const prompt = JSON.stringify(payload.messages);
    assert.match(prompt, /untrusted source data/);
    assert.ok(prompt.includes(capture.page.url));
    assert.ok(prompt.includes(capture.expected.company));
    assert.ok(prompt.includes(capture.expected.role));
    for (const requirement of capture.expected.requirements)
      assert.ok(prompt.includes(requirement), requirement);
    calls++;
    res.end(
      JSON.stringify({
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: JSON.stringify({
                company: capture.expected.company,
                role: capture.expected.role,
                requirements: capture.expected.requirements,
              }),
            },
          },
        ],
      }),
    );
  } catch (error) {
    providerError = error;
    res.statusCode = 500;
    res.end(JSON.stringify({ error: "Test provider assertion failed" }));
  }
});
provider.listen(0, "127.0.0.1");
await once(provider, "listening");
const address = provider.address();
assert.ok(address && typeof address === "object");
fs.mkdirSync(path.join(data, "native-t3/userdata"), { recursive: true });
fs.writeFileSync(
  path.join(data, "native-t3/userdata/settings.json"),
  JSON.stringify({
    textGenerators: {
      "analysis-fixture": {
        kind: "openaiCompatible",
        label: "Local import test",
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
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
store.preferences.update({
  revision: store.preferences.settings().revision,
  analysisModel: { instanceId: "analysis-fixture", model: "fixture-model" },
});
store.close();
const keys = [
  "HOME",
  "PUBLIC_ORIGIN",
  "PUBLIC_PORT",
  "T3_NATIVE_PORT",
  "LEGACY_PORT",
  "DATA_DIR",
];
const savedEnvironment = Object.fromEntries(
  keys.map((key) => [key, process.env[key]]),
);
const origin = "http://127.0.0.1:3170";
Object.assign(process.env, {
  HOME: home,
  PUBLIC_ORIGIN: origin,
  PUBLIC_PORT: "3170",
  T3_NATIVE_PORT: "3171",
  LEGACY_PORT: "3172",
  DATA_DIR: data,
});
process.chdir(root);
let application: Awaited<ReturnType<typeof startT3Application>> | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  application = await startT3Application({ logNative: () => {} });
  browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.CHROMIUM_PATH ||
      "/home/redjoker/.cache/ms-playwright/chromium_headless_shell-1254/chrome-headless-shell-linux64/chrome-headless-shell",
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  page.setDefaultTimeout(45000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(origin + "/bewerbungen");
  await page
    .getByRole("button", { name: "Neue Bewerbung", exact: true })
    .last()
    .click();
  const response = page.waitForResponse(
    (res) =>
      res.url().endsWith("/bewerbung/api/job-analysis") &&
      res.request().method() === "POST",
  );
  await page
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
    }, capture.page.url);
  const analysisResponse = await response;
  assert.equal(
    analysisResponse.request().postDataJSON().text,
    undefined,
    "No manual text may be injected",
  );
  assert.equal(analysisResponse.status(), 200, await analysisResponse.text());
  const analysis = await analysisResponse.json();
  assert.equal(analysis.url, capture.page.url);
  await expect(page.getByLabel("Unternehmen", { exact: true })).toHaveValue(
    capture.expected.company,
  );
  await expect(page.getByLabel("Rolle / Stelle", { exact: true })).toHaveValue(
    capture.expected.role,
  );
  for (const requirement of capture.expected.requirements)
    await expect(page.getByText(requirement, { exact: true })).toBeVisible();
  await expect(
    page.getByLabel("Ausschreibungstext", { exact: true }),
  ).toHaveValue("");
  await expect(
    page.getByRole("button", { name: "Bewerbung anlegen", exact: true }),
  ).toBeEnabled();
  assert.equal(providerError, undefined);
  assert.equal(calls, 1);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: path.join(output, "dialog.png") });
  fs.writeFileSync(
    path.join(output, "result.json"),
    JSON.stringify(
      {
        status: "PASS",
        sourceUrl: analysis.url,
        company: analysis.company,
        role: analysis.role,
        textLength: analysis.text.length,
        providerCalls: calls,
        paidModelCalls: 0,
        manualText: false,
        applicationCreated: false,
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS live TU Darmstadt import through native dialog, real fetch/API and local test provider",
  );
} finally {
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
}
