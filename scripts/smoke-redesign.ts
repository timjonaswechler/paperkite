// Run only against a parent-started, disposable synthetic backend; this script starts no server.
// Contracts: modal cancellation creates nothing; open-state is not a status; copies/drafts stay
// independent; library bytes are reused by reference; scoped edits and PDF snapshots remain real.
import { chromium, expect } from "@playwright/test";
import { unzipSync } from "fflate";
import fs from "node:fs";
import path from "node:path";
import { crc32, deflateSync } from "node:zlib";
import type {
  Application,
  ApplicationDetail,
  Settings,
  LibraryDocument,
  TemplateSummary,
  PdfPlan,
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
// Valid PNG with a unique harmless text chunk: repeat runs must not collide with library dedupe.
function chunk(type: string, data: Buffer) {
  const header = Buffer.alloc(4),
    checksum = Buffer.alloc(4),
    body = Buffer.concat([Buffer.from(type), data]);
  header.writeUInt32BE(data.length);
  checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([header, body, checksum]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(1, 0);
ihdr.writeUInt32BE(1, 4);
ihdr[8] = 8;
ihdr[9] = 2;
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk("IHDR", ihdr),
  chunk("tEXt", Buffer.from("Fixture\0" + stamp)),
  chunk("IDAT", deflateSync(Buffer.from([0, 255, 255, 255]))),
  chunk("IEND", Buffer.alloc(0)),
]);
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
    autoBuild: false,
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
  await expect(
    page.getByRole("combobox", { name: "Status", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("combobox", { name: "Profil", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Zeugnisse hochladen")).toHaveCount(0);
  await expect(
    page.getByText("Zeugnisse und Anlagen", { exact: true }),
  ).toHaveCount(0);
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
  ).toHaveLength(0);
  await expect(
    page.locator('aside [data-status-groups] section[aria-label="Entwurf"]'),
  ).toHaveCount(0);
  await expect(page.locator(`aside [data-application-id="${id}"]`)).toHaveCount(
    1,
  );
  await expect(
    page
      .locator(`aside [data-application-id="${id}"]`)
      .getByText("Entwurf", { exact: true }),
  ).toHaveCount(0);
  await sidebarContext(`${company} · Frontend Engineer`);
  await expect(
    page.getByRole("menuitem", {
      name: "Aus geöffneten Bewerbungen schließen",
    }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Unterlagen", exact: true }).click();
  await page
    .getByRole("button", { name: "Auswahl ändern", exact: true })
    .click();
  await page
    .getByLabel("Zeugnisse hochladen")
    .setInputFiles({ name: documentName, mimeType: "image/png", buffer: png });
  await expect(
    page.getByRole("checkbox", { name: `${documentName} auswählen` }),
  ).toBeChecked();
  await page
    .getByRole("button", { name: "Änderungen speichern", exact: true })
    .click();
  await expect(page.getByText(documentName, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Unterlagen schließen" }).click();
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
  await expect(page.getByLabel("Zeugnisse hochladen")).toHaveCount(0);
  await expect(
    page.getByRole("combobox", { name: "Status", exact: true }),
  ).toHaveCount(0);
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
  const autoBuildSwitch = page.getByRole("switch", {
    name: "Nach dem Speichern bauen",
  });
  await autoBuildSwitch.click();
  await expect(autoBuildSwitch).toBeChecked();
  await autoBuildSwitch.click();
  await expect(autoBuildSwitch).not.toBeChecked();
  await capture("settings-autobuild");
  await page
    .getByRole("button", { name: "Eigene Dateien", exact: true })
    .click();
  await page
    .getByRole("button", { name: `${documentName} umbenennen`, exact: true })
    .click();
  await page
    .getByLabel("Dateibezeichnung", { exact: true })
    .fill(`${documentName} renamed`);
  await page
    .getByLabel("Tags", { exact: true })
    .fill("  Zeugnis, Ausbildung, ZEUGNIS  ");
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(
    page.getByText(`${documentName} renamed`, { exact: true }),
  ).toBeVisible();
  const tagged = (await api<LibraryDocument[]>("/documents")).find(
    (doc) => doc.id === originalDoc.id,
  )!;
  expect(tagged.tags).toHaveLength(2);
  expect(new Set(tagged.tags)).toEqual(new Set(["zeugnis", "ausbildung"]));
  expect(tagged.sha256).toBe(originalDoc.sha256);
  const originalBytes = await page.request.get(
    `${url.origin}/bewerbung/api/documents/${originalDoc.id}/file`,
  );
  expect(await originalBytes.body()).toEqual(png);
  await choice("Nach Tag filtern", "ausbildung");
  await expect(
    page.getByText(`${documentName} renamed`, { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("searchbox", { name: "Eigene Dateien durchsuchen" })
    .fill("zeugnis");
  await expect(
    page.getByText(`${documentName} renamed`, { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("searchbox", { name: "Eigene Dateien durchsuchen" })
    .fill("missing-synthetic-tag");
  await expect(page.getByText("Keine passenden Dateien.")).toBeVisible();
  await page
    .getByRole("searchbox", { name: "Eigene Dateien durchsuchen" })
    .fill("");
  await choice("Nach Tag filtern", "Alle Tags");
  await page
    .getByRole("checkbox", { name: `${documentName} renamed auswählen` })
    .check();
  await page
    .getByRole("button", { name: /Zusammenfügen \/ optimieren/ })
    .click();
  const globalComposition = page.getByRole("dialog", {
    name: "PDF zusammenfügen / optimieren",
    exact: true,
  });
  await expect(
    globalComposition.getByRole("checkbox", {
      name: `${documentName} renamed einschließen`,
    }),
  ).toBeChecked();
  await expect(globalComposition.locator("[data-pdf-source]")).toHaveCount(1);
  await expect(
    globalComposition.getByText("Bild · eine Seite", { exact: true }),
  ).toBeVisible();
  await expect(
    globalComposition.getByRole("textbox", { name: /^Seiten für/ }),
  ).toHaveCount(0);
  const globalPdfCapability = await api<{ pdfProcessing: boolean }>("/health");
  let globalJobId = "";
  if (globalPdfCapability.pdfProcessing) {
    await globalComposition
      .getByRole("button", { name: "PDF erstellen", exact: true })
      .click();
    await expect(
      globalComposition.getByRole("status").filter({ hasText: "PDF fertig" }),
    ).toBeVisible({ timeout: 120000 });
    globalJobId = (await api<{ id: string }[]>("/pdf-jobs"))[0]!.id;
  }
  await globalComposition
    .getByRole("button", { name: "Schließen", exact: true })
    .click();
  if (globalJobId) {
    await page
      .getByRole("button", { name: "Bisherige PDF-Aufträge", exact: true })
      .click();
    await globalComposition
      .getByText("Bisherige PDF-Aufträge", { exact: true })
      .click();
    await globalComposition
      .getByRole("button", { name: "Ergebnis", exact: true })
      .first()
      .click();
    await expect(
      globalComposition.getByRole("link", {
        name: "PDF herunterladen",
        exact: true,
      }),
    ).toHaveAttribute("href", new RegExp(globalJobId));
    await globalComposition
      .getByRole("button", { name: "Schließen", exact: true })
      .click();
  }
  await page
    .getByRole("button", {
      name: `${documentName} renamed optimieren`,
      exact: true,
    })
    .click();
  await expect(
    globalComposition.getByRole("checkbox", {
      name: `${documentName} renamed einschließen`,
    }),
  ).toBeChecked();
  await globalComposition
    .getByRole("button", { name: "Schließen", exact: true })
    .click();
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
  await page.getByRole("button", { name: "Vorlagen", exact: true }).click();
  const snapshotLabel = `Synthetic master ${stamp}`;
  const sourceBeforeSnapshot = await api<ApplicationDetail>(
    `/applications/${id}`,
  );
  await page
    .getByRole("button", { name: "Aus Bewerbung als Vorlage speichern" })
    .click();
  await choice("Quellbewerbung", `${company} · Frontend Engineer`);
  await page.getByLabel("Vorlagenname", { exact: true }).fill(snapshotLabel);
  await page
    .getByRole("button", { name: "Vorlage speichern", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: snapshotLabel, exact: true }),
  ).toBeVisible();
  const snapshot = (await api<TemplateSummary[]>("/templates")).find(
    (template) => template.label === snapshotLabel,
  )!;
  expect(snapshot).toBeDefined();
  expect((await api<ApplicationDetail>(`/applications/${id}`)).revision).toBe(
    sourceBeforeSnapshot.revision,
  );
  await page
    .getByRole("button", {
      name: `${snapshotLabel} als Standard setzen`,
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", {
      name: `${snapshotLabel} als Standard setzen`,
      exact: true,
    }),
  ).toBeDisabled();
  expect(
    (await api<TemplateSummary[]>("/templates")).find(
      (template) => template.isDefault,
    )?.id,
  ).toBe(snapshot.id);
  const exported = await page.request.get(
    `${url.origin}/bewerbung/api/templates/${snapshot.id}/export`,
  );
  expect(exported.ok()).toBe(true);
  expect((await exported.json()).format).toBe("bewerbung-template-v1");
  await page
    .getByRole("button", { name: `${snapshotLabel} duplizieren`, exact: true })
    .click();
  await page
    .getByLabel("Vorlagenname", { exact: true })
    .fill(`${snapshotLabel} copy`);
  await page
    .getByRole("button", { name: "Vorlage speichern", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: `${snapshotLabel} copy`, exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: `${snapshotLabel} copy umbenennen`,
      exact: true,
    })
    .click();
  await page
    .getByLabel("Vorlagenname", { exact: true })
    .fill(`${snapshotLabel} renamed`);
  await page
    .getByRole("button", { name: "Vorlage speichern", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: `${snapshotLabel} renamed`,
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: `${snapshotLabel} renamed löschen`,
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: "Abbrechen", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: `${snapshotLabel} renamed`,
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: `${snapshotLabel} renamed löschen`,
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Vorlage löschen", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: `${snapshotLabel} renamed`,
      exact: true,
    }),
  ).toHaveCount(0);
  await capture("templates-managed");
  await page.getByRole("button", { name: "Zurück zum Chat" }).click();
  await page.reload();
  expect((await api<Settings>("/settings")).autoBuild).toBe(false);
  await page
    .getByRole("textbox", { name: "Nachricht an Assistent" })
    .press("End");
  await page
    .getByRole("textbox", { name: "Nachricht an Assistent" })
    .press("Shift+Enter");
  expect(
    (await api<ApplicationDetail>(`/applications/${id}`)).harness.busy,
  ).toBe(false);
  await capture("chat-settings");

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
  await page
    .getByRole("button", {
      name: "PDF zusammenfügen / optimieren",
      exact: true,
    })
    .click();
  const composition = page.getByRole("dialog", {
    name: "PDF zusammenfügen / optimieren",
    exact: true,
  });
  await expect(composition).toBeVisible();
  const pdfCapability = await api<{ pdfProcessing: boolean }>("/health");
  if (pdfCapability.pdfProcessing) {
    await expect(
      composition.getByRole("checkbox", { name: "Anschreiben einschließen" }),
    ).toBeChecked();
    await expect(
      composition.getByRole("checkbox", {
        name: `${currentName} einschließen`,
      }),
    ).toBeChecked();
    await composition
      .getByRole("button", { name: `${currentName} nach oben`, exact: true })
      .click();
    await expect(
      composition.locator("[data-pdf-source]").first(),
    ).toContainText(currentName);
    await composition
      .getByRole("textbox", { name: `Seiten für ${currentName}`, exact: true })
      .fill("3-1");
    await expect(
      composition.getByRole("button", { name: "PDF erstellen", exact: true }),
    ).toBeDisabled();
    await composition
      .getByRole("textbox", { name: `Seiten für ${currentName}`, exact: true })
      .fill("1");
    await choice("Kompression", "Kompakt (150 dpi)");
    await expect(
      composition.getByText(/Lesbarkeit beeinträchtigen/),
    ).toBeVisible();
    await choice("Kompression", "Verlustfrei");
    await composition
      .getByRole("button", { name: "PDF erstellen", exact: true })
      .click();
    await expect(
      composition.getByRole("status").filter({ hasText: "PDF fertig" }),
    ).toBeVisible({ timeout: 120000 });
    const plan = await api<PdfPlan>(`/applications/${copyId}/pdf-plan`);
    const copyWithDoc = await api<ApplicationDetail>(`/applications/${copyId}`);
    expect(plan.items).toEqual([
      { kind: "document", id: copyWithDoc.documents[0]!.id, pages: "1" },
      {
        kind: "build",
        id: copyWithDoc.builds.find(
          (build) => build.kind === "cover" && build.status === "success",
        )!.id,
      },
    ]);
    expect(plan.compression).toBe("lossless");
    const resultDownload = page.waitForEvent("download");
    await composition
      .getByRole("link", { name: "PDF herunterladen", exact: true })
      .click();
    const composedFile = await resultDownload;
    expect(await composedFile.failure()).toBeNull();
    expect(
      fs
        .readFileSync((await composedFile.path())!)
        .subarray(0, 5)
        .toString(),
    ).toBe("%PDF-");
    await composition
      .getByRole("button", { name: "In Eigene Dateien speichern", exact: true })
      .click();
    await expect(
      composition.getByRole("status").filter({ hasText: /Eigene Dateien/ }),
    ).toBeVisible();
    expect(
      (await api<LibraryDocument[]>("/documents")).find(
        (doc) => doc.id === originalDoc.id,
      )?.sha256,
    ).toBe(originalDoc.sha256);
    await capture("pdf-composition-result");
    await composition
      .getByRole("checkbox", { name: "Anschreiben einschließen" })
      .uncheck();
    await composition
      .getByRole("button", { name: "PDF erstellen", exact: true })
      .click();
    await expect(
      composition.getByRole("status").filter({ hasText: "PDF fertig" }),
    ).toBeVisible({ timeout: 120000 });
    expect(
      (await api<PdfPlan>(`/applications/${copyId}/pdf-plan`)).excluded,
    ).toEqual(["build:cover"]);
    await composition
      .getByRole("button", { name: "Schließen", exact: true })
      .click();
    await page
      .getByRole("button", {
        name: "PDF zusammenfügen / optimieren",
        exact: true,
      })
      .click();
    await expect(
      composition.getByRole("checkbox", { name: "Anschreiben einschließen" }),
    ).not.toBeChecked();
    await expect(
      composition.getByRole("checkbox", {
        name: `${currentName} einschließen`,
      }),
    ).toBeChecked();
  } else {
    await expect(
      composition.getByText(
        /PDF-Verarbeitung ist auf diesem Server nicht verfügbar/,
      ),
    ).toBeVisible();
    await expect(
      composition.getByRole("button", { name: "PDF erstellen", exact: true }),
    ).toBeDisabled();
  }
  await composition
    .getByRole("button", { name: "Schließen", exact: true })
    .click();
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
  await page.setViewportSize({ width: 1440, height: 1000 });
  const deletionTarget = await api<ApplicationDetail>("/applications", "POST", {
    company: `${company} delete`,
    role: "Disposable delete",
    documentIds: [originalDoc.id],
  });
  await page.goto(`${url.origin}/bewerbung/applications/${deletionTarget.id}`);
  await expect(
    page.getByRole("heading", { name: deletionTarget.company, exact: true }),
  ).toBeVisible();
  const deletes: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "DELETE") deletes.push(request.url());
  });
  await page
    .getByRole("textbox", { name: "Nachricht an Assistent" })
    .fill("Draft retained on cancel");
  await sidebarContext(`${deletionTarget.company} · ${deletionTarget.role}`);
  await page
    .getByRole("menuitem", { name: "Bewerbung löschen", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Bewerbung löschen", exact: true }),
  ).toContainText("Zentrale Dateien");
  await page.getByRole("button", { name: "Abbrechen", exact: true }).click();
  expect(deletes).toEqual([]);
  await expect(
    page.getByRole("textbox", { name: "Nachricht an Assistent" }),
  ).toHaveText("Draft retained on cancel");
  await sidebarContext(`${deletionTarget.company} · ${deletionTarget.role}`);
  await page
    .getByRole("menuitem", { name: "Bewerbung löschen", exact: true })
    .click();
  await api(`/applications/${deletionTarget.id}`, "PATCH", {
    revision: deletionTarget.revision,
    notes: "Concurrent metadata edit",
  });
  await page
    .getByRole("button", { name: "Bewerbung löschen", exact: true })
    .click();
  await expect(
    page
      .getByRole("dialog", { name: "Bewerbung löschen", exact: true })
      .getByRole("alert"),
  ).toBeVisible();
  expect(
    (await api<Application[]>("/applications")).some(
      (app) => app.id === deletionTarget.id,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Abbrechen", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Nachricht an Assistent" })
    .fill("Discard me, never resurrect");
  await sidebarContext(`${deletionTarget.company} · ${deletionTarget.role}`);
  await page
    .getByRole("menuitem", { name: "Bewerbung löschen", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Bewerbung löschen", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Deine nächste Bewerbung", exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(`aside [data-application-id="${deletionTarget.id}"]`),
  ).toHaveCount(0);
  expect(
    (await api<Application[]>("/applications")).some(
      (app) => app.id === deletionTarget.id,
    ),
  ).toBe(false);
  expect((await api<{ openIds: string[] }>("/ui-state")).openIds).not.toContain(
    deletionTarget.id,
  );
  const deletedDraft = await page.request.get(
    `${url.origin}/bewerbung/api/applications/${deletionTarget.id}/draft`,
  );
  expect(deletedDraft.status()).toBe(404);
  expect(
    await (
      await page.request.get(
        `${url.origin}/bewerbung/api/documents/${originalDoc.id}/file`,
      )
    ).body(),
  ).toEqual(png);
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
