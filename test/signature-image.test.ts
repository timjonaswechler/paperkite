import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { inflateSync } from "node:zlib";
import { normalizeSignaturePng } from "../server/signature-image.ts";

const fixture = (name: string) =>
  fs.readFileSync(
    new URL(`./fixtures/applicant-signatures/${name}.png`, import.meta.url),
  );

test("signature normalization decodes all PNG filters, preserves RGBA pixels and strips metadata", () => {
  const expectedRows = Buffer.from([
    0, 10, 20, 30, 255, 255, 255, 255, 255, 0, 0, 0, 0, 0, 0, 0, 200, 200, 0, 0,
    0, 255, 200, 200, 200, 255,
  ]);
  let canonical: Buffer | undefined;
  for (let filter = 0; filter <= 4; filter++) {
    const result = normalizeSignaturePng(fixture(`rgba-filter-${filter}`));
    assert.equal(result.width, 3);
    assert.equal(result.height, 2);
    assert.equal(result.png.includes(Buffer.from("synthetic metadata")), false);
    const chunks: string[] = [];
    const compressed: Buffer[] = [];
    for (let at = 8; at < result.png.length; ) {
      const size = result.png.readUInt32BE(at);
      const kind = result.png.toString("ascii", at + 4, at + 8);
      chunks.push(kind);
      if (kind === "IDAT")
        compressed.push(result.png.subarray(at + 8, at + 8 + size));
      at += 12 + size;
    }
    assert.deepEqual(chunks, ["IHDR", "IDAT", "IEND"]);
    assert.deepEqual(inflateSync(Buffer.concat(compressed)), expectedRows);
    if (canonical) assert.deepEqual(result.png, canonical);
    canonical = result.png;
  }
});

test("RGB uploads become opaque RGBA without changing their independently specified colors", () => {
  const result = normalizeSignaturePng(fixture("rgb"));
  assert.equal(result.png[25], 6);
  assert.equal(result.png.toString("ascii", 37, 41), "IDAT");
  const size = result.png.readUInt32BE(33);
  assert.deepEqual(
    inflateSync(result.png.subarray(41, 41 + size)),
    Buffer.from([
      0, 210, 31, 17, 255, 255, 255, 255, 255, 30, 40, 50, 255, 0, 12, 180, 95,
      255, 80, 40, 220, 255, 7, 8, 9, 255,
    ]),
  );
});

test("blank, malformed and oversized signatures are rejected before storage", () => {
  for (const name of ["white", "transparent"])
    assert.throws(
      () => normalizeSignaturePng(fixture(name)),
      /leer|Unterschrift/i,
    );
  for (const bytes of [
    Buffer.alloc(0),
    Buffer.from("<svg></svg>"),
    fixture("rgba-filter-0").subarray(0, 40),
  ])
    assert.throws(() => normalizeSignaturePng(bytes), /PNG|Unterschrift/i);
  const corrupted = Buffer.from(fixture("rgba-filter-0"));
  corrupted[corrupted.length - 1] ^= 1;
  assert.throws(() => normalizeSignaturePng(corrupted), /PNG|Prüfsumme/i);
  assert.throws(
    () =>
      normalizeSignaturePng(
        Buffer.concat([fixture("rgba-filter-0"), Buffer.from("trailing data")]),
      ),
    /PNG/i,
  );
  assert.throws(
    () => normalizeSignaturePng(Buffer.alloc(1024 * 1024 + 1)),
    /MiB|groß/i,
  );
});
