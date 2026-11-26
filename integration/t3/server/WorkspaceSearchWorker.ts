// Keep this worker self-contained: the native server pack does not emit worker URL assets.
export const source = String.raw`
const { parentPort: port, workerData: input } = require("node:worker_threads");
const escape = (text) => text.replace(/[\\^$.*+?()[\]{}|/]/g, "\\$&");
let pattern;
let regexFallbackError;
try {
  pattern = new RegExp(input.useRegex ? input.query : escape(input.query), input.caseSensitive ? "gu" : "giu");
} catch {
  regexFallbackError = "Invalid or unsupported regular expression; searched literally.";
  pattern = new RegExp(escape(input.query), input.caseSensitive ? "g" : "gi");
}
// Plain matching folds case without Unicode's additional ASCII folds (long s and Kelvin sign).
if (!input.useRegex) pattern = new RegExp(escape(input.query), input.caseSensitive ? "g" : "gi");

const word = /[\p{Letter}\p{Mark}\p{Number}_]/u;
const at = (line, index) => {
  const code = line.codePointAt(index);
  return code === undefined ? "" : String.fromCodePoint(code);
};
const before = (line, index) => {
  const unit = line.charCodeAt(index - 1);
  return at(line, index - (unit >= 0xdc00 && unit <= 0xdfff ? 2 : 1));
};
const wholeWord = (line, start, end) =>
  end > start &&
  (start === 0 || !word.test(before(line, start)) || !word.test(at(line, start))) &&
  (end === line.length || !word.test(at(line, end)) || !word.test(before(line, end)));

port.on("message", (file) => {
  const matches = [];
  let truncated = false;
  if (input.query.length > 0 && !file.bytes.includes(0)) {
    const contents = new TextDecoder().decode(file.bytes);
    let offset = 0;
    let lineNumber = 0;
    while (offset < contents.length) {
      const newline = contents.indexOf("\n", offset);
      const end = newline < 0 ? contents.length : newline;
      const line = contents.slice(offset, end).replace(/\r$/u, "");
      offset = end + 1;
      lineNumber += 1;
      const lineContent = line.slice(0, 512);
      const matchRanges = [];
      let found = false;
      for (const match of line.matchAll(pattern)) {
        const start = match.index;
        const finish = start + match[0].length;
        if (input.wholeWord && (finish > lineContent.length || !wholeWord(line, start, finish))) continue;
        found = true;
        if (finish <= lineContent.length) matchRanges.push({ start, end: finish });
        if (start >= lineContent.length) break;
      }
      if (!found) continue;
      if (matches.length >= Math.min(100, input.limit + 1)) {
        truncated = true;
        break;
      }
      matches.push({ path: file.path, lineNumber, lineContent, matchRanges });
    }
  }
  port.postMessage({ type: "result", matches, truncated, ...(regexFallbackError ? { regexFallbackError } : {}) });
});
port.postMessage({ type: "ready", ...(regexFallbackError ? { regexFallbackError } : {}) });
`;
