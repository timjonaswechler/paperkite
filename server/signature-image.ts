import { deflateSync, inflateSync } from "node:zlib";
import { check, HttpError } from "./files.ts";

export const SIGNATURE_LIMIT = 1024 * 1024;
const magic = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++)
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc32(bytes: Buffer) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(kind: string, value: Buffer) {
  const result = Buffer.alloc(value.length + 12);
  result.writeUInt32BE(value.length);
  result.write(kind, 4, 4, "ascii");
  value.copy(result, 8);
  result.writeUInt32BE(
    crc32(result.subarray(4, result.length - 4)),
    result.length - 4,
  );
  return result;
}
function paeth(a: number, b: number, c: number) {
  const p = a + b - c,
    da = Math.abs(p - a),
    db = Math.abs(p - b),
    dc = Math.abs(p - c);
  return da <= db && da <= dc ? a : db <= dc ? b : c;
}

export function normalizeSignaturePng(input: Buffer) {
  check(input.length <= SIGNATURE_LIMIT, "Unterschrift maximal 1 MiB", 413);
  check(
    input.length >= 45 && input.subarray(0, 8).equals(magic),
    "Unterschrift als PNG benötigt",
  );
  let width = 0,
    height = 0,
    channels = 0,
    finished = false;
  const compressed: Buffer[] = [];
  for (let at = 8; at < input.length; ) {
    check(at + 12 <= input.length && !finished, "Unvollständiges PNG");
    const size = input.readUInt32BE(at),
      end = at + 12 + size;
    check(end <= input.length, "Unvollständiges PNG");
    const kind = input.toString("ascii", at + 4, at + 8);
    check(/^[A-Za-z]{4}$/.test(kind), "Ungültiger PNG-Block");
    check(
      crc32(input.subarray(at + 4, end - 4)) === input.readUInt32BE(end - 4),
      "Ungültige PNG-Prüfsumme",
    );
    const data = input.subarray(at + 8, end - 4);
    if (kind === "IHDR") {
      check(at === 8 && size === 13 && !width, "Ungültiger PNG-Kopf");
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      check(
        width > 0 && width <= 2048 && height > 0 && height <= 1024,
        "Unterschrift maximal 2048 × 1024 Pixel",
      );
      check(
        data[8] === 8 &&
          [2, 6].includes(data[9]!) &&
          data[10] === 0 &&
          data[11] === 0 &&
          data[12] === 0,
        "PNG benötigt 8-Bit-RGB/RGBA ohne Interlacing",
      );
      channels = data[9] === 6 ? 4 : 3;
    } else if (kind === "IDAT") {
      check(width && !finished, "Ungültige PNG-Reihenfolge");
      compressed.push(data);
    } else if (kind === "IEND") {
      check(
        size === 0 && compressed.length && end === input.length,
        "Ungültiges PNG-Ende",
      );
      finished = true;
    } else {
      check(
        width &&
          kind[0] === kind[0]!.toLowerCase() &&
          !["acTL", "fcTL", "fdAT"].includes(kind),
        "Nicht unterstützter PNG-Block",
      );
    }
    at = end;
  }
  check(finished && channels, "Unvollständiges PNG");
  const stride = width * channels,
    expected = (stride + 1) * height;
  let raw: Buffer;
  try {
    raw = inflateSync(Buffer.concat(compressed), { maxOutputLength: expected });
  } catch {
    throw new HttpError(400, "Ungültige PNG-Bilddaten");
  }
  check(raw.length === expected, "Ungültige PNG-Bildlänge");
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    check(filter <= 4, "Unbekannter PNG-Filter");
    for (let x = 0; x < stride; x++) {
      const at = y * stride + x;
      const left = x >= channels ? pixels[at - channels]! : 0;
      const up = y ? pixels[at - stride]! : 0;
      const corner = y && x >= channels ? pixels[at - stride - channels]! : 0;
      const predicted =
        filter === 0
          ? 0
          : filter === 1
            ? left
            : filter === 2
              ? up
              : filter === 3
                ? Math.floor((left + up) / 2)
                : paeth(left, up, corner);
      pixels[at] = (raw[y * (stride + 1) + x + 1]! + predicted) & 255;
    }
  }
  const rows = Buffer.alloc((width * 4 + 1) * height);
  let ink = false;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const from = (y * width + x) * channels,
        to = y * (width * 4 + 1) + 1 + x * 4;
      pixels.copy(rows, to, from, from + 3);
      const alpha = channels === 4 ? pixels[from + 3]! : 255;
      rows[to + 3] = alpha;
      if (
        alpha > 16 &&
        Math.min(pixels[from]!, pixels[from + 1]!, pixels[from + 2]!) < 245
      )
        ink = true;
    }
  }
  check(
    ink,
    "Die Unterschrift ist leer. Bitte zeichnen oder ein Bild mit sichtbarer Unterschrift hochladen.",
  );
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const png = Buffer.concat([
    magic,
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  check(png.length <= SIGNATURE_LIMIT, "Unterschrift maximal 1 MiB", 413);
  return { png, width, height };
}
