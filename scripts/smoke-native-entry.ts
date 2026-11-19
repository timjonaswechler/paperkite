// Canonical packaged entry, isolated provider homes and owned-child failure; no model turn.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { once } from "node:events";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { Store } from "../server/store.ts";
if (process.env.SMOKE_SYNTHETIC !== "1")
  throw new Error("Synthetic opt-in required");
const project = process.cwd(),
  root = fs.mkdtempSync(path.join(os.tmpdir(), "bewerbung-entry-")),
  data = path.join(root, "data"),
  user = path.join(root, "user");
fs.mkdirSync(user, { mode: 0o700 });
const seed = new Store(data);
const fixture = seed.create({
  company: "SYNTHETIC CANONICAL ENTRY",
  role: "Fixture",
});
seed.close();
const tls = process.env.SMOKE_TLS === "1",
  origin = tls ? "https://bewerbung.teejayslab.de" : "http://127.0.0.1:3160";
const env = {
  ...process.env,
  HOME: user,
  DATA_DIR: data,
  PUBLIC_PORT: tls ? "3120" : "3160",
  T3_NATIVE_PORT: tls ? "3121" : "3161",
  LEGACY_PORT: "3162",
  PUBLIC_ORIGIN: origin,
};
let child: ReturnType<typeof spawn> | undefined,
  browser: Awaited<ReturnType<typeof chromium.launch>> | undefined,
  nativePid: number | undefined,
  logs = "";
