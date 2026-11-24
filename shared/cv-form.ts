import type { CvBlock } from "./api.ts";
import {
  validateApplicantBindings,
  type ApplicantBindings,
} from "./applicant-profile.ts";
export type Entry = { id: string; included: boolean; values: Values };
export type Values = { [key: string]: string | CvBlock[] | Entry[] };
export type FormNode =
  | {
      type: "text" | "content";
      key: string;
      label: string;
      target: "pdf" | "metadata";
      required?: boolean;
    }
  | { type: "group"; label: string; children: FormNode[] }
  | { type: "columns"; label: string; children: FormNode[] }
  | { type: "entries"; key: string; label: string; children: FormNode[] };
export type FormSpec = {
  format: "bewerbung-cv-form-v2";
  engine: "lualatex";
  entrypoint: string;
  form: FormNode[];
  applicant?: ApplicantBindings;
};
export type FormMod = {
  id: string;
  name: string;
  spec: FormSpec;
  files: Record<string, string>;
};
export function ensure(value: unknown, message: string): asserts value {
  if (!value) throw Error(message);
}
const keyOk = (s: unknown): s is string =>
  typeof s === "string" &&
  /^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(s) &&
  !["constructor", "prototype", "__proto__"].includes(s);
function record(v: unknown): asserts v is Record<string, unknown> {
  ensure(v && typeof v === "object" && !Array.isArray(v), "Objekt erwartet");
}
function keys(v: Record<string, unknown>, allowed: string[]) {
  ensure(
    Object.keys(v).every((k) => allowed.includes(k)),
    "Unbekannte Manifest-Eigenschaft",
  );
}
export function parseForm(value: unknown): FormSpec {
  record(value);
  keys(value, ["format", "engine", "entrypoint", "form", "applicant"]);
  ensure(
    value.format === "bewerbung-cv-form-v2" && value.engine === "lualatex",
    "Nicht unterstützter Formular-Mod",
  );
  ensure(
    typeof value.entrypoint === "string" &&
      /^[A-Za-z0-9_/-]+\.tex$/.test(value.entrypoint) &&
      !value.entrypoint.startsWith("/") &&
      !value.entrypoint.split("/").some((p) => !p || p === ".."),
    "Ungültiger Einstiegspunkt",
  );
  let count = 0;
  const applicantTargets: string[] = [];
  function walk(
    nodes: unknown,
    used: Set<string>,
    inEntry: boolean,
    depth: number,
  ) {
    ensure(
      Array.isArray(nodes) && nodes.length <= 100 && depth <= 8,
      "Ungültige Formularstruktur",
    );
    for (const node of nodes) {
      record(node);
      ensure(++count <= 300, "Formular zu groß");
      ensure(
        typeof node.label === "string" &&
          node.label.length > 0 &&
          node.label.length <= 200,
        "Beschriftung erwartet",
      );
      if (node.type === "group" || node.type === "columns") {
        keys(node, ["type", "label", "children"]);
        if (node.type === "columns")
          ensure(
            Array.isArray(node.children) &&
              node.children.length >= 2 &&
              node.children.length <= 3,
            "Spalten benötigen zwei oder drei Kinder",
          );
        walk(node.children, used, inEntry, depth + 1);
      } else if (node.type === "entries") {
        keys(node, ["type", "key", "label", "children"]);
        ensure(!inEntry, "Verschachtelte Sammlungen noch nicht unterstützt");
        ensure(
          keyOk(node.key) && !used.has(node.key),
          "Doppelte oder ungültige Bindung",
        );
        used.add(node.key);
        walk(node.children, new Set(), true, depth + 1);
      } else {
        ensure(
          node.type === "text" || node.type === "content",
          "Unbekanntes Primitive",
        );
        keys(node, ["type", "key", "label", "target", "required"]);
        ensure(
          keyOk(node.key) && !used.has(node.key),
          "Doppelte oder ungültige Bindung",
        );
        used.add(node.key);
        ensure(
          node.target === "pdf" || node.target === "metadata",
          "Ausgabeziel erwartet",
        );
        if (!inEntry && node.type === "text" && node.target === "pdf")
          applicantTargets.push(node.key);
        ensure(
          node.required === undefined || typeof node.required === "boolean",
          "Ungültiges Pflichtfeld",
        );
      }
    }
  }
  walk(value.form, new Set(), false, 0);
  if (value.applicant !== undefined)
    validateApplicantBindings(value.applicant, applicantTargets);
  return value as unknown as FormSpec;
}
export function validateValues(
  spec: FormSpec,
  value: unknown,
  required = false,
): asserts value is Values {
  const ids = new Set<string>();
  let nodes = 0;
  const id = (v: unknown) => {
    ensure(
      typeof v === "string" && v.length > 0 && v.length <= 160 && !ids.has(v),
      "IDs müssen eindeutig sein",
    );
    ids.add(v);
    ensure(++nodes <= 5000, "Zu viele Werte");
  };
  const text = (v: unknown) =>
    ensure(
      typeof v === "string" && v.length <= 40000 && !v.includes("\0"),
      "Ungültiger Text",
    );
  function safe(v: unknown, depth: number) {
    record(v);
    ensure(depth <= 8, "Werte zu tief");
    for (const [k, x] of Object.entries(v)) {
      ensure(keyOk(k), "Ungültiger Wertschlüssel");
      if (typeof x === "string") text(x);
      else {
        ensure(Array.isArray(x), "Wert muss Text, Inhalt oder Einträge sein");
        for (const a of x) {
          record(a);
          id(a.id);
          if (a.type === "paragraph") {
            keys(a, ["id", "type", "text"]);
            text(a.text);
          } else if (a.type === "bulletList") {
            keys(a, ["id", "type", "items"]);
            ensure(Array.isArray(a.items), "Listenpunkte erwartet");
            for (const i of a.items) {
              record(i);
              keys(i, ["id", "text"]);
              id(i.id);
              text(i.text);
            }
          } else {
            keys(a, ["id", "included", "values"]);
            ensure(typeof a.included === "boolean", "PDF-Auswahl erwartet");
            safe(a.values, depth + 1);
          }
        }
      }
    }
  }
  safe(value, 0);
  ensure(JSON.stringify(value).length <= 2 * 1024 * 1024, "Werte zu groß");
  function bound(nodes: FormNode[], values: Values) {
    for (const node of nodes) {
      if (node.type === "group" || node.type === "columns")
        bound(node.children, values);
      else if (node.type === "entries") {
        const entries = values[node.key];
        ensure(
          entries === undefined ||
            (Array.isArray(entries) && entries.every((e) => "values" in e)),
          "Sammlungsbindung hat falschen Typ: " + node.key,
        );
        for (const entry of (entries || []) as Entry[])
          if (!required || entry.included) bound(node.children, entry.values);
      } else {
        const field = values[node.key];
        ensure(
          field === undefined ||
            (node.type === "text"
              ? typeof field === "string"
              : Array.isArray(field) && field.every((b) => "type" in b)),
          "Feldbindung hat falschen Typ: " + node.key,
        );
        if (required && node.required)
          ensure(
            node.type === "text"
              ? typeof field === "string" && field.trim()
              : Array.isArray(field) &&
                  field.some((b) =>
                    "text" in b
                      ? b.text.trim()
                      : "items" in b && b.items.some((i) => i.text.trim()),
                  ),
            "Pflichtangabe fehlt: " + node.label,
          );
      }
    }
  }
  bound(spec.form, value as Values);
}
export function pdfValues(spec: FormSpec, values: Values): Values {
  const select = (nodes: FormNode[], source: Values): Values => {
    const out: Values = {};
    for (const node of nodes) {
      if (node.type === "group" || node.type === "columns")
        Object.assign(out, select(node.children, source));
      else if (node.type === "entries")
        out[node.key] = ((source[node.key] || []) as Entry[])
          .filter((e) => e.included)
          .map((e) => ({ ...e, values: select(node.children, e.values) }));
      else if (node.target === "pdf" && source[node.key] !== undefined)
        out[node.key] = source[node.key]!;
    }
    return out;
  };
  return select(spec.form, values);
}
export function unmapped(spec: FormSpec, values: Values): string[] {
  const scan = (nodes: FormNode[], v: Values, prefix: string): string[] => {
    const flat = nodes.flatMap((n) =>
      n.type === "group" || n.type === "columns" ? flatten(n.children) : [n],
    );
    const keys = new Set(flat.flatMap((n) => ("key" in n ? [n.key] : [])));
    return [
      ...Object.keys(v)
        .filter((k) => !keys.has(k))
        .map((k) => prefix + k),
      ...flat.flatMap((n) =>
        n.type === "entries"
          ? ((v[n.key] || []) as Entry[]).flatMap((e) =>
              scan(n.children, e.values, prefix + n.key + "/" + e.id + "/"),
            )
          : [],
      ),
    ];
  };
  const flatten = (nodes: FormNode[]): FormNode[] =>
    nodes.flatMap((n) =>
      n.type === "group" || n.type === "columns" ? flatten(n.children) : [n],
    );
  return scan(spec.form, values, "");
}
