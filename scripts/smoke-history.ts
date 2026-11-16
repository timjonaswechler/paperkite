import { chromium, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { createApp } from "../server/app.ts";

const root = fs.mkdtempSync(
  path.join(os.tmpdir(), "bewerbung-history-browser-"),
);
const app = createApp(root, async () => "", 3125);
const application = app.store.create({
  company: "Synthetic long history",
  role: "Synthetic role",
});
const marker = "Finale Antwort nach der Seitengrenze";
app.store.db.exec("BEGIN");
app.store.event(application.id, "user", { text: "Anfang" });
for (let n = 0; n < 9999; n++)
  app.store.event(application.id, "delta", { text: "x" });
app.store.event(application.id, "assistant", { text: marker });
app.store.db.exec("COMMIT");
const server = app.web.listen(3125, "127.0.0.1");
await once(server, "listening");
const browser = await chromium.launch({
  headless: true,
  executablePath:
    "/home/redjoker/.cache/ms-playwright/chromium_headless_shell-1254/chrome-headless-shell-linux64/chrome-headless-shell",
});
const page = await browser.newPage();
const errors: string[] = [];
page.on("pageerror", (error) => errors.push(error.message));
try {
  await page.goto(
    `http://127.0.0.1:3125/bewerbung/applications/${application.id}`,
  );
  await expect(page.getByText(marker, { exact: true })).toHaveCount(1);
  await expect(page.getByText(marker, { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText(marker, { exact: true })).toHaveCount(1);
  await expect(page.getByText(marker, { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
  console.log(
    "PASS browser: final assistant message beyond 10,000 events survives navigation and reload exactly once",
  );
} finally {
  await browser.close();
  server.close();
  await app.close();
  fs.rmSync(root, { recursive: true, force: true });
}
