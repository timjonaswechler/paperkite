// Full original T3 browser/runtime through the application gateway; synthetic data, no model turn.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { once } from "node:events";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { NativeT3Runtime } from "../server/t3-runtime.ts";
import { NativeT3Projects } from "../server/t3-projects.ts";
import { createT3Gateway, createLegacyRedirect } from "../server/t3-gateway.ts";
import { createApp } from "../server/app.ts";
const runtimeDirectory = process.env.SMOKE_T3_RUNTIME;
if (!runtimeDirectory || !process.env.SMOKE_SYNTHETIC)
  throw new Error(
    "Explicit copied SMOKE_T3_RUNTIME and SMOKE_SYNTHETIC required",
  );
const root = fs.mkdtempSync(path.join(os.tmpdir(), "bewerbung-t3-integrated-")),
  home = path.join(root, "user"),
  data = path.join(root, "data"),
  origin = "http://127.0.0.1:3160";
const state: Record<string, unknown> = {
  pid: process.pid,
  root,
  status: "running",
};
const phase = (value: string) => {
  state.phase = value;
  fs.writeFileSync(
    path.resolve("../native-app-progress.json"),
    JSON.stringify(state, null, 2),
    { mode: 0o600 },
  );
  console.log("SYNTHETIC phase", value);
};
let pairingResolve!: (url: string) => void;
const pairing = new Promise<string>((resolve) => (pairingResolve = resolve));
let logs = "";
const native = new NativeT3Runtime({
  directory: runtimeDirectory,
  sha256: createHash("sha256")
    .update(fs.readFileSync(path.join(runtimeDirectory, "t3")))
    .digest("hex"),
  home: path.join(root, "native"),
  cwd: path.join(data, "applications"),
  port: 3161,
  environment: {
    HOME: home,
    CODEX_HOME: path.join(home, ".codex"),
    PI_CODING_AGENT_DIR: path.join(home, ".pi", "agent"),
    PI_CODING_AGENT_SESSION_DIR: path.join(home, "pi-sessions"),
  },
  log: (text) => {
    logs = (logs + text).slice(-100000);
    const m = logs
      .replace(/\x1b\[[0-9;]*m/g, "")
      .match(/pairing\s*url:\s*(https?:\/\/\S+)/i);
    if (m) pairingResolve(m[1]!);
  },
});
let app: ReturnType<typeof createApp> | undefined,
  gateway: ReturnType<typeof createT3Gateway> | undefined,
  legacy: ReturnType<typeof createLegacyRedirect> | undefined,
  browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  phase("native-start");
  await native.start();
  phase("native-ready");
  app = createApp(data, async () => "", 3160, undefined, {
    extraHosts: ["127.0.0.1:3162"],
    nativeChat: (store) => new NativeT3Projects(store, native),
  });
  const documentBytes = Buffer.from("%PDF-1.7\nSYNTHETIC DOCUMENT ORIGINAL");
  const document = app.store.documents.upload("Synthetic.pdf", documentBytes);
  const a = app.store.create({
      company: "SYNTHETIC Native A",
      role: "Engineer",
      documentIds: [document.id],
    }),
    b = app.store.create({ company: "SYNTHETIC Native B", role: "Designer" });
  app.store.preferences.saveDraft(a.id, "SYNTHETIC LEGACY UNSENT DRAFT");
  app.store.save(
    a.id,
    "cv/profiles/native.lua",
    "return 'SYNTHETIC INITIAL SOURCE'",
    a.revision,
  );
  gateway = createT3Gateway(app.web, native.origin);
  gateway.listen(3160, "127.0.0.1");
  await once(gateway, "listening");
  legacy = createLegacyRedirect(app.web, origin);
  legacy.listen(3162, "127.0.0.1");
  await once(legacy, "listening");
  const redirected = await fetch(
    "http://127.0.0.1:3162/bewerbung/applications/" + a.id,
    { redirect: "manual" },
  );
  assert.equal(redirected.status, 308);
  assert.equal(
    redirected.headers.get("location"),
    origin + "/bewerbungen/" + a.id,
  );
  const cookieLess = await fetch(
    origin + "/bewerbung/api/applications/" + a.id + "/t3-project",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Bewerbung-Request": "1",
      },
      body: "{}",
    },
  );
  assert.equal(cookieLess.status, 401);
  assert.equal(
    (await fetch(origin + "/bewerbung/api/applications")).status,
    401,
  );
  assert.equal(
    (await fetch("http://127.0.0.1:3162/bewerbung/api/applications")).status,
    401,
  );
  browser = await chromium.launch({
    headless: true,
    executablePath:
      "/home/redjoker/.cache/ms-playwright/chromium_headless_shell-1254/chrome-headless-shell-linux64/chrome-headless-shell",
  });
  const context = await browser.newContext(),
    page = await context.newPage(),
    errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  phase("pairing-link");
  let pairingTimer: ReturnType<typeof setTimeout> | undefined;
  const ownedPairing = new URL(
    await Promise.race([
      pairing,
      new Promise<string>((_, reject) => {
        pairingTimer = setTimeout(
          () => reject(new Error("Native pairing link absent")),
          10000,
        );
      }),
    ]).finally(() => clearTimeout(pairingTimer)),
  );
  ownedPairing.port = "3160";
  phase("browser-pairing");
  await page.goto(ownedPairing.toString(), { waitUntil: "domcontentloaded" });
  await page.waitForURL((url) => !url.pathname.startsWith("/pair"), {
    timeout: 30000,
  });
  await page.waitForLoadState("networkidle");
  const nativeAuthCheck = await page.request.get(origin + "/api/auth/session");
  assert.equal(nativeAuthCheck.status(), 200);
  assert.equal((await nativeAuthCheck.json()).authenticated, true);
  const ensure = async (id: string) => {
    const response = await page.request.post(
      origin + "/bewerbung/api/applications/" + id + "/t3-project",
      { headers: { "X-Bewerbung-Request": "1", Origin: origin }, data: {} },
    );
    const body = await response.json();
    assert.equal(response.status(), 200, JSON.stringify(body));
    return body as { environmentId: string; projectId: string };
  };
  phase("native-projects");
  const pa = await ensure(a.id),
    again = await ensure(a.id),
    pb = await ensure(b.id);
  assert.deepEqual(pa, again);
  assert.notEqual(pa.projectId, pb.projectId);
  assert.equal(pa.environmentId, native.environment().environmentId);
  const snapshot = await (
    await page.request.get(origin + "/api/projects")
  ).json();
  assert.equal(
    snapshot.projects.find((p: { id: string }) => p.id === pa.projectId)
      .workspaceRoot,
    path.join(data, "applications", a.id, "workspace"),
  );
  const detail = await page.request.get(
    origin + "/bewerbung/api/applications/" + a.id,
  );
  assert.equal(detail.status(), 200);
  assert.equal((await detail.json()).harness.busy, false);
  const documentIndex = JSON.parse(
    fs.readFileSync(
      path.join(app.store.workspace(a.id), "bewerbungsunterlagen/auswahl.json"),
      "utf8",
    ),
  );
  assert.deepEqual(
    fs.readFileSync(
      path.join(app.store.workspace(a.id), documentIndex.documents[0].path),
    ),
    documentBytes,
  );
  assert.deepEqual(app.store.documents.bytes(document.id), documentBytes);
  phase("native-readonly-permissions");
  const grant = await page.request.post(origin + "/api/auth/pairing-token", {
    headers: { Origin: origin },
    data: {
      label: "SYNTHETIC read-only",
      scopes: ["orchestration:read", "filesystem:read"],
    },
  });
  assert.equal(grant.status(), 200);
  const readOnly = await browser.newContext();
  const session = await readOnly.request.post(
    origin + "/api/auth/browser-session",
    {
      headers: { Origin: origin },
      data: { credential: (await grant.json()).credential },
    },
  );
  assert.equal(session.status(), 200, "Original T3 read-only pairing failed");
  const readOnlyGrant = await (
    await readOnly.request.get(origin + "/api/auth/session")
  ).json();
  assert.ok(readOnlyGrant.permissions.includes("filesystem:read"));
  assert.equal(readOnlyGrant.permissions.includes("filesystem:write"), false);
  assert.equal(
    (
      await readOnly.request.get(origin + "/bewerbung/api/applications")
    ).status(),
    200,
  );
  assert.equal(
    (
      await readOnly.request.patch(
        origin + "/bewerbung/api/applications/" + a.id,
        {
          headers: { Origin: origin, "X-Bewerbung-Request": "1" },
          data: {
            revision: app.store.app(a.id).revision,
            notes: "MUST NOT BE WRITTEN",
          },
        },
      )
    ).status(),
    403,
  );
  assert.notEqual(app.store.app(a.id).notes, "MUST NOT BE WRITTEN");
  assert.equal(
    (
      await readOnly.request.post(
        origin + "/bewerbung/api/applications/" + a.id + "/t3-project",
        { headers: { Origin: origin, "X-Bewerbung-Request": "1" }, data: {} },
      )
    ).status(),
    200,
  );
  await readOnly.close();
  phase("business-page");
  await page.goto(origin + "/bewerbungen", { waitUntil: "networkidle" });
  const body = await page.locator("body").innerText();
  assert.ok(
    body.includes("SYNTHETIC Native A") && body.includes("SYNTHETIC Native B"),
    "Business list not rendered: " + body.slice(0, 3000),
  );
  await page
    .getByRole("button", { name: /SYNTHETIC Native A/ })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Archiv laden / aktualisieren", exact: true })
    .click();
  await page
    .getByText("SYNTHETIC LEGACY UNSENT DRAFT", { exact: true })
    .waitFor();
  assert.equal(
    app.store.preferences.draft(a.id).text,
    "SYNTHETIC LEGACY UNSENT DRAFT",
  );
  phase("source-editor-concurrent-native-change");
  await page
    .getByRole("button", {
      name: "Lebenslauf / Quellen bearbeiten",
      exact: true,
    })
    .click();
  const source = path.join(app.store.workspace(a.id), "cv/profiles/native.lua");
  fs.writeFileSync(source, "return 'SYNTHETIC NATIVE CHANGE AFTER OPEN'");
  await page
    .getByRole("combobox", { name: "Quelldatei auswählen", exact: true })
    .click();
  await page
    .getByRole("option", { name: "cv/profiles/native.lua", exact: true })
    .click();
  const editor = page.getByRole("textbox", { name: "Quelldatei", exact: true });
  await editor.waitFor();
  assert.equal(
    await editor.inputValue(),
    "return 'SYNTHETIC NATIVE CHANGE AFTER OPEN'",
  );
  await editor.fill("return 'SYNTHETIC UI EDIT ON FRESH NATIVE REVISION'");
  await page.getByRole("button", { name: /^Speichern/ }).click();
  await page.getByText("Quelle gespeichert.", { exact: true }).waitFor();
  assert.equal(
    fs.readFileSync(source, "utf8"),
    "return 'SYNTHETIC UI EDIT ON FRESH NATIVE REVISION'",
  );
  await page.getByRole("button", { name: "Close", exact: true }).last().click();
  const staleRevision = app.store.app(a.id).revision;
  fs.writeFileSync(source, "return 'SYNTHETIC SECOND NATIVE CHANGE'");
  const staleWrite = await page.request.put(
    origin + "/bewerbung/api/applications/" + a.id + "/file",
    {
      headers: { Origin: origin, "X-Bewerbung-Request": "1" },
      data: {
        path: "cv/profiles/native.lua",
        content: "STALE OVERWRITE",
        revision: staleRevision,
      },
    },
  );
  assert.equal(staleWrite.status(), 409);
  assert.equal(
    fs.readFileSync(source, "utf8"),
    "return 'SYNTHETIC SECOND NATIVE CHANGE'",
  );
  phase("business-documents");
  await page
    .getByRole("button", { name: "Unterlagen / PDF", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Unterlagen", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Unterlagen schließen", exact: true })
    .click();
  phase("native-draft-handoff");
  await page.getByRole("button", { name: "Chat öffnen", exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/bewerbungen"), {
    timeout: 30000,
  });
  await page.waitForLoadState("networkidle");
  const nativeBody = await page.locator("body").innerText();
  assert.ok(!nativeBody.includes("Dokumentänderungen nur mit Einzelfreigabe"));
  phase("business-create-and-mobile");
  await page.goto(origin + "/bewerbungen", { waitUntil: "networkidle" });
  await page
    .getByRole("button", { name: "Neue Bewerbung", exact: true })
    .last()
    .click();
  await page
    .getByRole("textbox", { name: "Unternehmen", exact: true })
    .fill("SYNTHETIC Created Through Native UI");
  await page
    .getByRole("textbox", { name: "Rolle", exact: true })
    .fill("Mobile Fixture");
  await page
    .getByRole("button", { name: "Bewerbung anlegen", exact: true })
    .click();
  await page
    .getByRole("heading", {
      name: "SYNTHETIC Created Through Native UI",
      exact: true,
    })
    .waitFor();
  assert.equal(
    app.store
      .list()
      .filter(
        (entry) => entry.company === "SYNTHETIC Created Through Native UI",
      ).length,
    1,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Bewerbungen", exact: true }).click();
  await page
    .getByRole("button", { name: /SYNTHETIC Native B/ })
    .first()
    .click();
  await page
    .getByRole("heading", { name: "SYNTHETIC Native B", exact: true })
    .waitFor();
  assert.ok(
    await page.evaluate(
      () => globalThis.document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    "Mobile layout overflows",
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS integrated stock T3: native browser pairing/cookies/HTTP/WS, scoped authenticated application projects, independent native workspaces, business page and native draft handoff; no model turns",
  );
  state.status = "PASS";
} catch (error) {
  state.status = "FAILED";
  state.error = String(error).replace(
    /https?:\/\/\S*token\S*/gi,
    "[PAIRING URL REDACTED]",
  );
  console.error(state.error);
  state.nativeLogTail = logs
    .split("\n")
    .filter((line) =>
      /\b(?:INFO|WARN|ERROR)\b|server is ready|pairing\s*url:/i.test(line),
    )
    .slice(-15)
    .map((line) => line.replace(/https?:\/\/\S+/g, "[URL REDACTED]"));
  console.log("SYNTHETIC native log tail", JSON.stringify(state.nativeLogTail));
  process.exitCode = 1;
} finally {
  phase("cleanup");
  await browser?.close();
  gateway?.closeAllConnections();
  legacy?.closeAllConnections();
  gateway?.close();
  legacy?.close();
  await native.close();
  await app?.close();
  fs.rmSync(root, { recursive: true, force: true });
  phase("closed");
}
