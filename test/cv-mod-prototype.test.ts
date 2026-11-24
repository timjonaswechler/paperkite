import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import http from "node:http";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { applicantBuildFiles } from "../server/applicant-rendering.ts";
import { emptyApplicantProfile } from "../shared/applicant-profile.ts";
import { zipSync } from "fflate";
import { readTemplateZip } from "../server/cv-mod-prototype/archive.ts";
import { luaData } from "../server/cv-mod-prototype/model.ts";
import {
  CvModImports,
  type ModBuilder,
  type ModThreadRunner,
} from "../server/cv-mod-prototype/imports.ts";
import {
  dockerModBuilder,
  nativeModThreads,
} from "../server/cv-mod-prototype/native.ts";
import { parseLiteralLua } from "../server/lua-profile.ts";
import { createApp } from "../server/app.ts";
import { cvModPrototypeRoutes } from "../server/cv-mod-prototype/routes.ts";

const zip = (files: Record<string, string>) =>
  Buffer.from(
    zipSync(
      Object.fromEntries(
        Object.entries(files).map(([n, s]) => [n, Buffer.from(s)]),
      ),
      { mtime: new Date("2020-01-01T00:00:00Z") },
    ),
  );
const input = () =>
  zip({
    "cv/main.tex":
      "\\documentclass{article}\\begin{document}Original\\end{document}",
    "cv/build/old.pdf": "ignored",
    "__MACOSX/._cv": "ignored",
    "cv/.DS_Store": "ignored",
  });
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), "cv-mod-prototype-"));
const source = fs.readFileSync("test/fixtures/cv-mod-synthetic.tex", "utf8");
function fakeThread(
  role = true,
  mutate?: (workspace: string) => void,
): ModThreadRunner {
  return {
    generate: async (workspace, onThread) => {
      fs.mkdirSync(path.join(workspace, "mod", "layout"), { recursive: true });
      fs.writeFileSync(
        path.join(workspace, "mod", "layout", "main.tex"),
        source,
      );
      fs.writeFileSync(
        path.join(workspace, "mod", "mod.json"),
        JSON.stringify({
          format: "bewerbung-cv-mod-prototype-v1",
          engine: "lualatex",
          entrypoint: "layout/main.tex",
          fields: role
            ? [
                {
                  key: "person.role",
                  label: "Role",
                  type: "text",
                  required: false,
                },
              ]
            : [],
        }),
      );
      onThread(
        "synthetic-thread",
        "http://127.0.0.1/synthetic-environment/synthetic-thread",
      );
      mutate?.(workspace);
    },
    assertFinished: async () => {},
  };
}
const texts: Record<string, string> = {
  bullets:
    "Demo Applicant Engineer Example Company 2020 BulletMarker17 BulletMarker29 SecondEntryMarker61",
  paragraphs: "ParagraphMarker31 with 50% & Rust_2026.",
  mixed: "BeforeMarker41 MiddleMarker43 AfterMarker47",
  "optional-role": "RoleMarker42 OptionalMarker53",
  empty: "EmptyMarker59",
};
const fakeBuild: ModBuilder = async (input, output) => {
  fs.writeFileSync(
    path.join(output, "document.pdf"),
    "%PDF-1.4\nsynthetic boundary fixture",
  );
  return {
    text: texts[path.basename(path.dirname(input))]!,
    log: "synthetic builder boundary",
  };
};

test("ZIP import retains sources, drops artifacts, and rejects traversal, symlinks and exaggerated declared sizes", () => {
  const archive = readTemplateZip(input());
  assert.deepEqual(Object.keys(archive.files), ["main.tex"]);
  assert.deepEqual(archive.entrypoints, ["main.tex"]);
  assert.match(archive.files["main.tex"]!.toString(), /Original/);
  assert.throws(
    () => readTemplateZip(zip({ "../escape.tex": "bad" })),
    /Unsicher/,
  );
  assert.throws(
    () => readTemplateZip(zip({ "cv/file.pdf": "not source" })),
    /keine Vorlagenquellen/,
  );
  const symlink = zip({ "main.tex": "\\documentclass{article}" });
  const central = symlink.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  symlink.writeUInt32LE((0xa1ff << 16) >>> 0, central + 38);
  assert.throws(() => readTemplateZip(symlink), /Symlinks/);
  const huge = zip({ "main.tex": "\\documentclass{article}" });
  const at = huge.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  huge.writeUInt32LE(33 * 1024 * 1024, at + 24);
  assert.throws(() => readTemplateZip(huge), /ungültiges ZIP-Mitglied/);
});

