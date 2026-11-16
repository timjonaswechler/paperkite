// Target an already-created synthetic application. Real provider calls may incur cost.
import { chromium, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import type { Application, ApplicationDetail } from "../shared/api.ts";
const origin = process.env.SMOKE_ORIGIN,
  artifacts = process.env.SMOKE_ARTIFACTS,
  provider = process.env.SMOKE_HARNESS;
if (
  !origin ||
  !artifacts ||
  process.env.SMOKE_SYNTHETIC !== "1" ||
  !["pi", "codex"].includes(provider || "")
)
  throw new Error("Synthetic real-provider opt-in required");
const url = new URL(origin);
if (!["127.0.0.1", "localhost"].includes(url.hostname))
  throw new Error("Never target production");
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH,
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
async function api<T>(route: string): Promise<T> {
  const r = await page.request.get(`${url.origin}/bewerbung/api${route}`);
  expect(r.ok()).toBe(true);
  return r.json() as Promise<T>;
}
try {
  const app = (await api<Application[]>("/applications")).find(
    (a) => a.company === process.env.SMOKE_COMPANY,
  );
  expect(app, "Explicit synthetic application exists").toBeTruthy();
  const id = app!.id,
    stamp = Date.now();
  expect(
    (await api<ApplicationDetail>(`/applications/${id}`)).harness.provider,
  ).toBe(provider);
  await page.goto(`${url.origin}/bewerbung/applications/${id}`);
  const input = page.getByRole("textbox", { name: "Nachricht an Assistent" });
  for (const allow of [false, true]) {
    const filename = `cv/profiles/entwurf_${allow ? "leer" : "alternativ"}_${stamp}.lua`;
    await expect(input).toBeEditable();
    await input.fill(
      `Für diese Bewerbung benötige ich ein zusätzliches leeres Lebenslaufprofil als Ausgangspunkt für meine eigenen Einträge. Lege dafür ${filename} mit exakt return {} an. Nutze jetzt das Werkzeug ${provider === "pi" ? "write" : "bewerbung_write"}; die technische Einzelfreigabe übernimmt dessen Dialog. Stelle keine vorgelagerte Chat-Rückfrage und ändere keine anderen Dateien. Falls der Werkzeugaufruf abgelehnt wird, stoppe und versuche es nicht erneut.`,
    );
    await page
      .getByRole("button", { name: "Nachricht senden", exact: true })
      .click();
    await expect(
      page.getByRole("region", { name: "Einzelfreigabe" }),
    ).toBeVisible({ timeout: 90000 });
    expect(
      (await api<ApplicationDetail>(`/applications/${id}`)).files.some(
        (f) => f.name === filename,
      ),
    ).toBe(false);
    await page.screenshot({
      path: path.join(artifacts, `approval-${allow ? "allow" : "deny"}.png`),
      animations: "disabled",
    });
    await page
      .getByRole("button", {
        name: allow ? "Einmal erlauben" : "Ablehnen",
        exact: true,
      })
      .click();
    await expect
      .poll(
        async () =>
          (await api<ApplicationDetail>(`/applications/${id}`)).harness.busy,
        { timeout: 90000 },
      )
      .toBe(false);
    expect(
      (await api<ApplicationDetail>(`/applications/${id}`)).files.some(
        (f) => f.name === filename,
      ),
    ).toBe(allow);
    if (allow) {
      const r = await page.request.get(
        `${url.origin}/bewerbung/api/applications/${id}/file?path=${encodeURIComponent(filename)}`,
      );
      expect((await r.text()).trim()).toBe("return {}");
    }
  }
  fs.writeFileSync(
    path.join(artifacts, "resume.json"),
    JSON.stringify({
      id,
      provider,
      expected: `cv/profiles/entwurf_leer_${stamp}.lua`,
    }),
  );
  await input.fill(
    "Erkläre ausführlich, wie ich ein Anschreiben gliedern kann. Nutze keine Werkzeuge.",
  );
  await page
    .getByRole("button", { name: "Nachricht senden", exact: true })
    .click();
  await page.getByRole("button", { name: "Stoppen", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await api<ApplicationDetail>(`/applications/${id}`)).harness.busy,
      { timeout: 30000 },
    )
    .toBe(false);
  expect((await api<{ text: string }>(`/applications/${id}/draft`)).text).toBe(
    "",
  );
  console.log(
    `PASS ${provider} visible approval before write, denial leaves no file, one-shot approval writes exact bytes, interruption and draft clear`,
  );
} catch (error) {
  console.error(await page.locator("body").innerText());
  throw error;
} finally {
  await browser.close();
}