const report: Record<string, unknown> = { modelTurns: 0 };
try {
  child = spawn(process.execPath, ["--import", "tsx", "server/main.ts"], {
    cwd: project,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exited = once(child, "exit");
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Canonical startup deadline")),
      65000,
    );
    for (const stream of [child!.stdout!, child!.stderr!])
      stream.on("data", (chunk) => {
        logs = (logs + chunk).slice(-100000);
        if (logs.includes("Bewerbungsverwaltung und originaler T3-Chat")) {
          clearTimeout(timeout);
          resolve();
        }
      });
    child!.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error("Canonical process exited " + code));
    });
  });
  const home = path.join(data, "native-t3"),
    settings = JSON.parse(
      fs.readFileSync(path.join(home, "userdata/settings.json"), "utf8"),
    );
  assert.equal(
    settings.providerInstances.pi.environment[0].value,
    path.join(home, "providers/pi/sessions"),
  );
  assert.equal(
    settings.providerInstances.codex.config.homePath,
    path.join(home, "providers/codex"),
  );
  assert.equal(settings.providerInstances.pi.config.launchArgs || "", "");
  const health = await fetch(origin + "/bewerbung/api/health");
  assert.equal((await health.json()).nativeChat, true);
  const descriptor = await (
    await fetch(origin + "/.well-known/t3/environment")
  ).json();
  assert.equal(
    descriptor.capabilities.serverSelfUpdate,
    undefined,
    "Stock manually managed runtime must not overwrite business bundle",
  );
  const session = await (await fetch(origin + "/api/auth/session")).json();
  assert.equal(session.authenticated, true);
  const nativeSession = await (
    await fetch("http://127.0.0.1:" + env.T3_NATIVE_PORT + "/api/auth/session")
  ).json();
  assert.equal(
    nativeSession.authenticated,
    false,
    "Native server itself must still require authentication",
  );
  browser = await chromium.launch({
    headless: true,
    executablePath:
      "/home/redjoker/.cache/ms-playwright/chromium_headless_shell-1254/chrome-headless-shell-linux64/chrome-headless-shell",
  });
  const page = await browser.newPage();
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const nativeStream = page
    .waitForEvent("websocket", {
      predicate: (socket) => new URL(socket.url()).pathname === "/ws",
      timeout: 15000,
    })
    .then((socket) => socket.waitForEvent("framereceived", { timeout: 15000 }));
  void nativeStream.catch(() => undefined);
  assert.equal((await page.context().cookies()).length, 0);
  await page.goto(origin + "/");
  await page.waitForURL(origin + "/bewerbungen");
  await page
    .getByRole("button", { name: /SYNTHETIC CANONICAL ENTRY/ })
    .first()
    .waitFor();
  await nativeStream;
  report.originalFrontendAndBusiness = true;
  report.freshBrowserWithoutPairing = true;
  report.originalWebSocketWithoutPairing = true;
  const stale = await browser.newContext();
  await stale.addCookies([
    {
      name: session.auth.sessionCookieName,
      value: "expired-browser-session",
      url: origin,
    },
  ]);
  const stalePage = await stale.newPage();
  await stalePage.goto(origin + "/pair");
  await stalePage.waitForURL(origin + "/bewerbungen");
  await stalePage
    .getByRole("button", { name: /SYNTHETIC CANONICAL ENTRY/ })
    .first()
    .waitFor();
  await stale.close();
  report.staleCookieWithoutPairing = true;
  assert.equal(
    (await page.context().cookies()).some(
      (cookie) => cookie.name === session.auth.sessionCookieName,
    ),
    false,
    "Gateway credential must never reach browser cookies",
  );
  const mapped = await page.request.post(
    origin + "/bewerbung/api/applications/" + fixture.id + "/t3-project",
    { headers: { Origin: origin, "X-Bewerbung-Request": "1" }, data: {} },
  );
  assert.equal(mapped.status(), 200);
  report.nativeAuthorizedProjectOverPublicOrigin = true;
  assert.deepEqual(pageErrors, []);
  report.tls = tls;
  const children = fs
    .readFileSync(`/proc/${child.pid}/task/${child.pid}/children`, "utf8")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(Number);
  nativePid = children.find((pid) =>
    fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").includes(home),
  );
  assert.ok(nativePid, "Owned original server child missing");
  process.kill(nativePid, "SIGTERM");
  const result = await Promise.race([
    exited,
    new Promise<never>((_, reject) =>
      setTimeout(
        () =>
          reject(new Error("Wrapper did not fail with its original server")),
        12000,
      ),
    ),
  ]);
  assert.equal(result[0], 1);
  report.nativeChildExitFailsWrapper = true;
  await browser.close();
  browser = undefined;
  const empty = path.join(root, "missing-config");
  fs.mkdirSync(path.join(empty, "builder"), { recursive: true });
  fs.writeFileSync(
    path.join(empty, "builder/image-id"),
    "sha256:" + "1".repeat(64),
  );
  const missing = spawn(
    process.execPath,
    [
      "--import",
      path.join(project, "node_modules/tsx/dist/loader.mjs"),
      path.join(project, "server/main.ts"),
    ],
    {
      cwd: empty,
      env: { ...env, PORT: "3164", DATA_DIR: path.join(empty, "data") },
      stdio: "ignore",
    },
  );
  const gone = await Promise.race([
    once(missing, "exit"),
    new Promise<never>((_, reject) =>
      setTimeout(() => {
        missing.kill("SIGKILL");
        reject(new Error("Missing config silently started old chat"));
      }, 5000),
    ),
  ]);
  assert.notEqual(gone[0], 0);
  assert.equal(fs.existsSync(path.join(empty, "data")), false);
  report.noLegacyFallback = true;
  report.status = "PASS";
} catch (error) {
  report.status = "FAILED";
  report.error = String(error).replace(
    /https?:\/\/[^\s"']+/g,
    "[URL REDACTED]",
  );
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
        }, 5000),
      ),
    ]);
  }
  if (nativePid) {
    try {
      if (
        fs
          .readFileSync(`/proc/${nativePid}/cmdline`, "utf8")
          .includes(path.join(data, "native-t3"))
      )
        process.kill(nativePid, "SIGKILL");
    } catch {}
  }
  fs.rmSync(root, { recursive: true, force: true });
  fs.writeFileSync(
    path.resolve(process.env.SMOKE_REPORT || "../native-entry-result.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
}
