// Real, offline PDF pipeline with only synthetic fixtures. No production data or model calls.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { Store } from "../server/store.ts";
import { Builds, dockerRunner } from "../server/builds.ts";
import { PdfJobs } from "../server/pdf-jobs.ts";
import { dockerPdfRunner } from "../server/pdf-runner.ts";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "bewerbung-pdf-real-"));
const store = new Store(path.join(root, "data"));
const builds = new Builds(
  store,
  dockerRunner(fs.readFileSync("builder/image-id", "utf8").trim()),
);
const image = fs.readFileSync("pdf-tools/image-id", "utf8").trim();
const jobs = new PdfJobs(store, builds, dockerPdfRunner(image));
function docker(command: string, args: string[]) {
  return execFileSync(
    "/usr/bin/docker",
    [
      "run",
      "--rm",
      "--network=none",
      "--read-only",
      "--cap-drop=ALL",
      "--security-opt=no-new-privileges",
      "--memory=768m",
      "--cpus=1",
      "--pids-limit=48",
      "--user",
      `${process.getuid!()}:${process.getgid!()}`,
      "--tmpfs",
      "/tmp:rw,nosuid,nodev,noexec,size=64m,mode=1777",
      "--mount",
      `type=bind,src=${root},dst=/fixtures`,
      "--entrypoint",
      command,
      image,
      ...args,
    ],
    { encoding: "utf8", timeout: 60000, maxBuffer: 4 * 1024 * 1024 },
  );
}
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const exportPdf = (id: string, name: string) => {
  fs.copyFileSync(jobs.artifact(id), path.join(root, name));
  return "/fixtures/" + name;
};
async function complete(input: Record<string, unknown>) {
  const job = jobs.start(input);
  await jobs.idle();
  const result = jobs.get(job.id);
  assert.equal(result.status, "success", result.error);
  return result;
}
try {
  const ids: string[] = [];
  for (const [company, markers] of [
    ["ALPHA", ["ALPHA-ONE", "ALPHA-TWO", "ALPHA-THREE"]],
    ["BRAVO", ["BRAVO-ONE", "BRAVO-TWO"]],
  ] as const) {
    const app = store.create({ company });
    const source =
      "\\documentclass{article}\n\\begin{document}\n" +
      markers.join("\n\\newpage\n") +
      "\n\\end{document}";
    store.save(app.id, "anschreiben/Anschreiben.tex", source, app.revision);
    const build = builds.request(app.id, "cover");
    await builds.idle();
    assert.equal(store.build(app.id, String(build.id)).status, "success");
    ids.push(
      store.documents.upload(
        company + ".pdf",
        fs.readFileSync(builds.artifact(app.id, String(build.id))),
      ).id,
    );
  }
  const before = ids.map((id) => sha(store.documents.bytes(id)));
  const items = [
    { kind: "document", id: ids[1], pages: "2" },
    { kind: "document", id: ids[0], pages: "3,1" },
  ];
  const merged = await complete({ items, compression: "lossless" });
  assert.equal(merged.pages, 3);
  const mergedPath = exportPdf(merged.id, "ordered.pdf"),
    text = docker("pdftotext", ["-layout", mergedPath, "-"]);
  const expected = ["BRAVO-TWO", "ALPHA-THREE", "ALPHA-ONE"];
  assert.ok(expected.every((marker) => text.includes(marker)));
  assert.ok(
    text.indexOf(expected[0]) < text.indexOf(expected[1]) &&
      text.indexOf(expected[1]) < text.indexOf(expected[2]),
  );
  assert.ok(!text.includes("BRAVO-ONE") && !text.includes("ALPHA-TWO"));
  const compact = await complete({ items, compression: "compact" });
  assert.equal(compact.pages, 3);
  const compactText = docker("pdftotext", [
    "-layout",
    exportPdf(compact.id, "compact-text.pdf"),
    "-",
  ]);
  assert.equal(compactText.replace(/\s/g, ""), text.replace(/\s/g, ""));
  const invalid = jobs.start({
    items: [{ kind: "document", id: ids[0], pages: "4" }],
    compression: "lossless",
  });
  await jobs.idle();
  assert.equal(jobs.get(invalid.id).status, "failed");
  assert.ok(jobs.get(invalid.id).error?.includes("Seite existiert nicht"));
  docker("python3", [
    "-c",
    "from PIL import Image; Image.effect_noise((2400,3300),80).convert('RGB').save('/fixtures/noise.png',compress_level=0)",
  ]);
  const png = store.documents.upload(
    "Scanned certificate.png",
    fs.readFileSync(path.join(root, "noise.png")),
  );
  const imageLossless = await complete({
    items: [{ kind: "document", id: png.id }],
    compression: "lossless",
  });
  assert.equal(imageLossless.pages, 1);
  const imagePath = exportPdf(imageLossless.id, "image-lossless.pdf");
  docker("pdfimages", ["-png", imagePath, "/fixtures/extracted"]);
  const pixelCheck = docker("python3", [
    "-c",
    "from PIL import Image,ImageChops; a=Image.open('/fixtures/noise.png').convert('RGB'); b=Image.open('/fixtures/extracted-000.png').convert('RGB'); assert a.size==b.size; assert ImageChops.difference(a,b).getbbox() is None; print('pixels identical')",
  ]);
  assert.match(pixelCheck, /pixels identical/);
  const imageCompact = await complete({
    items: [{ kind: "document", id: png.id }],
    compression: "compact",
  });
  assert.equal(imageCompact.pages, 1);
  assert.ok(
    imageCompact.bytes! < imageLossless.bytes!,
    "High-resolution fixture must become smaller in compact mode",
  );
  const info = docker("pdfinfo", [
    exportPdf(imageCompact.id, "image-compact.pdf"),
  ]);
  assert.match(info, /Pages:\s+1/);
  assert.match(info, /Page size:.*A4/);
  docker("qpdf", [
    "--encrypt",
    "synthetic-user",
    "synthetic-owner",
    "256",
    "--",
    mergedPath,
    "/fixtures/encrypted.pdf",
  ]);
  const encrypted = store.documents.upload(
    "Encrypted.pdf",
    fs.readFileSync(path.join(root, "encrypted.pdf")),
  );
  const encryptedJob = jobs.start({
    items: [{ kind: "document", id: encrypted.id }],
    compression: "lossless",
  });
  await jobs.idle();
  assert.equal(jobs.get(encryptedJob.id).status, "failed");
  const malformed = store.documents.upload(
    "Broken.pdf",
    Buffer.from("%PDF-1.7\nNOT A PDF"),
  );
  const failure = jobs.start({
    items: [{ kind: "document", id: malformed.id }],
    compression: "lossless",
  });
  await jobs.idle();
  assert.equal(jobs.get(failure.id).status, "failed");
  assert.deepEqual(
    ids.map((id) => sha(store.documents.bytes(id))),
    before,
  );
  assert.ok(
    fs.readFileSync(jobs.artifact(merged.id)).subarray(0, 5).toString() ===
      "%PDF-",
  );
  console.log(
    `PASS real offline PDF pipeline: manual page order/ranges, searchable text preserved, encrypted/corrupt/out-of-range failures, pixel-identical lossless image, A4 compact scan ${imageLossless.bytes} -> ${imageCompact.bytes} bytes, originals unchanged`,
  );
} finally {
  await jobs.idle();
  await builds.idle();
  store.close();
  fs.rmSync(root, { recursive: true, force: true });
}
