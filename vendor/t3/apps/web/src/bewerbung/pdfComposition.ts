import type { ApplicationDetail, LibraryDocument, PdfInput } from "~/bewerbung/shared/api";

export type PdfSource = PdfInput & {
  label: string;
  mime: string;
  bytes?: number;
};
export type PdfRow = PdfSource & { included: boolean };
export const pdfKey = (item: PdfInput) => `${item.kind}:${item.id}`;
export function pdfSources(documents: LibraryDocument[], app?: ApplicationDetail): PdfSource[] {
  const builds = app
    ? (["cover", "cv"] as const).flatMap((kind) => {
        const build = app.builds.find((item) => item.kind === kind && item.status === "success");
        return build
          ? [
              {
                kind: "build" as const,
                id: build.id,
                label: kind === "cover" ? "Anschreiben" : "Lebenslauf",
                mime: "application/pdf",
              },
            ]
          : [];
      })
    : [];
  return [
    ...builds,
    ...documents.map((doc) => ({
      kind: "document" as const,
      id: doc.id,
      label: doc.label,
      mime: doc.mime,
      bytes: doc.bytes,
    })),
  ];
}
export function planSourceKey(item: PdfInput, app?: ApplicationDetail) {
  return item.kind === "build"
    ? `build:${app?.builds.find((build) => build.id === item.id)?.kind ?? item.id}`
    : pdfKey(item);
}
export function rehydratePdfPlan(
  items: PdfInput[],
  sources: PdfSource[],
  app?: ApplicationDetail,
  excluded: string[] = [],
): PdfRow[] {
  const rows: PdfRow[] = [];
  const used = new Set<string>();
  for (const item of items) {
    const kind =
      item.kind === "build" ? app?.builds.find((build) => build.id === item.id)?.kind : undefined;
    const source = kind
      ? sources.find(
          (candidate) =>
            candidate.kind === "build" &&
            app?.builds.find((build) => build.id === candidate.id)?.kind === kind,
        )
      : sources.find((candidate) => pdfKey(candidate) === pdfKey(item));
    if (!source || used.has(pdfKey(source))) continue;
    used.add(pdfKey(source));
    rows.push({
      ...source,
      ...(item.pages ? { pages: item.pages } : {}),
      included: !excluded.includes(planSourceKey(source, app)),
    });
  }
  return [
    ...rows,
    ...sources
      .filter((source) => !used.has(pdfKey(source)))
      .map((source) => ({
        ...source,
        included: !excluded.includes(planSourceKey(source, app)),
      })),
  ];
}
export function validPageRange(pages: string) {
  if (!pages.trim()) return true;
  return pages.split(",").every((part) => {
    const match = /^(\d+)(?:-(\d+))?$/.exec(part.trim());
    if (!match) return false;
    const start = Number(match[1]);
    const end = Number(match[2] ?? match[1]);
    return Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 1 && end >= start;
  });
}
