import React, { useEffect, useState } from "react";
import { Button } from "./components/ui/button";
import { Choice } from "./components/Controls";
import { Checkbox } from "./components/ui/checkbox";
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
  api: (url: string, method?: string, body?: unknown) => Promise<any>;
  onDone: () => Promise<void>;
  onError: (e: unknown) => void;
}) {
  const [source, setSource] = useState(""),
    [profiles, setProfiles] = useState<string[]>([]),
    [sourcePath, setSourcePath] = useState("");
  const [preview, setPreview] = useState<Profile | null>(null),
    [selection, setSelection] = useState<string[]>([]),
    [mode, setMode] = useState("append");
  const [destination, setDestination] = useState(
      "cv/profiles/" + profile + ".lua",
    ),
    [loading, setLoading] = useState(false);
  const profileFiles = files.filter((p) =>
    /^cv\/profiles\/[\w-]+\.lua$/.test(p),
  );
  useEffect(() => {
    setDestination("cv/profiles/" + profile + ".lua");
  }, [profile]);
  useEffect(() => {
    let live = true;
    setProfiles([]);
    setSourcePath("");
    setPreview(null);
    setSelection([]);
    if (source)
      void api("/applications/" + source)
        .then((a) => {
          if (live)
            setProfiles(
              a.files
                .map((f: { name: string }) => f.name)
                .filter((p: string) => /^cv\/profiles\/[\w-]+\.lua$/.test(p)),
            );
        })
        .catch(onError);
    return () => {
      live = false;
    };
  }, [source]);
  useEffect(() => {
    let live = true;
    setPreview(null);
    setSelection([]);
    if (source && sourcePath)
      void api(
        "/applications/" +
          source +
          "/profile?path=" +
          encodeURIComponent(sourcePath),
      )
        .then((p) => {
          if (live) setPreview(p);
        })
        .catch(onError);
    return () => {
      live = false;
    };
  }, [source, sourcePath]);
  return (
    <section className="entry-reuse space-y-3 text-sm">
      <h2>Einzelne CV-Einträge übernehmen</h2>
      <label>
        Quellbewerbung
        <Choice
          label="Quellbewerbung für Einträge"
          value={source}
          onChange={setSource}
          options={[
            { value: "", label: "Bitte wählen" },
            ...applications
              .filter((a) => a.id !== id)
              .map((a) => ({ value: a.id, label: a.company })),
          ]}
        />
      </label>
      <label>
        Quellprofil
        <Choice
          label="Quellprofil"
          value={sourcePath}
          onChange={setSourcePath}
          options={[
            { value: "", label: "Bitte wählen" },
            ...profiles.map((p) => ({ value: p, label: p })),
          ]}
        />
      </label>
      <label>
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
        <p>
          Zuerst eine Vorlage mit Profil importieren oder eine Bewerbung mit
          Profil kopieren.
        </p>
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
            {preview.entries[section].map((entry, index) => {
              const key = section + ":" + index;
              return (
                <label className="check" key={key}>
                  <Checkbox
                    checked={selection.includes(key)}
                    onCheckedChange={(checked) =>
                      setSelection(
                        checked
                          ? [...selection, key]
                          : selection.filter((x) => x !== key),
                      )
                    }
                  />
                  <span>
                    <strong>{entry.title || entry.label}</strong> {entry.date}{" "}
                    {entry.org}
                    <small>
                      {(entry.bullets || entry.items || []).join(" · ")}
                    </small>
                  </span>
                </label>
              );
            })}
            {!preview.entries[section].length && <small>Keine Einträge</small>}
          </fieldset>
        ))}
      <label>
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
      <p className="hint">
        Kopiert nur ausgewählte Einträge in Quellreihenfolge. „Ersetzen“ ersetzt
        den gesamten Zielbereich (z. B. Berufserfahrung), nicht ausgewählte
        Bereiche bleiben erhalten. Quelle unverändert. Kommentare/Formatierung
        im Zielprofil werden neu geschrieben; nur literale Lua-Tabellen. Lua/TeX
        bleibt manuell editierbar.
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
          } finally {
            setLoading(false);
          }
        }}
      >
        Einträge als Kopien übernehmen
      </Button>
    </section>
  );
}
