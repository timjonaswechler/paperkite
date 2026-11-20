import http from "node:http";
import https from "node:https";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { characterEntities } from "character-entities";
import type { JobAnalysis, Settings } from "../shared/api.ts";
import { check, HttpError } from "./files.ts";

export function publicAddress(address: string) {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split(".").map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b! >= 64 && b! <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b! >= 16 && b! <= 31) ||
      (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113)
    );
  }
  if (isIP(address) === 6) {
    const value = address.toLowerCase();
    const first = Number.parseInt(value.split(":")[0]!, 16);
    const second = Number.parseInt(value.split(":")[1] || "0", 16);
    return (
      first >= 0x2000 &&
      first < 0x3fff &&
      first !== 0x2002 &&
      !(first === 0x2001 && (second < 0x200 || second === 0xdb8))
    );
  }
  return false;
}
function sourceUrl(input: unknown) {
  check(
    typeof input === "string" && input.length <= 2000,
    "Ungültiger Stellen-Link",
  );
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new HttpError(400, "Gültigen http(s)-Link einfügen");
  }
  check(
    (url.protocol === "https:" || url.protocol === "http:") &&
      !url.username &&
      !url.password,
    "Ungültiger Stellen-Link",
  );
  url.hash = "";
  return url;
}
export function postingText(html: string) {
  const metadata: string[] = [];
  for (const script of html.matchAll(
    /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi,
  )) {
    try {
      const data: unknown = JSON.parse(script[1]!);
      let visited = 0;
      const collect = (value: unknown, depth: number) => {
        if (depth > 8 || ++visited > 300 || !value || typeof value !== "object")
          return;
        if (
          !Array.isArray(value) &&
          String((value as Record<string, unknown>)["@type"]).includes(
            "JobPosting",
          )
        )
          metadata.push(JSON.stringify(value));
        else
          for (const child of Object.values(value)) collect(child, depth + 1);
      };
      collect(data, 0);
    } catch {
      /* Invalid embedded metadata does not replace the visible advertisement. */
    }
  }
  const visible = html
    .replace(/<(script|style|nav|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<\/?(?:p|h[1-6]|div|li|section|article|br)\b[^>]*>/gi, "\n")
    .replace(/<[^>]*>/g, " ");
  return [...metadata, visible]
    .join("\n")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/gi, (all, entity: string) => {
      if (entity[0] !== "#") return characterEntities[entity] ?? all;
      const n =
        entity[1]?.toLowerCase() === "x"
          ? Number.parseInt(entity.slice(2), 16)
          : Number(entity.slice(1));
      return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff)
        ? String.fromCodePoint(n)
        : " ";
    })
    .replace(/[\t \u00a0]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 60_000);
}