test("technical Lua serialization round-trips hostile strings without evaluating Lua", () => {
  const value = {
    role: "Engineer",
    text: ']=] ]==] \\ % & _\n"quoted"',
    sections: [
      {
        id: "one",
        content: [{ type: "paragraph", text: 'os.execute("not executed")' }],
      },
    ],
  }; // The existing parser deliberately returns null-prototype records; JSON content is the ABI.
  assert.deepEqual(
    JSON.parse(JSON.stringify(parseLiteralLua("return " + luaData(value)))),
    value,
  );
});

test("profile verification changes classic CV inputs and signature assets and tests the unsigned optional state", async () => {
  const root = temp();
  const imageHashes = new Map<string, string>();
  const runner = fakeThread(true, (workspace) => {
    const filename = path.join(workspace, "mod", "mod.json");
    const manifest = JSON.parse(fs.readFileSync(filename, "utf8"));
    manifest.applicant = {
      fields: { "person.displayName": "name" },
      signature: "optional",
    };
    fs.writeFileSync(filename, JSON.stringify(manifest));
  });
  const imports = new CvModImports(root, runner, async (input, output) => {
    const id = path.basename(path.dirname(input));
    if (!id.startsWith("applicant-")) return fakeBuild(input, output);
    const data = parseLiteralLua(
      fs.readFileSync(path.join(input, "cv-data.lua"), "utf8"),
    ) as { person: { displayName: string } };
    assert.equal(
      data.person.displayName,
      id === "applicant-second"
        ? "ChangedFirst197 ChangedLast199"
        : "Demo Applicant",
    );
    const image = path.join(input, "applicant-signature.png");
    assert.equal(fs.existsSync(image), id !== "applicant-unsigned");
    if (fs.existsSync(image))
      imageHashes.set(
        id,
        createHash("sha256").update(fs.readFileSync(image)).digest("hex"),
      );
    fs.writeFileSync(
      path.join(output, "document.pdf"),
      "%PDF-1.4\nsynthetic compiler boundary",
    );
    return {
      text: data.person.displayName,
      log: "synthetic boundary; snapshot inputs asserted",
    };
  });
  try {
    const job = imports.upload(
      "profile.zip",
      input(),
      "cv-template",
      "bewerbung-cv-mod-prototype-v1",
    );
    imports.start(job.id);
    await imports.idle();
    const checked = imports.get(job.id);
    assert.equal(checked.status, "review", JSON.stringify(checked));
    assert.equal(checked.checks.length, 8);
    assert(checked.checks.every((c) => c.status === "passed"));
    assert.equal(imageHashes.size, 2);
    assert.notEqual(
      imageHashes.get("applicant-primary"),
      imageHashes.get("applicant-second"),
    );
  } finally {
    await imports.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("upload has no model side effect; double-start is idempotent and generated state survives reopening", async () => {
  const root = temp();
  let calls = 0;
  const fake = fakeThread();
  const store = new CvModImports(
    root,
    {
      ...fake,
      generate: async (...args) => {
        calls++;
        await fake.generate(...args);
      },
    },
    fakeBuild,
  );
  try {
    assert.throws(
      () => store.upload("cv.zip", input(), "document"),
      /Vorlagentyp Lebenslauf oder Anschreiben/,
    );
    const job = store.upload(
      "cv.zip",
      input(),
      "cv-template",
      "bewerbung-cv-mod-prototype-v1",
    );
    assert.equal(calls, 0);
    store.start(job.id);
    store.start(job.id);
    await store.idle();
    assert.equal(calls, 1);
    assert.equal(store.get(job.id).status, "review");
    await store.close();
    const reopened = new CvModImports(root, fake, fakeBuild);
    try {
      assert.equal(reopened.get(job.id).status, "review");
      assert.throws(() => reopened.start(job.id), /bereits gestartet/);
    } finally {
      await reopened.close();
    }
  } finally {
    await store.close().catch(() => {});
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("restart marks unfinished imports interrupted without starting a replacement model round", async () => {
  const root = temp();
  let calls = 0;
  const runner = {
    ...fakeThread(),
    generate: async () => {
      calls++;
    },
  };
  const first = new CvModImports(root, runner, fakeBuild);
  const job = first.upload(
    "synthetic.zip",
    input(),
    "cv-template",
    "bewerbung-cv-mod-prototype-v1",
  );
  first.db.prepare("UPDATE jobs SET value=? WHERE id=?").run(
    JSON.stringify({
      ...job,
      status: "generating",
      threadId: "previous-thread",
    }),
    job.id,
  );
  await first.close();
  const second = new CvModImports(root, runner, fakeBuild);
  try {
    assert.equal(second.get(job.id).status, "interrupted");
    assert.equal(second.get(job.id).threadId, "previous-thread");
    await second.idle();
    assert.equal(calls, 0);
    await second.close();
    await second.close();
    assert.throws(() => second.recheck(job.id), /beendet/);
  } finally {
    await second.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("missing paragraphs cannot pass checks; unsupported optional role is visible instead of forced into every layout", async () => {
  for (const [role, dropText] of [
    [true, true],
    [false, false],
  ] as const) {
    const root = temp();
    let built = 0;
    const store = new CvModImports(root, fakeThread(role), async (i, o) => {
      built++;
      const result = await fakeBuild(i, o);
      return {
        ...result,
        text:
          dropText && i.includes("/paragraphs/")
            ? "Missing all required content"
            : result.text,
      };
    });
    try {
      const j = store.upload(
        "cv.zip",
        input(),
        "cv-template",
        "bewerbung-cv-mod-prototype-v1",
      );
      store.start(j.id);
      await store.idle();
      const result = store.get(j.id);
      if (dropText) {
        assert.equal(result.status, "failed");
        assert.equal(
          result.checks.find((c) => c.id === "paragraphs")?.status,
          "failed",
        );
      } else {
        assert.equal(result.status, "review");
        assert.equal(built, 4);
        assert.equal(
          result.checks.find((c) => c.id === "optional-role")?.status,
          "unsupported",
        );
      }
    } finally {
      await store.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test("bound versions survive failed rechecks and deletion protects bindings until native cleanup finishes", async () => {
  const root = temp();
  let corrupt = false,
    used = true;
  let release!: () => void, began!: () => void;
  const cleanupStarted = new Promise<void>((resolve) => {
    began = resolve;
  });
  const cleanup = new Promise<void>((resolve) => {
    release = resolve;
  });
  const store = new CvModImports(
    root,
    {
      ...fakeThread(),
      remove: async () => {
        began();
        await cleanup;
      },
    },
    async (input, output) => {
      const result = await fakeBuild(input, output);
      return {
        ...result,
        text: corrupt ? "Incomplete adapter output" : result.text,
      };
    },
  );
  store.isUsed = () => used;
  try {
    const job = store.upload(
      "cv.zip",
      input(),
      "cv-template",
      "bewerbung-cv-mod-prototype-v1",
    );
    store.start(job.id);
    await store.idle();
    const first = store.get(job.id);
    assert.ok(first.versionId);
    const original = store.reviewed(first.versionId);
    fs.rmSync(path.join(root, job.id, "builds", first.buildId!, "package"), {
      recursive: true,
    });
    assert.deepEqual(store.reviewed(first.versionId), original);
    const legacy = { ...store.get(job.id) };
    delete legacy.targetFormat;
    store.db
      .prepare("UPDATE jobs SET value=? WHERE id=?")
      .run(JSON.stringify(legacy), job.id);
    assert.match(
      original.files["layout/main.tex"]!.toString(),
      /Synthetic adapter fixture/,
    );
    await assert.rejects(store.remove(job.id, first.updated), /verwendet/);
    corrupt = true;
    store.recheck(job.id);
    await store.idle();
    assert.equal(store.get(job.id).status, "failed");
    assert.equal(store.reviewed(first.versionId).digest, original.digest);
    assert.throws(() => store.reviewed(job.id), /noch nicht erfolgreich/);
    used = false;
    const latest = store.get(job.id);
    const removing = store.remove(job.id, latest.updated);
    await cleanupStarted;
    assert.throws(() => store.reviewed(first.versionId!), /gelöscht/);
    assert.throws(() => store.recheck(job.id), /gelöscht/);
    release();
    await removing;
    assert.throws(() => store.get(job.id), /nicht gefunden/);
    assert.throws(() => store.reviewed(first.versionId!), /nicht gefunden/);
  } finally {
    release?.();
    await store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("modified original or unsafe generated adapter cannot become reviewable", async () => {
  for (const change of [
    (w: string) =>
      fs.writeFileSync(path.join(w, "source", "main.tex"), "changed"),
    (w: string) =>
      fs.symlinkSync("/etc/passwd", path.join(w, "mod", "stolen.tex")),
  ]) {
    const root = temp();
    let builds = 0;
    const store = new CvModImports(
      root,
      fakeThread(true, change),
      async (i, o) => {
        builds++;
        return fakeBuild(i, o);
      },
    );
    try {
      const j = store.upload(
        "cv.zip",
        input(),
        "cv-template",
        "bewerbung-cv-mod-prototype-v1",
      );
      store.start(j.id);
      await store.idle();
      assert.equal(store.get(j.id).status, "failed");
      assert.equal(builds, 0);
      assert.equal(
        fs.readFileSync(path.join(root, j.id, "original.zip")).equals(input()),
        true,
      );
    } finally {
      await store.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test("real offline LuaLaTeX/PDF extraction covers lists, multiple entries, paragraphs, mixed order, optional role and empty sections", async () => {
  const root = temp();
  const builder = dockerModBuilder(
    fs.readFileSync("builder/image-id", "utf8").trim(),
    fs.readFileSync("pdf-tools/image-id", "utf8").trim(),
  );
  const store = new CvModImports(root, fakeThread(), builder);
  try {
    const j = store.upload(
      "synthetic.zip",
      input(),
      "cv-template",
      "bewerbung-cv-mod-prototype-v1",
    );
    store.start(j.id);
    await store.idle();
    const result = store.get(j.id);
    assert.equal(result.status, "review", JSON.stringify(result.checks));
    assert.equal(result.checks.length, 5);
    assert.ok(result.checks.every((c) => c.status === "passed"));
    const pdf = store.artifact(j.id, "mixed");
    const hash = createHash("sha256")
      .update(fs.readFileSync(pdf))
      .digest("hex");
    fs.appendFileSync(
      path.join(root, j.id, "workspace", "mod", "layout", "main.tex"),
      "\n% later edit",
    );
    assert.equal(
      createHash("sha256").update(fs.readFileSync(pdf)).digest("hex"),
      hash,
    );
    assert.ok(!store.list().some((x) => x.id !== j.id));
  } finally {
    await store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("offline signature verification detects different strokes encoded only in transparency", async () => {
  const root = temp(),
    input = path.join(root, "input"),
    output = path.join(root, "output"),
    wrong = path.join(root, "wrong-reference");
  const image = fs.readFileSync("pdf-tools/image-id", "utf8").trim();
  for (const directory of [input, output, wrong])
    fs.mkdirSync(directory, { mode: 0o700 });
  const bindings = { fields: {}, signature: "required" as const };
  const files = {
    "mod.json": Buffer.from(
      JSON.stringify({
        format: "bewerbung-cv-mod-prototype-v1",
        engine: "lualatex",
        entrypoint: "main.tex",
        fields: [],
        applicant: bindings,
      }),
    ),
    "main.tex": Buffer.from(
      String.raw`\documentclass{article}\usepackage{graphicx}\input{applicant-data.tex}\begin{document}\ApplicantSignature\end{document}`,
    ),
    "cv-data.lua": Buffer.from("return {}"),
    ...applicantBuildFiles(bindings, {
      profile: emptyApplicantProfile(),
      signaturePng: fs.readFileSync(
        "test/fixtures/applicant-signatures/alpha-ink-a.png",
      ),
    }),
  };
  for (const [name, bytes] of Object.entries(files))
    fs.writeFileSync(path.join(input, name), bytes);
  fs.copyFileSync(
    "test/fixtures/applicant-signatures/alpha-ink-b.png",
    path.join(wrong, "applicant-signature.png"),
  );
  try {
    const result = await dockerModBuilder(
      fs.readFileSync("builder/image-id", "utf8").trim(),
      image,
    )(input, output);
    assert.match(result.log, /Unterschriftsgrafik im PDF nachgewiesen/);
    assert.throws(
      () =>
        execFileSync(
          "docker",
          [
            "run",
            "--rm",
            "--network=none",
            "--read-only",
            "--cap-drop=ALL",
            "--security-opt=no-new-privileges",
            "--user",
            `${process.getuid!()}:${process.getgid!()}`,
            "--tmpfs",
            "/tmp:rw,nosuid,nodev,noexec,size=64m,mode=1777",
            "--mount",
            `type=bind,src=${output},dst=/input,readonly`,
            "--mount",
            `type=bind,src=${wrong},dst=/source,readonly`,
            "--mount",
            `type=bind,src=${path.resolve("server/cv-mod-prototype/check-signature.py")},dst=/check-signature.py,readonly`,
            "--entrypoint",
            "python3",
            image,
            "/check-signature.py",
          ],
          { stdio: "pipe" },
        ),
      (error: unknown) =>
        Boolean(
          error &&
          typeof error === "object" &&
          "stderr" in error &&
          String(error.stderr).includes("nicht wiedergefunden"),
        ),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("prototype HTTP API rejects restricted credentials, wrong origin and non-CV upload types without starting a model", async () => {
  const root = temp();
  let starts = 0;
  const runner = fakeThread();
  const imports = new CvModImports(
    path.join(root, "mods"),
    {
      ...runner,
      generate: async (...args) => {
        starts++;
        await runner.generate(...args);
      },
    },
    fakeBuild,
  );
  const server = http.createServer();
  server.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const origin = "http://127.0.0.1:" + address.port;
  const app = createApp(
    path.join(root, "app"),
    async () => "",
    address.port,
    undefined,
    {
      configureApi: (api) =>
        cvModPrototypeRoutes(api, imports, {
          publicOrigin: origin,
          cookieName: "prototype_session",
          token: async () => "synthetic-owner",
        }),
    },
  );
  server.on("request", app.web);
  const url = origin + "/bewerbung/api/prototype/cv-mods";
  const headers = {
    cookie: "prototype_session=synthetic-owner",
    "content-type": "application/json",
    "x-bewerbung-request": "1",
  };
  try {
    assert.equal((await fetch(url + "/jobs")).status, 403);
    assert.equal(
      (
        await fetch(url + "/jobs", {
          headers: { ...headers, authorization: "Bearer synthetic-restricted" },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(url + "/jobs", {
          headers: { ...headers, origin: "https://foreign.invalid" },
        })
      ).status,
      403,
    );
    const invalid = await fetch(url + "/jobs", {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "cv.zip",
        documentType: "document",
        zipBase64: input().toString("base64"),
      }),
    });
    assert.equal(invalid.status, 400);
    assert.equal(starts, 0);
    const created = await fetch(url + "/jobs", {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "cv.zip",
        documentType: "cv-template",
        targetFormat: "bewerbung-cv-mod-prototype-v1",
        zipBase64: input().toString("base64"),
      }),
    });
    assert.equal(created.status, 201);
    const job = (await created.json()) as { id: string };
    assert.equal(starts, 0);
    assert.equal(
      (
        await fetch(url + "/jobs/" + job.id + "/start", {
          method: "POST",
          headers,
          body: "{}",
        })
      ).status,
      202,
    );
    await imports.idle();
    assert.equal(starts, 1);
    assert.equal(
      (
        (await (await fetch(url + "/jobs/" + job.id, { headers })).json()) as {
          status: string;
        }
      ).status,
      "review",
    );
    assert.equal(
      (
        await fetch(url + "/jobs/" + job.id + "/pdf/mixed", { headers })
      ).headers.get("content-type"),
      "application/pdf",
    );
    const originalDownload = await fetch(
      url + "/jobs/" + job.id + "/original",
      { headers },
    );
    assert.deepEqual(
      Buffer.from(await originalDownload.arrayBuffer()),
      input(),
    );
    assert.equal(
      originalDownload.headers.get("cache-control"),
      "private, no-store",
    );
    assert.match(
      originalDownload.headers.get("content-disposition")!,
      /attachment/,
    );
    assert.equal(
      (await fetch(url + "/jobs/" + job.id + "/original")).status,
      403,
    );
    assert.equal(
      (
        await fetch(url + "/jobs/" + job.id + "/original", {
          headers: { ...headers, authorization: "Bearer synthetic-restricted" },
        })
      ).status,
      403,
    );
    const sourceDownload = await fetch(
      url + "/jobs/" + job.id + "/source?path=main.tex",
      { headers },
    );
    assert.match(await sourceDownload.text(), /Original/);
    assert.equal(
      (
        await fetch(url + "/jobs/" + job.id + "/source?path=..%2Fescape.tex", {
          headers,
        })
      ).status,
      400,
    );
    const provenance = (await (
      await fetch(url + "/jobs/" + job.id + "/provenance", { headers })
    ).json()) as {
      versionId: string;
      files: { path: string; status: string }[];
    };
    assert(provenance.versionId);
    assert(
      provenance.files.some(
        (file) => file.path === "main.tex" && file.status === "removed",
      ),
    );
    const changed = (await (
      await fetch(url + "/jobs/" + job.id + "/diff?path=main.tex", { headers })
    ).json()) as { diff: string };
    assert.match(changed.diff, /-.*Original/);
    assert.equal(
      starts,
      1,
      "Auditing originals must not start another model round",
    );
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    await imports.close();
    await app.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("native CLI bridge targets only configured stage home and uses a local project without model or permission overrides", async () => {
  const root = temp(),
    log = path.join(root, "calls.jsonl"),
    binary = path.join(root, "fake-t3");
  fs.writeFileSync(
    binary,
    `#!/usr/bin/env node\nconst fs=require('fs');const a=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(log)},JSON.stringify(a)+'\\n');if(a[0]==='thread'&&a[1]==='start'){if(!fs.existsSync(require('path').join(a[2],'BUILD-ENVIRONMENT.json')))throw Error('Build context missing before model start');console.log(JSON.stringify({threadId:'mcp:synthetic-thread',runId:'synthetic-run'}));}else if(a[0]==='thread'&&a[1]==='show')console.log(JSON.stringify({thread:{activeRunId:null,latestRunId:'synthetic-run',status:'idle',pendingRequestCount:0,runCount:1}}));else console.log('project added');\n`,
    { mode: 0o700 },
  );
  const workspace = path.join(root, "workspace");
  fs.mkdirSync(workspace);
  const home = path.join(root, "isolated-native");
  let link = "";
  try {
    const runner = nativeModThreads({
      binary,
      home,
      environmentId: "stage-environment",
      publicOrigin: "http://127.0.0.1:3170",
    });
    await runner.generate(
      workspace,
      (_id, url) => {
        link = url;
      },
      () => assert.fail("unexpected attention"),
      new AbortController().signal,
    );
    assert.equal(
      link,
      "http://127.0.0.1:3170/stage-environment/mcp%3Asynthetic-thread",
    );
    const environment = JSON.parse(
      fs.readFileSync(path.join(workspace, "BUILD-ENVIRONMENT.json"), "utf8"),
    );
    assert.equal(
      environment.builderImage,
      fs.readFileSync("builder/image-id", "utf8").trim(),
    );
    assert.equal(
      environment.pdfImage,
      fs.readFileSync("pdf-tools/image-id", "utf8").trim(),
    );
    assert.equal(environment.dockerfile, path.resolve("builder/Dockerfile"));
    assert.equal(
      environment.dependencyDockerfile,
      path.resolve("builder/newtx/Dockerfile"),
    );
    assert.equal(
      environment.dependencyBuildScript,
      path.resolve("builder/newtx/build.sh"),
    );
    assert.equal(
      environment.runner,
      path.resolve("server/cv-mod-prototype/build.py"),
    );
    assert.equal(environment.candidateDirectory, "build-support");
    assert.equal(environment.productionActivation, "operator-only");
    assert.equal(environment.pdfNetwork, "none");
    assert.equal(environment.shellEscape, false);
    const calls = fs
      .readFileSync(log, "utf8")
      .trim()
      .split("\n")
      .map((s) => JSON.parse(s) as string[]);
    assert.equal(calls.length, 3);
    assert.ok(
      calls.every((a) => a.at(-2) === "--base-dir" && a.at(-1) === home),
    );
    assert.ok(
      calls.every(
        (a) =>
          !a.some((x) =>
            [
              "--worktree",
              "--branch",
              "--provider",
              "--model",
              "--runtime-mode",
            ].includes(x),
          ),
      ),
    );
    assert.ok(
      !fs.existsSync(path.join(workspace, ".git", "refs", "heads", "master")),
      "No commit created",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
