import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { chromium, expect } from "@playwright/test";
import { Store } from "../server/store.ts";
import { checkApplicationSettings } from "./check-application-settings.ts";

if (process.env.SMOKE_SYNTHETIC !== "1")
  throw new Error("Synthetic opt-in required");
const project = process.cwd();
const runtime = path.resolve(process.env.SMOKE_RUNTIME || "native-t3/runtime");
const output = path.resolve(
  process.env.SMOKE_REPORT_DIR || ".work/application-sidebar-proof",
);
fs.mkdirSync(output, { recursive: true, mode: 0o700 });
const root = fs.mkdtempSync(path.join(os.tmpdir(), "bewerbung-sidebar-"));
const appRoot = path.join(root, "app"),
  data = path.join(root, "data"),
  home = path.join(root, "user");
fs.mkdirSync(path.join(appRoot, "native-t3"), { recursive: true });
fs.mkdirSync(home);
fs.symlinkSync(path.join(project, "builder"), path.join(appRoot, "builder"));
const config = JSON.parse(fs.readFileSync("native-t3/config.json", "utf8"));
fs.writeFileSync(
  path.join(appRoot, "native-t3/config.json"),
  JSON.stringify({ ...config, directory: runtime }),
);
const store = new Store(data);
const a = store.create({ company: "SYNTHETIC A", role: "Engineer" });
const b = store.create({ company: "SYNTHETIC B", role: "Designer" });
store.db.prepare("UPDATE apps SET status='Entwurf' WHERE id=?").run(a.id);
store.db.prepare("UPDATE preferences SET value=? WHERE singleton=1").run(
  JSON.stringify({
    ...store.preferences.settings(),
    revision: 7,
    theme: "dark",
    sendOnEnter: false,
    defaultProvider: "codex",
  }),
);
store.close();
const origin = "http://127.0.0.1:3160";
let child: ReturnType<typeof spawn> | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let logs = "";
const report: Record<string, unknown> = { modelTurns: 0, status: "FAILED" };
try {
  child = spawn(
    process.execPath,
    [
      "--import",
      path.join(project, "node_modules/tsx/dist/loader.mjs"),
      path.join(project, "server/main.ts"),
    ],
    {
      cwd: appRoot,
      env: {
        ...process.env,
        HOME: home,
        DATA_DIR: data,
        PUBLIC_ORIGIN: origin,
        PUBLIC_PORT: "3160",
        T3_NATIVE_PORT: "3161",
        LEGACY_PORT: "3162",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Synthetic server startup deadline")),
      65000,
    );
    for (const stream of [child!.stdout!, child!.stderr!])
      stream.on("data", (chunk) => {
        logs = (logs + chunk).slice(-100000);
        if (logs.includes("Bewerbungsverwaltung und originaler T3-Chat")) {
          clearTimeout(timer);
          resolve();
        }
      });
    child!.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error("Synthetic server exit " + code));
    });
  });
  browser = await chromium.launch({
    headless: true,
    executablePath:
      "/home/redjoker/.cache/ms-playwright/chromium_headless_shell-1254/chrome-headless-shell-linux64/chrome-headless-shell",
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const modelCommands: string[] = [];
  page.on("websocket", (socket) =>
    socket.on("framesent", (frame) => {
      const text = String(frame.payload);
      if (
        text.includes('"type":"thread.turn.start"') ||
        text.includes('"type":"thread.message.enqueue"')
      )
        modelCommands.push("unexpected-model-command");
    }),
  );
  await page.goto(origin + "/");
  await expect(page).toHaveURL(origin + "/bewerbungen");
  await expect(page.locator("[data-applications-sidebar]")).toHaveCount(1);
  await expect(page.locator("[data-app-sidebar]")).toHaveCount(1);
  await expect(page.locator("[data-slot=sidebar]")).toHaveCount(1);
  await expect(page.locator(`[data-application-id="${a.id}"]`)).toHaveCount(1);
  await expect(
    page.getByRole("region", { name: "In Arbeit", exact: true }),
  ).toHaveCount(1);
  await page.screenshot({ path: path.join(output, "sidebar-desktop.png") });
  report.singleNativeSidebar = true;
  const list = await (
    await page.request.get(origin + "/bewerbung/api/applications")
  ).json();
  assert.equal(
    list.find((item: { id: string }) => item.id === a.id).status,
    "In Arbeit",
  );
  assert.equal(
    list.find((item: { id: string }) => item.id === a.id).revision,
    a.revision + 1,
  );
  report.mergedActiveStatus = true;
  await page
    .getByRole("button", { name: "Neuer Chat: SYNTHETIC A", exact: true })
    .click();
  await page.waitForURL(/\/draft\//);
  const firstDraft = new URL(page.url()).pathname.split("/").at(-1)!;
  const editor = page.locator('[contenteditable="true"]:visible').first();
  await expect(editor).toBeVisible();
  await editor.fill("SYNTHETIC UNSENT CHAT ONE");
  await page
    .getByRole("button", { name: "Neuer Chat: SYNTHETIC A", exact: true })
    .click();
  await page.waitForURL(
    (url) =>
      url.pathname.startsWith("/draft/") && !url.pathname.endsWith(firstDraft),
  );
  const secondDraft = new URL(page.url()).pathname.split("/").at(-1)!;
  assert.notEqual(firstDraft, secondDraft);
  await editor.fill("SYNTHETIC UNSENT CHAT TWO");
  await page
    .locator(`[data-chat-draft-id="${firstDraft}"]`)
    .getByRole("button")
    .first()
    .click();
  await expect(editor).toContainText("SYNTHETIC UNSENT CHAT ONE");
  await page
    .locator(`[data-chat-draft-id="${secondDraft}"]`)
    .getByRole("button")
    .first()
    .click();
  await expect(editor).toContainText("SYNTHETIC UNSENT CHAT TWO");
  await page.reload();
  await expect(editor).toContainText("SYNTHETIC UNSENT CHAT TWO");
  await expect(
    page.locator(`[data-chat-draft-id="${firstDraft}"]`),
  ).toHaveCount(1);
  report.multipleIndependentPersistentChatDrafts = true;
  await expect(
    page.getByRole("button", { name: /Start voice input/ }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: /Worktree|Switch environment|Pull request/i,
    }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Neue Bewerbung", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Unternehmen", exact: true })
    .fill("SYNTHETIC C");
  await page.getByRole("textbox", { name: "Rolle", exact: true }).fill("QA");
  await page
    .getByRole("button", { name: "Bewerbung anlegen", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "SYNTHETIC C", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "SYNTHETIC C · QA", exact: true }),
  ).toHaveCount(1);
  report.syntheticApplicationCreation = true;
  await page
    .getByRole("button", { name: "SYNTHETIC B · Designer", exact: true })
    .click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Bewerbung löschen", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Bewerbung löschen", exact: true })
    .click();
  await expect(page.locator(`[data-application-id="${b.id}"]`)).toHaveCount(0);
  await expect(page.locator(`[data-application-id="${a.id}"]`)).toHaveCount(1);
  report.syntheticApplicationDeletion = true;
  await page
    .getByRole("button", { name: "SYNTHETIC A · Engineer", exact: true })
    .click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Status ändern", exact: true })
    .hover();
  await page
    .getByRole("menuitemradio", { name: "Fertig", exact: true })
    .click();
  await page
    .getByRole("region", { name: "Fertig", exact: true })
    .getByRole("button")
    .first()
    .click();
  await expect(page.locator(`[data-application-id="${a.id}"]`)).toHaveCount(1);
  report.applicationStatusChange = true;
  await page.goto(origin + "/settings/general");
  for (const name of [
    "Diffs & pull requests",
    "Voice",
    "SnapShots",
    "Devices",
    "Source control",
    "Worktrees",
    "Environments",
    "Sharing & access",
    "Labs",
  ])
    await expect(
      page.locator("[data-settings-section]").filter({ hasText: name }),
    ).toHaveCount(0);
  await expect(
    page.locator('[data-settings-section="/settings/projects"]'),
  ).toContainText("Bewerbungen");
  report.retiredSettingsNavigation = true;
  await page.goto(origin + "/settings/voice");
  await expect(
    page.getByRole("heading", { name: "Page not found", exact: true }),
  ).toBeVisible();
  report.retiredSettingsDirectRoute = true;
  Object.assign(
    report,
    await checkApplicationSettings(page, origin, data, output),
  );
  await page.goto(origin + "/bewerbungen");
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: /Toggle.*sidebar/i })
    .first()
    .click();
  await expect(
    page.getByRole("navigation", { name: "Bewerbungen", exact: true }),
  ).toBeVisible();
  await expect(page.locator("[data-applications-sidebar]")).toHaveCount(1);
  await page.screenshot({ path: path.join(output, "sidebar-mobile.png") });
  report.singleMobileSidebar = true;
  assert.deepEqual(errors, []);
  assert.deepEqual(modelCommands, []);
  report.status = "PASS";
} catch (error) {
  report.error = String(error).replace(/https?:\/\/[^\s"']+/g, "[URL]");
  process.exitCode = 1;
} finally {
  await browser?.close();
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill("SIGTERM");
    await Promise.race([
      once(child, "exit"),
      new Promise<void>((resolve) =>
        setTimeout(() => {
          child?.kill("SIGKILL");
          resolve();
        }, 12000),
      ),
    ]);
  }
  fs.writeFileSync(
    path.join(output, "sidebar-result.json"),
    JSON.stringify(report, null, 2),
    { mode: 0o600 },
  );
  console.log(JSON.stringify(report));
  fs.rmSync(root, { recursive: true, force: true });
}
