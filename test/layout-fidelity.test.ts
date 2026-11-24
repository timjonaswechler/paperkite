import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { zipSync } from "fflate";
import { CvModImports } from "../server/cv-mod-prototype/imports.ts";
import { Store } from "../server/store.ts";
import { dockerModBuilder } from "../server/cv-mod-prototype/native.ts";
import { formBuildFiles } from "../server/cv-form-model.ts";
import { coverBuildFiles } from "../server/cover-mod.ts";
import {
  layoutFixture,
  cvReferenceValues,
  coverReferenceFields,
  referenceProfile,
} from "./fixtures/layout-fidelity.ts";
const hash = (b: Buffer) => createHash("sha256").update(b).digest("hex");

test("independent CV/letter originals and bound mods rasterize identically; changed layout cannot pass", async () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "paperkite-layout-proof-"),
  );
  const builderImage = fs.readFileSync("builder/image-id", "utf8").trim(),
    pdfImage = fs.readFileSync("pdf-tools/image-id", "utf8").trim();
  const build = dockerModBuilder(builderImage, pdfImage);
  const common = [
    "run",
    "--rm",
    "--network=none",
    "--read-only",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",
    "--memory=768m",
    "--cpus=1",
    "--pids-limit=64",
    "--user",
    `${process.getuid!()}:${process.getgid!()}`,
    "--tmpfs",
    "/tmp:rw,nosuid,nodev,noexec,size=128m,mode=1777",
  ];
  async function compile(label: string, files: Record<string, Buffer>) {
    const input = path.join(root, label, "input"),
      output = path.join(root, label, "output");
    fs.mkdirSync(input, { recursive: true, mode: 0o700 });
    fs.mkdirSync(output, { mode: 0o700 });
    for (const [name, bytes] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(input, name)), { recursive: true });
      fs.writeFileSync(path.join(input, name), bytes);
    }
    const result = await build(input, output);
    assert.match(result.text, /Erika Example/);
    assert.match(result.text, /50% & Rust_2026/);
    return output;
  }
  function compare(reference: string, candidate: string, label: string) {
    const output = path.join(root, label);
    fs.mkdirSync(output, { mode: 0o700 });
    return spawnSync(
      "docker",
      [
        ...common,
        "--mount",
        `type=bind,src=${reference},dst=/reference,readonly`,
        "--mount",
        `type=bind,src=${candidate},dst=/candidate,readonly`,
        "--mount",
        `type=bind,src=${output},dst=/out`,
        "--mount",
        `type=bind,src=${path.resolve("scripts/compare-layout-pdfs.py")},dst=/compare.py,readonly`,
        "--entrypoint",
        "python3",
        pdfImage,
        "/compare.py",
      ],
      { encoding: "utf8" },
    );
  }
  try {
    for (const cover of [false, true]) {
      const f = layoutFixture(cover),
        label = cover ? "cover" : "cv";
      const before = Object.fromEntries(
        Object.entries(f.original).map(([n, b]) => [n, hash(b)]),
      );
      const reference = await compile(label + "-original", {
        ...f.original,
        "mod.json": Buffer.from(
          JSON.stringify({
            format: "bewerbung-cv-mod-prototype-v1",
            engine: "lualatex",
            entrypoint: "main.tex",
            fields: [],
          }),
        ),
      });
      const { "mod.json": _manifest, ...sources } = f.mod;
      const input: Record<string, Buffer> = cover
        ? coverBuildFiles(
            {
              format: "bewerbung-cover-mod-v1",
              engine: "lualatex",
              entrypoint: "main.tex",
              applicant: { fields: { sender: "sender" }, signature: "none" },
            },
            sources,
            coverReferenceFields,
            { profile: referenceProfile },
          )
        : formBuildFiles(f.form, sources, cvReferenceValues, {
            profile: referenceProfile,
          });
      const candidate = await compile(label + "-mod", input);
      const result = compare(reference, candidate, label + "-comparison");
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.equal(JSON.parse(result.stdout).result, "identical");
      assert.deepEqual(
        Object.fromEntries(
          Object.entries(f.original).map(([n, b]) => [n, hash(b)]),
        ),
        before,
      );
      let generations = 0;
      const imports = new CvModImports(
        path.join(root, label + "-import"),
        {
          generate: async (workspace, onThread) => {
            generations++;
            for (const [name, bytes] of Object.entries(f.mod)) {
              fs.mkdirSync(path.dirname(path.join(workspace, "mod", name)), {
                recursive: true,
              });
              fs.writeFileSync(path.join(workspace, "mod", name), bytes);
            }
            fs.writeFileSync(
              path.join(workspace, "MOD-CHANGES.md"),
              "Only data.lua is replaced by the app snapshot loader; font, renderer, geometry and image are retained. mod.json declares data bindings.",
            );
            onThread(
              "synthetic-fidelity-thread",
              "https://example.invalid/thread",
            );
          },
          assertFinished: async () => {},
        },
        build,
      );
      try {
        const zip = Buffer.from(zipSync(f.original));
        const job = imports.upload(
          label + ".zip",
          zip,
          cover ? "cover-template" : "cv-template",
        );
        imports.start(job.id);
        await imports.idle();
        const checked = imports.get(job.id);
        assert.equal(checked.status, "review", JSON.stringify(checked.checks));
        const provenance = imports.provenance(job.id, checked.versionId);
        assert.deepEqual(
          provenance.files
            .filter((file) => file.status === "changed")
            .map((file) => file.path),
          ["data.lua"],
        );
        assert.deepEqual(imports.originalUpload(job.id).bytes, zip);
        for (const [name, bytes] of Object.entries(f.original))
          assert.deepEqual(imports.sourceFile(job.id, name), bytes);
        assert.equal(generations, 1);
        const store = new Store(path.join(root, label + "-business"));
        try {
          store.cv.forms.resolveImported = (id) => imports.reviewedForm(id);
          store.cover.resolveMod = (id) => imports.reviewedCover(id);
          store.cv.assertModUsable = (id) => imports.assertUsable(id);
          store.cover.assertModUsable = (id) => imports.assertUsable(id);
          const app = store.create({
            company: "Synthetic offline review",
            role: label,
          });
          const bind = () =>
            cover
              ? store.cover.bind(app.id, {
                  revision: store.app(app.id).revision,
                  modId: checked.versionId,
                })
              : store.cv.bind(
                  app.id,
                  store.app(app.id).revision,
                  checked.versionId,
                );
          assert.throws(bind, /freigegeben/);
          imports.approve(job.id, checked.versionId, checked.updated);
          assert.equal(bind().modId, checked.versionId);
          assert.equal(generations, 1);
        } finally {
          store.close();
        }
      } finally {
        await imports.close();
      }
      if (!cover) {
        const changed = {
          ...input,
          "main.tex": Buffer.from(
            input["main.tex"]!.toString().replace("margin=21mm", "margin=31mm"),
          ),
        };
        const bad = await compile("cv-changed-layout", changed);
        const negative = compare(reference, bad, "negative-comparison");
        assert.equal(negative.status, 1, negative.stderr);
        assert.equal(JSON.parse(negative.stdout).result, "different");
      }
    }
    execFileSync(
      "docker",
      [...common, "--entrypoint", "pdftoppm", pdfImage, "-v"],
      {
        stdio: "pipe",
      },
    );
  } finally {
    if (process.env.PAPERKITE_LAYOUT_EVIDENCE) {
      fs.mkdirSync(process.env.PAPERKITE_LAYOUT_EVIDENCE, {
        recursive: true,
        mode: 0o700,
      });
      fs.cpSync(root, process.env.PAPERKITE_LAYOUT_EVIDENCE, {
        recursive: true,
      });
      fs.writeFileSync(
        path.join(process.env.PAPERKITE_LAYOUT_EVIDENCE, "pins.json"),
        JSON.stringify({ builderImage, pdfImage, dpi: 150, tolerance: 0 }),
      );
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});
