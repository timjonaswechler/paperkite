import { useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import { Choice } from "./components/Controls";
import type { api as businessApi } from "./api";
import type { ApplicationDetail } from "./shared/api";
import { Checkbox } from "~/components/ui/checkbox";
type Entry = {
  date?: string;
  title?: string;
  org?: string;
  label?: string;
  bullets?: string[];
  items?: string[];
};
type Profile = {
  path: string;
  revision: number;
  entries: Record<string, Entry[]>;
};
export function EntryReuse({
  id,
  revision,
  profile,
  files,
  applications,
  disabled,
  api,
  onDone,
  onError,
}: {
  id: string;
  revision: number;
  profile: string;
  files: string[];
  applications: { id: string; company: string }[];
  disabled: boolean;
  api: typeof businessApi;
  onDone: () => Promise<void>;
  onError: (e: unknown) => void;
}) {
  const [source, setSource] = useState(""),
    [profiles, setProfiles] = useState<string[]>([]),
    [sourcePath, setSourcePath] = useState("");
  const [preview, setPreview] = useState<Profile | null>(null),
    [selection, setSelection] = useState<string[]>([]),
    [mode, setMode] = useState("append");
  const [destination, setDestination] = useState("cv/profiles/" + profile + ".lua"),
    [loading, setLoading] = useState(false);
  const profileFiles = files.filter((p) => /^cv\/profiles\/[\w-]+\.lua$/.test(p));
  const sourceSequence = useRef(0);
  const profileSequence = useRef(0);
  async function chooseSource(next: string) {
    const sequence = ++sourceSequence.current;
    ++profileSequence.current;
    setSource(next);
    setProfiles([]);
    setSourcePath("");
    setPreview(null);
    setSelection([]);
    if (!next) return;
    try {
      const result = await api<ApplicationDetail>("/applications/" + next);
      if (sequence === sourceSequence.current)
        setProfiles(
          result.files.map((f) => f.name).filter((p) => /^cv\/profiles\/[\w-]+\.lua$/.test(p)),
        );
    } catch (e) {
      if (sequence === sourceSequence.current) onError(e);
    }
  }
  async function chooseProfile(next: string) {
    const sequence = ++profileSequence.current;
    setSourcePath(next);
    setPreview(null);
    setSelection([]);
    if (!source || !next) return;
    try {
      const result = await api<Profile>(
        "/applications/" + source + "/profile?path=" + encodeURIComponent(next),
      );
      if (sequence === profileSequence.current) setPreview(result);
    } catch (e) {
      if (sequence === profileSequence.current) onError(e);
    }
  }
  return (
    <section className="space-y-3 text-sm">
      <h2>Einzelne CV-Einträge übernehmen</h2>
      <label className="flex flex-col gap-1.5">
        Quellbewerbung
        <Choice
          label="Quellbewerbung für Einträge"
          value={source}
          onChange={(next) => void chooseSource(next)}
          options={[
            { value: "", label: "Bitte wählen" },
            ...applications
              .filter((a) => a.id !== id)
              .map((a) => ({ value: a.id, label: a.company })),
          ]}
        />
      </label>
      <label className="flex flex-col gap-1.5">
        Quellprofil
        <Choice
          label="Quellprofil"
          value={sourcePath}
          onChange={(next) => void chooseProfile(next)}
          options={[
            { value: "", label: "Bitte wählen" },
            ...profiles.map((p) => ({ value: p, label: p })),
          ]}
        />
      </label>
      <label className="flex flex-col gap-1.5">
        Zielprofil
        <Choice
          label="Zielprofil"
          value={destination}
          onChange={setDestination}
          options={[
            { value: "", label: "Bitte wählen" },
            ...profileFiles.map((p) => ({ value: p, label: p })),
          ]}
        />
      </label>
      {!profileFiles.length && (
        <p>Zuerst eine Vorlage mit Profil importieren oder eine Bewerbung mit Profil kopieren.</p>
      )}
      {preview &&
        ["experience", "engagement", "skills"].map((section) => (
          <fieldset key={section}>
            <legend>
              {
                {
                  experience: "Berufserfahrung",
                  engagement: "Engagement",
                  skills: "Kenntnisse",
                }[section]
              }
            </legend>
            {(preview.entries[section] ?? []).map((entry, index) => {
              const key = section + ":" + index;
              return (
                <label className="flex items-start gap-2 py-2" key={key}>
                  <Checkbox
                    checked={selection.includes(key)}
                    onCheckedChange={(checked) =>
                      setSelection(
                        checked ? [...selection, key] : selection.filter((x) => x !== key),
                      )
                    }
                  />
                  <span>
                    <strong>{entry.title || entry.label}</strong> {entry.date} {entry.org}
                    <small className="block text-muted-foreground">
                      {(entry.bullets || entry.items || []).join(" · ")}
                    </small>
                  </span>
                </label>
              );
            })}
            {!preview.entries[section]?.length && (
              <small className="block text-muted-foreground">Keine Einträge</small>
            )}
          </fieldset>
        ))}
      <label className="flex flex-col gap-1.5">
        Übernahmeart
        <Choice
          label="Übernahmeart"
          value={mode}
          onChange={setMode}
          options={[
            { value: "append", label: "An vorhandene Einträge anhängen" },
            { value: "replace", label: "Nur ausgewählte Bereiche ersetzen" },
          ]}
        />
      </label>
      <p className="text-xs text-muted-foreground">
        Kopiert nur ausgewählte Einträge in Quellreihenfolge. „Ersetzen“ ersetzt den gesamten
        Zielbereich (z. B. Berufserfahrung), nicht ausgewählte Bereiche bleiben erhalten. Quelle
        unverändert. Kommentare/Formatierung im Zielprofil werden neu geschrieben; nur literale
        Lua-Tabellen. Lua/TeX bleibt manuell editierbar.
      </p>
      <Button
        disabled={
          disabled ||
          loading ||
          !preview ||
          !selection.length ||
          !profileFiles.includes(destination)
        }
        onClick={async () => {
          if (
            mode === "replace" &&
            !confirm(
              "Ausgewählte Zielbereiche vollständig ersetzen? Quelle und andere Bereiche bleiben unverändert.",
            )
          )
            return;
          setLoading(true);
          try {
            await api("/applications/" + id + "/reuse-entries", "POST", {
              source,
              sourceProfile: sourcePath,
              sourceRevision: preview!.revision,
              destinationProfile: destination,
              revision,
              selection: selection.map((k) => {
                const [section, index] = k.split(":");
                return { section, index: Number(index) };
              }),
              mode,
            });
            setSelection([]);
            await onDone();
          } catch (e) {
            onError(e);
          }

          setLoading(false);
        }}
      >
        Einträge als Kopien übernehmen
      </Button>
    </section>
  );
}
