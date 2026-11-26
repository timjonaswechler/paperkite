import { parseIgnoreFile } from "../../workspace/IgnorePatterns.ts";

function expandBraces(pattern: string): ReadonlyArray<string> {
  const open = pattern.indexOf("{");
  if (open < 0) return [pattern];
  let depth = 0;
  let start = open + 1;
  const choices: string[] = [];
  for (let index = open + 1; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === "{") depth += 1;
    if (char === "}" && depth > 0) depth -= 1;
    else if ((char === "," && depth === 0) || (char === "}" && depth === 0)) {
      choices.push(pattern.slice(start, index));
      start = index + 1;
      if (choices.length > 32) throw new Error("Too many search glob alternatives");
      if (char === "}") {
        const expanded = choices.flatMap((choice) =>
          expandBraces(pattern.slice(0, open) + choice + pattern.slice(index + 1)),
        );
        if (expanded.length > 32) throw new Error("Too many search glob alternatives");
        return expanded;
      }
    }
  }
  return [pattern];
}

export function compilePathQuery(raw: string) {
  if (raw.length > 1024) throw new Error("Search path query is too long");
  const tokens = raw
    .trim()
    .replace(/:\d+(?::\d+)?$/, "")
    .toLowerCase()
    .split(/\s+/u)
    .filter(Boolean);
  const fuzzy: string[] = [];
  const filters: Array<(path: string, directory: boolean) => boolean> = [];
  for (const token of tokens) {
    const negative = token.startsWith("!");
    const value = negative ? token.slice(1) : token;
    if (/[*?{]/u.test(value)) {
      const patterns = expandBraces(value).map((pattern) => parseIgnoreFile(pattern));
      filters.push(
        (path, directory) =>
          patterns.some((pattern) => pattern.decide(path, directory) === "ignored") !== negative,
      );
    } else if (negative) {
      filters.push((path) => !path.includes(value));
    } else {
      fuzzy.push(value.replace(/^\//u, "").replace(/\/$/u, ""));
    }
  }
  return {
    fuzzy,
    accepts: (path: string, directory: boolean) =>
      filters.every((filter) => filter(path.toLowerCase(), directory)),
    literalFallback: /[{}]/u.test(raw) ? raw.trim().toLowerCase() : undefined,
  };
}

export function splitContentQuery(query: string) {
  const filters: string[] = [];
  let text = query;
  // Only leading, whitespace-separated path constraints are syntax; a bare regex stays untouched.
  while (true) {
    const match = /^(!?\S+)[\t ]+([\s\S]+)$/u.exec(text);
    if (!match || !/^!?\*|^!?[^\s]*\/[^\s]*[*?{]/u.test(match[1]!)) break;
    filters.push(match[1]!);
    text = match[2]!;
  }
  return { text, paths: compilePathQuery(filters.join(" ")) };
}
