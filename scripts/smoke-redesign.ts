// Run only against a parent-started, disposable synthetic backend; this script starts no server.
// Contracts: modal cancellation creates nothing; open-state is not a status; copies/drafts stay
// independent; library bytes are reused by reference; scoped edits and PDF snapshots remain real.
import { chromium, expect } from "@playwright/test";
import { unzipSync } from "fflate";
import fs from "node:fs";
import path from "node:path";
import type {
  Application,
  ApplicationDetail,
  Settings,
} from "../shared/api.ts";

const origin = process.env.SMOKE_ORIGIN;
if (!origin || process.env.SMOKE_SYNTHETIC !== "1")
  throw new Error(
    "Set SMOKE_ORIGIN to the parent-started disposable instance and SMOKE_SYNTHETIC=1. Never target production.",
  );
const url = new URL(origin);
if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
  throw new Error("Synthetic browser smoke requires a loopback origin.");
const artifacts = path.resolve(
  process.env.SMOKE_ARTIFACTS || ".frontend-captures",
);
fs.mkdirSync(artifacts, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH }
    : {}),
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  acceptDownloads: true,
});
const errors: string[] = [];
page.on("pageerror", (error) => errors.push(error.message));
const stamp = Date.now();
const company = `Synthetic Redesign ${stamp}`;
const copyCompany = `${company} Copy`;
const documentName = `Synthetic Certificate ${stamp}.png`;
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD1cAAAAASUVORK5CYII=",
  "base64",
);
async function api<T = unknown>(
  route: string,
  method = "GET",
  data?: unknown,
): Promise<T> {
  const response = await page.request.fetch(
    `${url.origin}/bewerbung/api${route}`,
    {
      method,
      headers: {
        Origin: url.origin,
        "X-Bewerbung-Request": "1",
        "Content-Type": "application/json",
      },
      ...(data === undefined ? {} : { data }),
    },
  );
  const result = await response.json();
  expect(response.ok(), JSON.stringify(result)).toBe(true);
  return result as T;
}
async function choice(label: string, option: string) {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}
async function sidebarContext(name: string) {
  await page
    .locator("aside")
    .getByRole("button", { name, exact: true })
    .first()
    .click({ button: "right" });
}
async function capture(name: string) {
  await page.screenshot({
    path: path.join(artifacts, `${name}.png`),
    fullPage: true,
    animations: "disabled",
  });
}
async function sourceFile(name: string) {
  await choice("Quelldatei auswählen", name);
  await expect(page.getByLabel("Quelldatei", { exact: true })).toBeVisible();
}
async function settings() {
  await page.keyboard.press("Control+,");
  await expect(
    page.getByRole("dialog", { name: "Einstellungen", exact: true }),
  ).toBeVisible();
}
async function search(query: string) {
  await page.keyboard.press("Control+k");
  await page
    .getByRole("combobox", { name: "Bewerbungen durchsuchen" })
    .fill(query);
}
async function writeSource(id: string, file: string, content: string) {
  const app = await api<ApplicationDetail>(`/applications/${id}`);
  await api(`/applications/${id}/file`, "PUT", {
    path: file,
    content,
    revision: app.revision,
  });
}
try {
  const initialSettings = await api<Settings>("/settings");
  await api("/settings", "PUT", {
    revision: initialSettings.revision,
    theme: "light",
    sendOnEnter: true,
    autoBuild: false,
    defaultProvider: process.env.SMOKE_HARNESS === "codex" ? "codex" : "pi",
  });
  await page.goto(`${url.origin}/bewerbung/`);
  await expect(page.locator("aside [data-app-sidebar]")).toBeVisible();
  if (!(await api<unknown[]>("/templates")).length) {
    const bareCompany = `${company} ohne Master`;
    await page.keyboard.press("Control+n");
    await page.getByLabel("Unternehmen", { exact: true }).fill(bareCompany);
    await page
      .getByLabel("Rolle", { exact: true })
      .fill("Entwurf ohne Vorlage");
    await page
      .getByRole("button", { name: "Bewerbung anlegen", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: bareCompany, exact: true }),
    ).toBeVisible();
    const bareId = page.url().split("/").at(-1)!;
    expect(
      (await api<ApplicationDetail>(`/applications/${bareId}`)).profile,
    ).toBe("default");
    await sidebarContext(`${bareCompany} · Entwurf ohne Vorlage`);
    await page.getByRole("menuitem", { name: "Kopie erstellen…" }).click();
    await page
      .getByLabel("Unternehmen", { exact: true })
      .fill(`${bareCompany} Kopie`);
    await page
      .getByRole("button", { name: "Bewerbung anlegen", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: `${bareCompany} Kopie`, exact: true }),
    ).toBeVisible();
    await page.goto(`${url.origin}/bewerbung/`);
    await expect(page.locator("aside [data-app-sidebar]")).toBeVisible();
  }
  const before = (await api<Application[]>("/applications")).length;
  await page.keyboard.press("Control+n");
  await expect(
    page.getByRole("dialog", { name: "Neue Bewerbung", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Unternehmen", { exact: true }).fill("Never created");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect((await api<Application[]>("/applications")).length).toBe(before);

  await api("/templates/import", "POST", {
    format: "bewerbung-template-v1",
    files: Object.fromEntries(
      Object.entries({
        "cv/Lebenslauf.tex":
          "\\documentclass{article}\n\\begin{document}Synthetic CV only.\\end{document}",
        "cv/lua/loader.lua": "return {}",
        "cv/profiles/data.lua": "return {skills={}}",
        "cv/profiles/general.lua":
          "return {experience={},engagement={},skills={}}",
        "cv/profiles/default.lua":
          "return {experience={},engagement={},skills={}}",
      }).map(([name, text]) => [name, Buffer.from(text).toString("base64")]),
    ),
  });
  await page
    .getByRole("button", { name: "Aktualisieren", exact: true })
    .click();
  await page.keyboard.press("Control+n");
  await page.getByLabel("Unternehmen", { exact: true }).fill(company);
  await page.getByLabel("Rolle", { exact: true }).fill("Frontend Engineer");
  await page
    .getByLabel("Notizen", { exact: true })
    .fill("Distinctive synthetic application note");
  await page
    .getByLabel("Zeugnisse hochladen")
    .setInputFiles({ name: documentName, mimeType: "image/png", buffer: png });
  await expect(
    page.getByRole("checkbox", { name: `${documentName} auswählen` }),
  ).toBeChecked();
  await capture("new-application-light");
  await page
    .getByRole("button", { name: "Bewerbung anlegen", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: company, exact: true }),
  ).toBeVisible();
  const id = page.url().split("/").at(-1)!;
  expect((await api<ApplicationDetail>(`/applications/${id}`)).profile).toBe(
    "general",
  );
  expect((await api<Application[]>("/applications")).length).toBe(before + 1);
  expect(
    (await api<ApplicationDetail>(`/applications/${id}`)).documents,
  ).toHaveLength(1);
  await expect(
    page.getByRole("textbox", { name: "Nachricht an Assistent" }),
  ).toHaveAttribute("contenteditable", "true");
  await expect(page.locator("select")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Modellkatalog laden" }),
  ).toHaveCount(0);

  await sidebarContext(`${company} · Frontend Engineer`);
  await page.getByRole("menuitem", { name: "Status ändern" }).hover();
  await expect(
    page.getByRole("menuitemradio", { name: "Entwurf", exact: true }),
  ).toBeChecked();
  await capture("context-status-menu");
  await page
    .getByRole("menuitemradio", { name: "In Arbeit", exact: true })
    .click();
  await expect(
    page.locator("main").getByText("In Arbeit", { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("list", { name: "Geöffnete Bewerbungen" })
      .getByRole("button", {
        name: `${company} · Frontend Engineer`,
        exact: true,
      }),
  ).toBeVisible();
  expect((await api<ApplicationDetail>(`/applications/${id}`)).status).toBe(
    "In Arbeit",
  );
  await sidebarContext(`${company} · Frontend Engineer`);
  await page
    .getByRole("menuitem", { name: "Aus geöffneten Bewerbungen schließen" })
    .click();
  await expect(
    page
      .getByRole("list", { name: "Geöffnete Bewerbungen" })
      .getByRole("button", {
        name: `${company} · Frontend Engineer`,
        exact: true,
      }),
  ).toHaveCount(0);
  expect((await api<ApplicationDetail>(`/applications/${id}`)).status).toBe(
    "In Arbeit",
  );
  await page.goto(`${url.origin}/bewerbung/applications/${id}`);
  await expect(
    page.getByRole("heading", { name: company, exact: true }),
  ).toBeVisible();
  await expect
    .poll(async () => (await api<{ openIds: string[] }>("/ui-state")).openIds)
    .toContain(id);
  await api(`/applications/${id}/close`, "POST", {});
  await page.goto(`${url.origin}/bewerbung/`);
  await expect(page.locator("aside [data-app-sidebar]")).toBeVisible();
  await search("Distinctive synthetic application note");
  await expect(
    page.getByRole("option", { name: new RegExp(company) }),
  ).toBeVisible();
  await capture("search");
  await page
    .getByRole("combobox", { name: "Bewerbungen durchsuchen" })
    .press("Enter");
  await expect(
    page.getByRole("heading", { name: company, exact: true }),
  ).toBeVisible();

  const draftSaved = page.waitForResponse(
    (r) =>
      r.url().endsWith(`/applications/${id}/draft`) &&
      r.request().method() === "PUT",
  );
  await page
    .getByRole("textbox", { name: "Nachricht an Assistent" })
    .fill("Unsent draft belongs only to original");
  expect((await draftSaved).ok()).toBe(true);
  await sidebarContext(`${company} · Frontend Engineer`);
  await page.getByRole("menuitem", { name: "Kopie erstellen…" }).click();
  await expect(page.getByLabel("Unternehmen", { exact: true })).toHaveValue(
    company,
  );
  await page.getByLabel("Unternehmen", { exact: true }).fill(copyCompany);
  await page
    .getByRole("button", { name: "Bewerbung anlegen", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: copyCompany, exact: true }),
  ).toBeVisible();
  const copyId = page.url().split("/").at(-1)!;
  expect(copyId).not.toBe(id);
  expect((await api<ApplicationDetail>(`/applications/${copyId}`)).status).toBe(
    "Entwurf",
  );
  await expect(
    page.getByRole("textbox", { name: "Nachricht an Assistent" }),
  ).toHaveText("");
  const originalDoc = (await api<ApplicationDetail>(`/applications/${id}`))
    .documents[0]!;
  expect(
    (await api<ApplicationDetail>(`/applications/${copyId}`)).documents[0]?.id,
  ).toBe(originalDoc.id);
  await page.goto(`${url.origin}/bewerbung/applications/${id}`);
  await expect(
    page.getByRole("textbox", { name: "Nachricht an Assistent" }),
  ).toHaveText("Unsent draft belongs only to original");
  await page
    .getByRole("textbox", { name: "Nachricht an Assistent" })
    .fill("Last edit survives immediate navigation");
  await page
    .getByRole("list", { name: "Geöffnete Bewerbungen" })
    .getByRole("button", {
      name: `${copyCompany} · Frontend Engineer`,
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Nachricht an Assistent" }),
  ).toHaveText("");
  await page
    .getByRole("list", { name: "Geöffnete Bewerbungen" })
    .getByRole("button", {
      name: `${company} · Frontend Engineer`,
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Nachricht an Assistent" }),
  ).toHaveText("Last edit survives immediate navigation");

  await settings();
  const enterSwitch = page.getByRole("switch", { name: "Mit Enter senden" });
  if (await enterSwitch.isChecked()) await enterSwitch.click();
  await expect(enterSwitch).not.toBeChecked();
  await page.getByRole("button", { name: "Darstellung", exact: true }).click();
  await choice("Farbschema", "Dunkel");
  await expect(page.locator("html")).toHaveClass(/dark/);
  await capture("settings-dark");
  await page
    .getByRole("button", { name: "Eigene Dateien", exact: true })
    .click();
  await page
    .getByRole("button", { name: `${documentName} umbenennen`, exact: true })
    .click();
  await page
    .getByLabel("Dateibezeichnung", { exact: true })
    .fill(`${documentName} renamed`);
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(
    page.getByText(`${documentName} renamed`, { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: `${documentName} renamed entfernen`,
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Datei entfernen", exact: true })
    .click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.getByRole("button", { name: "Zurück zum Chat" }).click();
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);
  expect((await api<Settings>("/settings")).sendOnEnter).toBe(false);
  await page
    .getByRole("textbox", { name: "Nachricht an Assistent" })
    .press("End");
  await page
    .getByRole("textbox", { name: "Nachricht an Assistent" })
    .press("Enter");
  expect(
    (await api<ApplicationDetail>(`/applications/${id}`)).harness.busy,
  ).toBe(false);
  await capture("chat-dark");

  await page
    .getByRole("button", {
      name: "Lebenslauf / Quellen bearbeiten",
      exact: true,
    })
    .click();
  await sourceFile("anschreiben/Anschreiben.tex");
  const originalSource = await page
    .getByLabel("Quelldatei", { exact: true })
    .inputValue();
  await page.keyboard.press("Escape");
  const sourceProfile =
    "return {experience={{date='2020',title='Source One',org='Alpha',bullets={'A'}},{date='2024',title='Source Two',org='Beta',bullets={'B'}}},skills={{label='Language',items={'German'}}}}";
  await writeSource(id, "cv/profiles/default.lua", sourceProfile);
  await writeSource(
    copyId,
    "cv/profiles/default.lua",
    "return {experience={{date='1990',title='Existing',org='Local',bullets={'Keep'}}},skills={}}",
  );
  await page.goto(`${url.origin}/bewerbung/applications/${copyId}`);
  await page
    .getByRole("button", {
      name: "Lebenslauf / Quellen bearbeiten",
      exact: true,
    })
    .click();
  await sourceFile("anschreiben/Anschreiben.tex");
  await page
    .getByLabel("Quelldatei", { exact: true })
    .fill(`${originalSource}\n% Independent synthetic copy edit`);
  await page.getByRole("button", { name: /^Speichern/ }).click();
  await expect(page.getByRole("status")).toContainText("Quelle gespeichert");
  expect(
    await (
      await page.request.get(
        `${url.origin}/bewerbung/api/applications/${id}/file?path=anschreiben%2FAnschreiben.tex`,
      )
    ).text(),
  ).toBe(originalSource);
  await page
    .getByText("Einzelne Lebenslauf-Einträge wiederverwenden", { exact: true })
    .click();
  await choice("Quellbewerbung für Einträge", company);
  await choice("Quellprofil", "cv/profiles/default.lua");
  await choice("Zielprofil", "cv/profiles/default.lua");
  await page.getByRole("checkbox", { name: /Source Two/ }).check();
  await page.getByRole("checkbox", { name: /Source One/ }).check();
  await page
    .getByRole("button", { name: "Einträge als Kopien übernehmen" })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "CV-Einträge unabhängig kopiert",
  );
  const profile = await api<{ entries: { experience: { title: string }[] } }>(
    `/applications/${copyId}/profile?path=cv%2Fprofiles%2Fdefault.lua`,
  );
  expect(profile.entries.experience.map((entry) => entry.title)).toEqual([
    "Existing",
    "Source One",
    "Source Two",
  ]);
  await page.getByRole("checkbox", { name: /Language/ }).check();
  await choice("Übernahmeart", "Nur ausgewählte Bereiche ersetzen");
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Einträge als Kopien übernehmen" })
    .click();
  await expect(
    page.getByRole("checkbox", { name: /Language/ }),
  ).not.toBeChecked();
  const replaced = await api<{
    entries: { skills: { label: string }[]; experience: { title: string }[] };
  }>(`/applications/${copyId}/profile?path=cv%2Fprofiles%2Fdefault.lua`);
  expect(replaced.entries.skills.map((entry) => entry.label)).toEqual([
    "Language",
  ]);
  expect(replaced.entries.experience.map((entry) => entry.title)).toEqual([
    "Existing",
    "Source One",
    "Source Two",
  ]);
  expect(
    await (
      await page.request.get(
        `${url.origin}/bewerbung/api/applications/${id}/file?path=cv%2Fprofiles%2Fdefault.lua`,
      )
    ).text(),
  ).toBe(sourceProfile);
  await capture("advanced-source-editor");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Unterlagen", exact: true }).click();
  await expect(
    page.getByText(`${documentName} renamed`, { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Anschreiben bauen", exact: true })
    .click();
  await expect(page.getByText("Erfolgreich", { exact: true })).toBeVisible({
    timeout: 120000,
  });
  await expect(
    page.locator('object[aria-label="PDF-Vorschau"]'),
  ).toHaveAttribute("data", /\/builds\/.+\/pdf$/);
  await page.getByRole("button", { name: "Festhalten", exact: true }).click();
  await expect(page.getByText(/Erfolgreich · festgehalten/)).toBeVisible();
  const pdfDownload = page.waitForEvent("download");
  await page.getByRole("link", { name: "PDF", exact: true }).click();
  const pdfResult = await pdfDownload;
  expect(await pdfResult.failure()).toBeNull();
  const pdfBytes = fs.readFileSync((await pdfResult.path())!);
  expect(pdfBytes.subarray(0, 5).toString()).toBe("%PDF-");
  const currentName = `Synthetic Current Attachment ${stamp}.pdf`;
  await page
    .getByRole("button", { name: "Auswahl ändern", exact: true })
    .click();
  await page.getByLabel("Zeugnisse hochladen").setInputFiles({
    name: currentName,
    mimeType: "application/pdf",
    buffer: pdfBytes,
  });
  await expect(
    page.getByRole("checkbox", { name: `${currentName} auswählen` }),
  ).toBeChecked();
  await page
    .getByRole("checkbox", { name: `${documentName} renamed auswählen` })
    .uncheck();
  await page
    .getByRole("button", { name: "Änderungen speichern", exact: true })
    .click();
  await expect(page.getByText(currentName, { exact: true })).toBeVisible();
  for (const label of ["Buildquellen (ZIP)", "Dokumentpaket"]) {
    const download = page.waitForEvent("download");
    await page.getByRole("link", { name: label, exact: true }).click();
    const result = await download;
    expect(await result.failure()).toBeNull();
    const archive = unzipSync(fs.readFileSync((await result.path())!));
    if (label === "Dokumentpaket") {
      expect(Object.keys(archive).sort()).toEqual([
        `Anlagen/01_${currentName}`,
        "Anschreiben.pdf",
      ]);
      expect(Buffer.from(archive[`Anlagen/01_${currentName}`]!)).toEqual(
        pdfBytes,
      );
    } else {
      expect(archive["application.json"]).toBeDefined();
      expect(Buffer.from(archive[`Anlagen/01_${documentName}`]!)).toEqual(png);
      expect(archive[`Anlagen/01_${currentName}`]).toBeUndefined();
    }
  }
  await capture("documents-panel-dark");
  await page.getByRole("button", { name: "Unterlagen schließen" }).click();

  // Explicit opt-in only: a real harness turn may incur cost. No provider API is queried otherwise.
  const provider = process.env.SMOKE_HARNESS;
  if (provider === "pi" || provider === "codex") {
    await page
      .getByRole("button", { name: "Modell und Anbieter wählen" })
      .click();
    await page
      .getByRole("button", {
        name: provider === "codex" ? "Codex" : "Pi",
        exact: true,
      })
      .click();
    const modelName = process.env.SMOKE_MODEL?.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&",
    );
    const option = page
      .locator("[data-model-picker-content]")
      .getByRole("option", modelName ? { name: new RegExp(modelName) } : {})
      .first();
    await expect(option).toBeVisible({ timeout: 45000 });
    await capture("model-picker");
    await option.click();
    for (const allow of [false, true]) {
      const filename = `cv/profiles/browser_${allow ? "allowed" : "denied"}_${stamp}.lua`;
      await page
        .getByRole("textbox", { name: "Nachricht an Assistent" })
        .fill(
          `Für diese Bewerbung benötige ich ein zusätzliches leeres Lebenslaufprofil als Ausgangspunkt für eigene Einträge. Lege ${filename} mit exakt return {} an. Nutze jetzt ${provider === "pi" ? "write" : "bewerbung_write"}; die technische Einzelfreigabe übernimmt dessen Dialog. Stelle keine vorgelagerte Chat-Rückfrage und ändere keine anderen Dateien. Falls abgelehnt, stoppe ohne erneuten Versuch.`,
        );
      await page
        .getByRole("button", { name: "Nachricht senden", exact: true })
        .click();
      await expect(
        page.getByRole("region", { name: "Einzelfreigabe" }),
      ).toBeVisible({ timeout: 90000 });
      expect(
        (await api<ApplicationDetail>(`/applications/${copyId}`)).files.some(
          (file) => file.name === filename,
        ),
      ).toBe(false);
      await page
        .getByRole("button", {
          name: allow ? "Einmal erlauben" : "Ablehnen",
          exact: true,
        })
        .click();
      await expect(
        page.getByRole("button", { name: "Nachricht senden", exact: true }),
      ).toBeVisible({ timeout: 90000 });
      expect(
        (await api<ApplicationDetail>(`/applications/${copyId}`)).files.some(
          (file) => file.name === filename,
        ),
      ).toBe(allow);
      if (allow) {
        const bytes = await page.request.get(
          `${url.origin}/bewerbung/api/applications/${copyId}/file?path=${encodeURIComponent(filename)}`,
        );
        expect(bytes.ok()).toBe(true);
        expect((await bytes.text()).trim()).toBe("return {}");
      }
    }
    fs.writeFileSync(
      path.join(artifacts, "resume.json"),
      JSON.stringify({
        id: copyId,
        provider,
        expected: `cv/profiles/browser_allowed_${stamp}.lua`,
      }),
    );
    await page
      .getByRole("textbox", { name: "Nachricht an Assistent" })
      .fill(
        "Explain how to structure a detailed application. Do not read or modify any files.",
      );
    await page
      .getByRole("button", { name: "Nachricht senden", exact: true })
      .click();
    await page.getByRole("button", { name: "Stoppen", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Nachricht senden", exact: true }),
    ).toBeVisible({ timeout: 30000 });
    expect(
      (await api<{ text: string }>(`/applications/${copyId}/draft`)).text,
    ).toBe("");
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Bewerbungen einblenden" }).click();
  await capture("sidebar-mobile");
  await page.getByRole("button", { name: "Seitenleiste schließen" }).click();
  await capture("chat-mobile");
  expect(errors).toEqual([]);
  console.log(
    `PASS redesign browser flows; original=${id}, copy=${copyId}; captures=${artifacts}; real harness=${provider || "not run"}`,
  );
} catch (error) {
  console.error("Browser errors:", errors);
  await capture("failure");
  console.error(await page.locator("body").innerText());
  throw error;
} finally {
  await browser.close();
}
