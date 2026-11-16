import { check, FILE_LIMIT, HttpError } from "./files.ts";

export type Literal =
  | string
  | number
  | boolean
  | Literal[]
  | { [key: string]: Literal };
export const sections = ["experience", "engagement", "skills"] as const;
export type Section = (typeof sections)[number];
export type Entry = { [key: string]: Literal };
export type Profile = { [key: string]: Literal } & {
  experience: Entry[];
  engagement: Entry[];
  skills: Entry[];
};

// A deliberately bounded literal grammar, never Lua execution. Unsupported source stays untouched.
export function parseLiteralLua(source: string): Literal {
  check(Buffer.byteLength(source) <= FILE_LIMIT, "Lua-Datei zu groß");
  let i = 0,
    nodes = 0;
  const fail = (message = "Nur literales return {…} unterstützt"): never => {
    throw new HttpError(
      400,
      `${message} (Lua-Position ${i + 1}). Manuell bearbeiten; Quelle nicht geändert.`,
    );
  };
  const long = (): string | undefined => {
    const open = /^\[(=*)\[/.exec(source.slice(i));
    if (!open) return;
    i += open[0].length;
    const end = source.indexOf("]" + open[1] + "]", i);
    if (end < 0) fail("Nicht abgeschlossene Langzeichenkette");
    const text = source
      .slice(i, end)
      .replace(/^\r?\n/, "")
      .replace(/\r\n?/g, "\n");
    i = end + open[1].length + 2;
    return text;
  };
  const skip = () => {
    while (i < source.length) {
      if (/\s/.test(source[i])) {
        i++;
        continue;
      }
      if (source.startsWith("--", i)) {
        i += 2;
        if (long() === undefined) {
          while (i < source.length && source[i] !== "\n") i++;
        }
        continue;
      }
      break;
    }
  };
  const string = (): string => {
    const block = long();
    if (block !== undefined) return block;
    const quote = source[i++];
    if (quote !== '"' && quote !== "'") fail("Zeichenkette erwartet");
    let result = "";
    while (i < source.length) {
      const c = source[i++];
      if (c === quote) return result;
      if (c === "\n" || c === "\r")
        fail("Zeilenumbruch in kurzer Zeichenkette");
      if (c !== "\\") {
        result += c;
        continue;
      }
      const e = source[i++];
      const escapes: Record<string, string> = {
        a: "\x07",
        b: "\b",
        f: "\f",
        n: "\n",
        r: "\r",
        t: "\t",
        v: "\v",
        "\\": "\\",
        '"': '"',
        "'": "'",
      };
      if (Object.hasOwn(escapes, e)) result += escapes[e];
      else if (e === "z") {
        while (i < source.length && /\s/.test(source[i])) i++;
      } else if (e === "\n") result += "\n";
      else if (e === "\r") {
        if (source[i] === "\n") i++;
        result += "\n";
      } else if (/\d/.test(e || "")) {
        const digits = e + /^\d{0,2}/.exec(source.slice(i))![0];
        i += digits.length - 1;
        if (+digits > 255) fail("Ungültiger Byte-Escape");
        // Non-ASCII byte escapes cannot safely be reinterpreted as Unicode.
        if (+digits >= 128) fail("Nicht-ASCII-Byte-Escapes nicht unterstützt");
        result += String.fromCharCode(+digits);
      } else if (e === "x") {
        const hex = /^[0-9a-fA-F]{2}/.exec(source.slice(i));
        if (!hex || parseInt(hex[0], 16) >= 128)
          fail("Ungültiger oder nicht unterstützter Hex-Escape");
        result += String.fromCharCode(parseInt(hex![0], 16));
        i += 2;
      } else fail("Nicht unterstützter Lua-Escape");
    }
    return fail("Nicht abgeschlossene Zeichenkette");
  };
  const value = (depth: number): Literal => {
    skip();
    if (depth > 32 || ++nodes > 100000) fail("Lua-Struktur zu komplex");
    if (
      source[i] === '"' ||
      source[i] === "'" ||
      /^\[=*\[/.test(source.slice(i))
    )
      return string();
    if (source[i] === "{") {
      i++;
      skip();
      const array: Literal[] = [],
        map: Record<string, Literal> = Object.create(null);
      let kind = "";
      while (source[i] !== "}") {
        if (i >= source.length) fail("Nicht abgeschlossene Tabelle");
        skip();
        let key: string | undefined;
        const named = /^([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(source.slice(i));
        if (named) {
          key = named[1];
          i += named[0].length;
        } else if (source[i] === "[" && !/^\[=*\[/.test(source.slice(i))) {
          i++;
          skip();
          key = string();
          skip();
          if (source[i++] !== "]") fail();
          skip();
          if (source[i++] !== "=") fail();
        }
        if (key !== undefined) {
          if (
            kind === "array" ||
            Object.hasOwn(map, key) ||
            ["__proto__", "constructor", "prototype"].includes(key)
          )
            fail("Gemischte/mehrdeutige Tabellenschlüssel");
          kind = "map";
          map[key] = value(depth + 1);
        } else {
          if (kind === "map") fail("Gemischte Tabelle");
          kind = "array";
          array.push(value(depth + 1));
        }
        skip();
        if (source[i] === "," || source[i] === ";") {
          i++;
          skip();
        } else if (source[i] !== "}")
          fail("Operatoren/Ausdrücke nicht unterstützt");
      }
      i++;
      return kind === "array" ? array : map;
    }
    for (const token of ["true", "false"])
      if (
        source.startsWith(token, i) &&
        !/[\w]/.test(source[i + token.length] || "")
      ) {
        i += token.length;
        return token === "true";
      }
    const number = /^-?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(
      source.slice(i),
    );
    if (number) {
      i += number[0].length;
      const n = Number(number[0]);
      if (
        !Number.isFinite(n) ||
        (Number.isInteger(n) && !Number.isSafeInteger(n))
      )
        fail("Zahl nicht verlustfrei darstellbar");
      return n;
    }
    return fail();
  };
  skip();
  if (!/^return\b/.test(source.slice(i))) fail();
  i += 6;
  const result = value(0);
  skip();
  if (source[i] === ";") {
    i++;
    skip();
  }
  if (i !== source.length) fail();
  return result;
}
function record(v: Literal): v is Entry {
  return typeof v === "object" && !Array.isArray(v);
}
function list(v: Literal | undefined, label: string): Literal[] {
  if (
    v === undefined ||
    (typeof v === "object" && !Array.isArray(v) && !Object.keys(v).length)
  )
    return [];
  check(Array.isArray(v), `${label}: Liste erwartet; Quelle nicht geändert`);
  return v;
}
export function parseProfile(source: string): Profile {
  const p = parseLiteralLua(source);
  check(record(p), "Profil muss eine benannte Tabelle sein");
  for (const section of sections) {
    p[section] = list(p[section], section).map((v) => {
      check(record(v), `${section}: Eintragstabelle erwartet`);
      const fields =
        section === "skills" ? ["label"] : ["date", "title", "org"];
      for (const key of fields)
        check(
          typeof v[key] === "string",
          `${section}.${key}: Zeichenkette erwartet`,
        );
      const key = section === "skills" ? "items" : "bullets";
      v[key] = list(v[key], key);
      check(
        (v[key] as Literal[]).every((x) => typeof x === "string"),
        `${key}: Zeichenketten erwartet`,
      );
      return v;
    });
  }
  return p as Profile;
}
const quote = (s: string) =>
  '"' +
  s.replace(/[\\"\x00-\x1f\x7f]/g, (c) =>
    c === "\\"
      ? "\\\\"
      : c === '"'
        ? '\\"'
        : "\\" + c.charCodeAt(0).toString().padStart(3, "0"),
  ) +
  '"';
export function serializeProfile(p: Profile): string {
  const encode = (v: Literal, depth = 0): string => {
    if (typeof v === "string") return quote(v);
    if (typeof v !== "object") return String(v);
    const indent = "  ".repeat(depth + 1);
    const values = Array.isArray(v)
      ? v.map((x) => encode(x, depth + 1))
      : Object.entries(v).map(
          ([k, x]) => `[${quote(k)}] = ${encode(x, depth + 1)}`,
        );
    return values.length
      ? `{\n${indent}${values.join(",\n" + indent)},\n${"  ".repeat(depth)}}`
      : "{}";
  };
  return "return " + encode(p) + "\n";
}
export function selectEntries(
  source: Profile,
  destination: Profile,
  selection: unknown,
  mode: unknown,
): Profile {
  check(
    mode === "append" || mode === "replace",
    "Modus append oder replace erforderlich",
  );
  check(
    Array.isArray(selection) &&
      selection.length > 0 &&
      selection.length <= 10000,
    "Einträge auswählen",
  );
  const keys = new Set<string>();
  for (const item of selection) {
    check(
      item &&
        sections.includes(item.section) &&
        Number.isInteger(item.index) &&
        item.index >= 0 &&
        item.index < source[item.section as Section].length,
      "Ungültiger Eintrag",
    );
    const key = item.section + ":" + item.index;
    check(!keys.has(key), "Doppelter Eintrag");
    keys.add(key);
  }
  const result = structuredClone(destination);
  for (const section of sections) {
    const chosen = source[section].filter((_, index) =>
      keys.has(section + ":" + index),
    );
    // Only selected sections are replaced. Source order, never checkbox click order.
    if (chosen.length)
      result[section] = [
        ...(mode === "append" ? result[section] : []),
        ...structuredClone(chosen),
      ];
  }
  return result;
}
