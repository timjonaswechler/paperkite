import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { expect, type Page } from "@playwright/test";

export async function checkApplicationSettings(
  page: Page,
  origin: string,
  data: string,
  output: string,
) {
  const settings = async () =>
    (await page.request.get(origin + "/bewerbung/api/settings")).json();
  const applicationsBefore = await (
    await page.request.get(origin + "/bewerbung/api/applications")
  ).json();
  const initial = await settings();
  assert.deepEqual(Object.keys(initial).sort(), [
    "analysisModel",
    "applicantName",
    "autoBuild",
    "autoPruneBuilds",
    "collapsedStatuses",
    "revision",
  ]);

  await page.goto(origin + "/settings/chat");
  await page.getByLabel("Send shortcut", { exact: true }).click();
  await page.getByRole("option", { name: /Enter always/ }).click();
  await expect(page.getByLabel("Send shortcut", { exact: true })).toContainText(
    "Enter always",
  );
  assert.deepEqual(
    await settings(),
    initial,
    "Native chat preferences must not overwrite business settings",
  );
  const nativeFile = path.join(data, "native-t3", "userdata", "settings.json");
  const nativeBefore = fs.readFileSync(nativeFile);

  await page.goto(origin + "/settings/projects");
  await expect(
    page.getByRole("switch", { name: "Nach dem Speichern bauen", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", {
      name: "Bewerbungseinstellungen öffnen",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Bewerbungseinstellungen", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Applying settings for", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Send shortcut", { exact: true })).toHaveCount(
    0,
  );
  await expect(page.locator("[data-document-library]")).toHaveCount(1);

  const autoBuild = page.getByRole("switch", {
    name: "Nach dem Speichern bauen",
    exact: true,
  });
  await autoBuild.click();
  await expect(autoBuild).toBeChecked();
  assert.equal((await settings()).autoBuild, true);
  await page.reload();
  await expect(autoBuild).toBeChecked();
  const current = await settings();
  const concurrent = await page.request.put(
    origin + "/bewerbung/api/settings",
    {
      headers: { "X-Bewerbung-Request": "1" },
      data: { revision: current.revision, collapsedStatuses: ["Zusage"] },
    },
  );
  assert.equal(concurrent.status(), 200);
  const conflict = page.waitForResponse(
    (response) =>
      response.request().method() === "PUT" &&
      response.url().endsWith("/bewerbung/api/settings"),
  );
  await autoBuild.click();
  assert.equal((await conflict).status(), 409);
  await expect(
    page.getByText(/Einstellungen inzwischen geändert/),
  ).toBeVisible();
  await expect(autoBuild).toBeChecked();
  await expect(autoBuild).toBeEnabled();
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === "PUT" &&
      response.url().endsWith("/bewerbung/api/settings"),
  );
  await autoBuild.click();
  assert.equal((await saved).status(), 200);
  assert.deepEqual((await settings()).collapsedStatuses, ["Zusage"]);
  assert.equal((await settings()).autoBuild, false);
  assert.deepEqual(
    fs.readFileSync(nativeFile),
    nativeBefore,
    "Business settings must not change native server configuration",
  );
  await page.goto(origin + "/settings/chat");
  await expect(page.getByLabel("Send shortcut", { exact: true })).toContainText(
    "Enter always",
  );

  await page.goto(origin + "/settings/projects");
  const files = {
    "cv/Lebenslauf.tex": Buffer.from("Synthetic settings CV").toString(
      "base64",
    ),
    "cv/lua/loader.lua": Buffer.from("return {}").toString("base64"),
    "cv/profiles/general.lua": Buffer.from(
      "return { personal = { name = 'Synthetic' }, experience = {} }",
    ).toString("base64"),
  };
  await page
    .getByLabel("Master-JSON importieren", { exact: true })
    .setInputFiles({
      name: "settings-master.json",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({ format: "bewerbung-template-v1", files }),
      ),
    });
  await expect(
    page.getByRole("heading", { name: "Master", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Master umbenennen", { exact: true }).click();
  await page
    .getByRole("textbox", { name: "Vorlagenname", exact: true })
    .fill("SYNTHETIC SETTINGS TEMPLATE");
  await page
    .getByRole("button", { name: "Vorlage speichern", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "SYNTHETIC SETTINGS TEMPLATE",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByLabel("SYNTHETIC SETTINGS TEMPLATE duplizieren", { exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Vorlagenname", exact: true })
    .fill("SYNTHETIC SETTINGS COPY");
  await page
    .getByRole("button", { name: "Vorlage speichern", exact: true })
    .click();
  const defaultSaved = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      /\/templates\/[^/]+\/default$/.test(response.url()),
  );
  await page
    .getByLabel("SYNTHETIC SETTINGS COPY als Standard setzen", { exact: true })
    .click();
  assert.equal((await defaultSaved).status(), 200);
  const templateList = await (
    await page.request.get(origin + "/bewerbung/api/templates")
  ).json();
  assert.equal(templateList.length, 2);
  assert.equal(
    templateList.find(
      (template: { label: string }) =>
        template.label === "SYNTHETIC SETTINGS COPY",
    ).isDefault,
    true,
  );
  const download = page.waitForEvent("download");
  await page
    .getByLabel("SYNTHETIC SETTINGS TEMPLATE als JSON exportieren", {
      exact: true,
    })
    .click();
  const exportPath = await (await download).path();
  assert.ok(exportPath);
  assert.deepEqual(
    JSON.parse(fs.readFileSync(exportPath, "utf8")).files,
    files,
  );

  const documentBytes = Buffer.from("%PDF-1.7\nSynthetic settings certificate");
  await page.getByLabel("Zeugnisse hochladen", { exact: true }).setInputFiles({
    name: "settings-certificate.pdf",
    mimeType: "application/pdf",
    buffer: documentBytes,
  });
  await expect(
    page.getByText("settings-certificate.pdf", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Nach Tag filtern", { exact: true }),
  ).toBeVisible();
  const documents = await (
    await page.request.get(origin + "/bewerbung/api/documents")
  ).json();
  assert.equal(documents.length, 1);
  const stored = await page.request.get(
    origin + `/bewerbung/api/documents/${documents[0].id}/file`,
  );
  assert.deepEqual(await stored.body(), documentBytes);
  assert.deepEqual(
    await (
      await page.request.get(origin + "/bewerbung/api/applications")
    ).json(),
    applicationsBefore,
  );

  await page
    .getByRole("combobox", { name: "Search settings", exact: true })
    .fill("autobuild");
  await page
    .getByRole("option")
    .filter({ hasText: "Nach dem Speichern bauen" })
    .click();
  await expect(autoBuild).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Bewerbungseinstellungen öffnen",
      exact: true,
    }),
  ).toHaveCount(0);
  await page.screenshot({
    path: path.join(output, "settings-desktop.png"),
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(autoBuild).toBeVisible();
  await page.screenshot({
    path: path.join(output, "settings-mobile.png"),
    animations: "disabled",
  });
  const mobileLayout = await page
    .locator("[data-settings-page-scroll]")
    .evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      overflowing: [...element.querySelectorAll("button, input, p, h3")]
        .filter(
          (child) =>
            child.getBoundingClientRect().right >
            element.getBoundingClientRect().right + 1,
        )
        .map((child) => ({
          tag: child.tagName,
          text: child.textContent?.slice(0, 90),
          width: child.getBoundingClientRect().width,
        })),
    }));
  fs.writeFileSync(
    path.join(output, "settings-layout.json"),
    JSON.stringify(mobileLayout, null, 2),
  );
  assert.ok(
    mobileLayout.scrollWidth <= mobileLayout.clientWidth + 1,
    JSON.stringify(mobileLayout),
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  return {
    integratedSettings: true,
    settingsPersist: true,
    settingsConflictPreservesConcurrentValues: true,
    nativeSettingsIndependent: true,
    templateImportCopyDefaultExport: true,
    centralDocumentUpload: true,
    settingsSearch: true,
    responsiveSettings: true,
  };
}
