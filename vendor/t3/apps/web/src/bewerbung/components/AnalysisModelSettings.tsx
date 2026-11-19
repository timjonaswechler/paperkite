import { ProviderInstanceId, type ModelSelection } from "@t3tools/contracts";
import type { Settings } from "../shared/api";
import { usePrimarySettings } from "~/hooks/useSettings";
import { useEnvironmentProviders, usePrimaryEnvironment } from "~/state/environments";
import { EMPTY_SERVER_PROVIDERS } from "~/state/server";
import { useTextGenerationTargets } from "~/textGenerators";
import { getTextGenerationModelOptionsByInstance } from "~/modelSelection";
import { ProviderModelPicker } from "~/components/chat/ProviderModelPicker";
import { Button } from "~/components/ui/button";
import { DraftInput } from "~/components/ui/draft-input";
import { SettingsRow, SettingsSection, SETTINGS_PICKER_TRIGGER_CLASSNAME } from "~/components/settings/settingsLayout";
import { searchableSetting } from "~/components/settings/settingsSearch";

export function AnalysisModelSettings({ settings, busy, save }: { settings: Settings | null; busy: boolean; save: (patch: Partial<Settings>) => Promise<void> }) {
  const native = usePrimarySettings();
  const environment = usePrimaryEnvironment();
  const providers = useEnvironmentProviders();
  const selection: ModelSelection = settings?.analysisModel
    ? { instanceId: ProviderInstanceId.make(settings.analysisModel.instanceId), model: settings.analysisModel.model }
    : native.textGenerationModelSelection;
  const targets = useTextGenerationTargets({ environmentId: environment?.environmentId ?? null, settings: native, providers: (environment ? providers.get(environment.environmentId) : undefined)?.filter(provider => provider.supportsTextGeneration !== false) ?? EMPTY_SERVER_PROVIDERS, projectId: null, selections: [selection] });
  const models = getTextGenerationModelOptionsByInstance(native, targets.providers, selection.instanceId, selection.model);
  return <>
    <SettingsSection id="bewerbung-analysis" title="Stellenanalyse">
      <SettingsRow {...searchableSetting("bewerbung-analysis-model")} description="Analysiert beim Einfügen eines Stellen-Links Unternehmen, Stelle und Anforderungen. Verwendet dieselbe Textgenerierung wie T3s Threadbenennung; Chatmodelle bleiben unabhängig." resetAction={settings?.analysisModel ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => void save({ analysisModel: null })}>T3-Vorgabe verwenden</Button> : undefined} control={environment && targets.entries.length ? <div className="min-w-0"><ProviderModelPicker environmentId={environment.environmentId} activeInstanceId={selection.instanceId} model={selection.model} lockedProvider={null} instanceEntries={targets.entries} modelOptionsByInstance={models} triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME} onInstanceModelChange={(instanceId, model) => { if (!busy) void save({ analysisModel: { instanceId, model } }); }} /></div> : <span className="text-sm text-muted-foreground">Textgenerierungs-Anbieter in T3 einrichten.</span>}>
        {!settings?.analysisModel && <p className="text-xs text-muted-foreground">Aktuell wird die T3-Vorgabe für Textgenerierung verwendet.</p>}
      </SettingsRow>
    </SettingsSection>
    <SettingsSection id="bewerbung-download-names" title="Download-Benennung">
      <SettingsRow {...searchableSetting("bewerbung-applicant-name")} description="Name für automatisch benannte PDFs und ZIP-Pakete. Schema: Dokument_Name_Firma_Stelle. Originaldateien werden nicht umbenannt." control={<div className="w-full sm:w-64"><DraftInput aria-label="Name für Dateinamen" value={settings?.applicantName ?? ""} disabled={busy || !settings} maxLength={120} placeholder="Vorname Nachname" onCommit={applicantName => void save({ applicantName: applicantName.trim() })} /></div>} />
    </SettingsSection>
  </>;
}
