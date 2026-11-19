import { check } from "./files.ts";
import type { CoverLetter } from "../shared/api.ts";
const marker = "% bewerbung-cover-v1 ";
export function decodeCover(source: string): CoverLetter | null {
  const line = source.split("\n").find(line => line.startsWith(marker));
  if (!line) return null;
  try { const value = JSON.parse(Buffer.from(line.slice(marker.length), "base64").toString("utf8")); validateCover(value); return encodeCover(value) === source ? value : null; } catch { return null; }
}
function validateCover(value: unknown): asserts value is CoverLetter {
  check(value !== null && typeof value === "object" && !Array.isArray(value), "Anschreibendaten fehlen");
  const fields = value as Record<string, unknown>;
  check(Object.keys(fields).length === 6 && ["sender", "recipient", "subject", "salutation", "body", "closing"].every(key => typeof fields[key] === "string" && (fields[key] as string).length <= (key === "body" ? 40_000 : 2000) && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(fields[key] as string)), "Ungültiger Anschreibentext");
}
export function encodeCover(input: unknown) {
  validateCover(input);
  const escape = (text: string) => text.replace(/[\\{}%&#_$~^]/g, char => ({ "\\": "\\textbackslash{}", "{": "\\{", "}": "\\}", "%": "\\%", "&": "\\&", "#": "\\#", "_": "\\_", "$": "\\$", "~": "\\textasciitilde{}", "^": "\\textasciicircum{}" })[char]!);
  const lines = (text: string) => text.trim().split("\n").map(escape).join("\\\\\n");
  const body = input.body.trim().split(/\n\s*\n/).map(lines).join("\n\n");
  return `${marker}${Buffer.from(JSON.stringify(input)).toString("base64")}\n\\documentclass[11pt,a4paper]{scrlttr2}
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage[ngerman]{babel}
\\usepackage{lmodern}
\\KOMAoptions{foldmarks=false,fromalign=right,parskip=half}
\\setkomavar{fromname}{${escape(input.sender.split("\n")[0] ?? "")}}
\\setkomavar{fromaddress}{${lines(input.sender.split("\n").slice(1).join("\n"))}}
\\setkomavar{subject}{${escape(input.subject)}}
\\setkomavar{signature}{${escape(input.sender.split("\n")[0] ?? "")}}
\\begin{document}
\\begin{letter}{${lines(input.recipient)}}
\\opening{${escape(input.salutation)}}
${body}
\\closing{${escape(input.closing)}}
\\end{letter}
\\end{document}
`;
}
