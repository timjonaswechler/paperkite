import { useRef, useState, type ChangeEvent } from "react";
import { FileInput } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Switch } from "~/components/ui/switch";
import {
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "~/components/settings/settingsLayout";
import { searchableSetting } from "~/components/settings/settingsSearch";
import { useApplications } from "./ApplicationsProvider";
import { api, errorMessage, requireBusiness } from "./api";
import { ErrorNotice } from "./components/Controls";
import { DocumentLibrary } from "./components/DocumentLibrary";
import { TemplatesManager } from "./components/TemplatesManager";

export function ApplicationSettingsPage() {
  const app = useApplications();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  async function saveAutoBuild(autoBuild: boolean) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await app.saveSettings({ autoBuild });
      setNotice("Gespeichert.");
    } catch (error) {
      setError(errorMessage(error));
    }
    setBusy(false);
  }
  async function importTemplate(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      requireBusiness(file.size <= 24 * 1024 * 1024, "Import maximal 24 MiB");
      const result = await api<{ count: number }>(
        "/templates/import",
        "POST",
        JSON.parse(await file.text()),
      );
      await app.refreshList();
      setNotice(`${result.count} Dateien importiert.`);
    } catch (error) {
      setError(errorMessage(error));
    }
    setBusy(false);
  }
  return (
    <SettingsPageContainer>
      <p className="px-3 text-sm text-muted-foreground sm:px-4">
        Diese Einstellungen gelten für die gesamte Bewerbungsverwaltung. Darstellung, Modelle und
        Chatbedienung werden ausschließlich in den jeweiligen T3-Einstellungen verwaltet.
      </p>
      <ErrorNotice error={error} onClose={() => setError("")} />
      <p role="status" className="px-3 text-xs text-muted-foreground sm:px-4">
        {notice}
      </p>
      <SettingsSection id="bewerbung-pdf" title="PDF-Erstellung">
        <SettingsRow
          {...searchableSetting("bewerbung-auto-build")}
          description="Nach manuellem Speichern einer CV- oder Anschreiben-Quelldatei automatisch ein PDF bauen."
          control={
            <Switch
              aria-label="Nach dem Speichern bauen"
              checked={app.settings?.autoBuild ?? false}
              disabled={busy || app.settings === null}
              onCheckedChange={(autoBuild) => void saveAutoBuild(autoBuild)}
            />
          }
        />
      </SettingsSection>
      <SettingsSection id="bewerbung-templates" title="Vorlagen">
        <SettingsRow
          title="Master importieren"
          description="Vorbereitete JSON-Datei mit Datei-Map (maximal 24 MiB). Bestehende Bewerbungen bleiben unabhängig."
          control={
            <Button variant="outline" disabled={busy} onClick={() => fileRef.current?.click()}>
              <FileInput />
              JSON importieren
            </Button>
          }
        >
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            accept="application/json,.json"
            aria-label="Master-JSON importieren"
            onChange={(event) => void importTemplate(event)}
          />
        </SettingsRow>
        <div className="p-3 sm:p-4">
          <TemplatesManager
            templates={app.templates}
            applications={app.applications}
            onChanged={app.refreshList}
          />
        </div>
      </SettingsSection>
      <SettingsSection id="bewerbung-documents" title="Eigene Dateien">
        <div className="space-y-4 p-3 sm:p-4">
          <p className="text-sm text-muted-foreground">
            Zeugnisse und Anlagen zentral verwalten. Die Auswahl je Bewerbung änderst du in deren
            Details.
          </p>
          <DocumentLibrary />
        </div>
      </SettingsSection>
    </SettingsPageContainer>
  );
}