type Resolver = (
  hostname: string,
) => Promise<{ address: string; family: number }[]>;
export async function loadPosting(
  input: string,
  signal: AbortSignal,
  resolve: Resolver = (hostname) => lookup(hostname, { all: true }),
) {
  let url = sourceUrl(input);
  for (let redirects = 0; redirects <= 4; redirects++) {
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const addresses = isIP(host)
      ? [{ address: host, family: isIP(host) }]
      : await resolve(host);
    check(
      addresses.length > 0 &&
        addresses.every((entry) => publicAddress(entry.address)),
      "Diese Adresse ist für Stellenanzeigen nicht erlaubt",
    );
    const address = addresses[0]!;
    const response = await new Promise<{ location?: string; text?: string }>(
      (accept, reject) => {
        const request = (url.protocol === "https:" ? https : http).request(
          url,
          {
            signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
            headers: {
              Accept:
                "text/html,application/xhtml+xml,text/plain,application/json",
              "Accept-Encoding": "identity",
              "User-Agent": "Bewerbungsverwaltung/1.0",
            },
            // Pin the checked address for this connection; redirects are resolved and checked again.
            lookup: (_hostname, options, callback) =>
              options.all
                ? callback(null, [address])
                : callback(null, address.address, address.family),
          },
          (incoming) => {
            if ([301, 302, 303, 307, 308].includes(incoming.statusCode!)) {
              incoming.resume();
              accept({ location: incoming.headers.location });
              return;
            }
            if (incoming.statusCode !== 200) {
              incoming.resume();
              reject(
                new HttpError(
                  422,
                  "Stellenanzeige nicht abrufbar. Bitte Ausschreibungstext einfügen.",
                ),
              );
              return;
            }
            const contentType = incoming.headers["content-type"] ?? "";
            if (
              !/^(text\/|application\/(?:xhtml\+xml|json))/i.test(contentType)
            ) {
              incoming.resume();
              reject(
                new HttpError(
                  422,
                  "Diese Seite enthält keinen lesbaren Ausschreibungstext.",
                ),
              );
              return;
            }
            let size = 0;
            const chunks: Buffer[] = [];
            incoming.on("data", (chunk) => {
              size += chunk.length;
              if (size > 2 * 1024 * 1024)
                request.destroy(
                  new HttpError(
                    413,
                    "Stellenseite zu groß. Bitte Ausschreibungstext einfügen.",
                  ),
                );
              else chunks.push(Buffer.from(chunk));
            });
            incoming.on("error", reject);
            incoming.on("end", () => {
              try {
                const charset =
                  /charset=["']?([\w-]+)/i.exec(contentType)?.[1] ?? "utf-8";
                accept({
                  text: new TextDecoder(charset).decode(Buffer.concat(chunks)),
                });
              } catch {
                reject(
                  new HttpError(
                    422,
                    "Seitenformat nicht lesbar. Bitte Ausschreibungstext einfügen.",
                  ),
                );
              }
            });
          },
        );
        request.on("error", reject);
        request.end();
      },
    );
    if (response.text !== undefined)
      return { url: url.href, text: postingText(response.text) };
    check(
      typeof response.location === "string",
      "Stellen-Link leitet ungültig weiter",
    );
    url = sourceUrl(new URL(response.location, url).href);
  }
  throw new HttpError(
    422,
    "Zu viele Weiterleitungen. Bitte Ausschreibungstext einfügen.",
  );
}

export type AnalysisRequest = {
  text: string;
  sourceUrl: string;
  modelSelection?: NonNullable<Settings["analysisModel"]>;
};
export type AnalysisRunner = (
  input: AnalysisRequest,
  signal: AbortSignal,
) => Promise<{
  company: string;
  role: string;
  requirements: readonly string[];
}>;
export async function analyzePosting(
  input: Record<string, unknown>,
  model: Settings["analysisModel"],
  run: AnalysisRunner,
  signal: AbortSignal,
): Promise<JobAnalysis> {
  const url = sourceUrl(input.url).href;
  check(
    input.text === undefined ||
      (typeof input.text === "string" && input.text.length <= 60_000),
    "Ausschreibungstext maximal 60.000 Zeichen",
  );
  const source =
    typeof input.text === "string" && input.text.trim()
      ? { url, text: input.text.trim() }
      : await loadPosting(url, signal);
  check(
    source.text.length >= 80,
    "Zu wenig lesbarer Inhalt. Bitte vollständigen Ausschreibungstext einfügen.",
  );
  const result = await run(
    {
      text: source.text,
      sourceUrl: source.url,
      ...(model ? { modelSelection: model } : {}),
    },
    signal,
  );
  check(
    [result.company, result.role].every(
      (value) => typeof value === "string" && value.length <= 200,
    ),
    "Ungültige Unternehmens- oder Stellenangabe in der Analyseantwort",
    502,
  );
  check(
    Array.isArray(result.requirements) &&
      result.requirements.length <= 20 &&
      result.requirements.every(
        (value) => typeof value === "string" && value.length <= 600,
      ),
    "Ungültige Analyseantwort",
    502,
  );
  return {
    company: result.company.trim(),
    role: result.role.trim(),
    requirements: [...result.requirements],
    text: source.text,
    url: source.url,
    capturedAt: new Date().toISOString(),
  };
}
