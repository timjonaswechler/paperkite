import path from "node:path";
import { readTemplateSource } from "./archive.ts";

// Literal references are hints, not a TeX interpreter or proof that system packages/fonts exist.
export function inspectTemplate(name: string, bytes: Buffer) {
  const archive = readTemplateSource(name, bytes, true);
  const files = Object.keys(archive.files).sort();
  const warnings = new Set<string>();
  sources: for (const [source, bytes] of Object.entries(archive.files)) {
    if (!/\.(tex|sty|cls)$/i.test(source)) continue;
    const text = bytes.toString("latin1").replace(/(?<!\\)%[^\r\n]*/g, "");
    const graphics = [
      ...text.matchAll(/\\graphicspath\s*\{((?:\{[^}]*\}\s*)+)\}/g),
    ].flatMap((match) =>
      [...match[1]!.matchAll(/\{([^}]*)\}/g)].map((item) => item[1]!),
    );
    for (const match of text.matchAll(
      /\\(input|include|includegraphics|addbibresource|bibliography)\*?\s*(?:\[[^\]]*\]\s*)?\{([^}]+)\}/g,
    )) {
      const command = match[1]!,
        reference = match[2]!;
      if (/[\\#$]/.test(reference)) continue;
      for (const raw of command === "bibliography"
        ? reference.split(",")
        : [reference]) {
        const target = raw.trim();
        const extensions = path.posix.extname(target)
          ? [""]
          : command === "includegraphics"
            ? [".pdf", ".png", ".jpg", ".jpeg"]
            : command === "bibliography" || command === "addbibresource"
              ? [".bib"]
              : [".tex"];
        const prefixes = [
          "",
          path.posix.dirname(source) + "/",
          ...(command === "includegraphics" ? graphics : []),
        ];
        if (
          !prefixes.some((prefix) =>
            extensions.some((ext) =>
              Object.hasOwn(
                archive.files,
                path.posix.normalize(prefix + target + ext),
              ),
            ),
          )
        )
          warnings.add(
            `${source}: ${target} (${command}) nicht im Upload gefunden. Begleitdatei im vorhandenen Thread nachreichen; Original nicht ersetzen.`,
          );
        if (warnings.size >= 50) {
          warnings.add(
            "Weitere Abhängigkeiten im vorhandenen Thread und beim PDF-Bau prüfen; die Hinweisliste ist auf 50 Einträge begrenzt.",
          );
          break sources;
        }
      }
    }
    for (const match of text.matchAll(/\{([^{}]+\.(?:otf|ttf))\}/gi))
      if (
        !files.some(
          (file) => file === match[1] || file.endsWith("/" + match[1]),
        )
      )
        warnings.add(
          `${source}: Schriftdatei ${match[1]} nicht im Upload gefunden.`,
        );
  }
  return { files, entrypoints: archive.entrypoints, warnings: [...warnings] };
}
