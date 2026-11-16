import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { request } from "node:http";
import { createApp } from "../server/app.ts";
import { Store } from "../server/store.ts";
import { Builds } from "../server/builds.ts";
import {
  decodeImport,
  safeFile,
  FILE_LIMIT,
  neutralCover,
} from "../server/files.ts";

const b64 = (s: string) => Buffer.from(s).toString("base64");
const fixture = () => ({
  format: "bewerbung-template-v1",
  files: {
    "cv/Lebenslauf.tex": b64("CV-A"),
    "cv/lua/loader.lua": b64("return {}"),
    "cv/profiles/alpha.lua": b64('return { name = "Alice" }'),
    "anschreiben/old.tex": b64("OLD COMPANY ADDRESS"),
  },
});
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), "bewerbung-test-"));

test("strict file-map import bounds and path validation, including >10.4MB transport payload", () => {
  const large = fixture();
  for (let n = 0; n < 3; n++)
    Object.assign(large.files, {
      ["cv/profile/large" + n + ".lua"]: b64("x".repeat(2700000)),
    });
  assert.ok(Buffer.byteLength(JSON.stringify(large)) > 10395974);
  assert.equal(
    decodeImport(large).bytes,
    8100000 +
      Buffer.byteLength(
        'CV-Areturn {}return { name = "Alice" }OLD COMPANY ADDRESS',
      ),
  );
  for (const p of [
    "../oops.tex",
    "/cv/Lebenslauf.tex",
    "cv/../x.lua",
    "cv/lua/../../escape.lua",
    "cv\\lua\\x.lua",
    "cv/lua/x.sh",
    "cv/.pi/settings.json",
    "cv/lua//x.lua",
    "fonts/evil.so",
    "application.json",
  ]) {
    assert.throws(
      () =>
        decodeImport({
          ...fixture(),
          files: { ...fixture().files, [p]: b64("evil") },
        }),
      /Importpfad/,
    );
  }
  for (const value of ["!!!!", "eA=", "eB==", "eA==\n"])
    assert.throws(() =>
      decodeImport({
        ...fixture(),
        files: { ...fixture().files, "cv/profile/bad.lua": value },
      }),
    );
  assert.throws(() =>
    decodeImport({
      ...fixture(),
      files: {
        ...fixture().files,
        "cv/profile/large.lua": b64("x".repeat(FILE_LIMIT + 1)),
      },
    }),
  );
  const total: Record<string, string> = { ...fixture().files };
  for (let n = 0; n < 5; n++)
    total["cv/profile/huge" + n + ".lua"] = b64("x".repeat(FILE_LIMIT));
  assert.throws(
    () => decodeImport({ format: "bewerbung-template-v1", files: total }),
    /16 MiB/,
  );
});

test("application copies and file reuse are independent; old addressed letters never seed new facts", () => {
  const root = temp(),
    s = new Store(root);
  try {
    const template = s.import(fixture());
    const a = s.create({
      company: "Firma A",
      role: "Rolle A",
      template: template.id,
    });
    assert.equal(a.profile, "alpha");
    assert.equal(
      s.read(a.id, "anschreiben/Anschreiben.tex").toString(),
      neutralCover,
    );
    assert.throws(() => s.read(a.id, "anschreiben/old.tex"));
    const b = s.create({ source: a.id });
    s.save(
      b.id,
      "cv/profiles/alpha.lua",
      'return { name = "Bob" }',
      b.revision,
    );
    assert.equal(
      s.read(a.id, "cv/profiles/alpha.lua").toString(),
      'return { name = "Alice" }',
    );
    assert.equal(
      fs.readFileSync(
        path.join(root, "templates", template.id, "cv/profiles/alpha.lua"),
        "utf8",
      ),
      'return { name = "Alice" }',
    );
    s.reuse(b.id, a.id, ["cv/profiles/alpha.lua"], s.app(b.id).revision);
    s.save(
      b.id,
      "cv/profiles/alpha.lua",
      'return { name = "Carol" }',
      s.app(b.id).revision,
    );
    assert.equal(
      s.read(a.id, "cv/profiles/alpha.lua").toString(),
      'return { name = "Alice" }',
    );
    assert.throws(
      () => s.save(b.id, "cv/profiles/alpha.lua", "stale", 1),
      /Inzwischen geändert/,
    );
    assert.throws(() => s.read(a.id, "../../bewerbung.sqlite"));
    fs.symlinkSync(
      "/etc/passwd",
      path.join(s.workspace(a.id), "cv/profiles/trap.lua"),
    );
    assert.throws(() => s.read(a.id, "cv/profiles/trap.lua"), /Symlink/);
  } finally {
    s.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("serialized immutable builds, owner checks, failure keeps good PDF, final state survives restart", async () => {
  const root = temp();
  let s = new Store(root);
  try {
    const a = s.create({ company: "Build A" }),
      b = s.create({ company: "Other" });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const seen: string[] = [];
    const builder = new Builds(s, async (input, out, _kind) => {
      const source = fs.readFileSync(
        path.join(input, "anschreiben/Anschreiben.tex"),
        "utf8",
      );
      seen.push(source);
      if (seen.length === 1) await gate;
      if (source === "broken") throw new Error("Expected compile failure");
      fs.writeFileSync(
        path.join(out, "document.pdf"),
        "%PDF-1.7\nFIRST_GOOD\n",
      );
      return "built";
    });
    const first = builder.request(a.id, "cover");
    assert.equal(builder.request(a.id, "cover").id, first.id);
    s.save(a.id, "anschreiben/Anschreiben.tex", "broken", s.app(a.id).revision);
    const failed = builder.request(a.id, "cover");
    await Promise.resolve();
    assert.equal(seen.length, 1);
    release();
    await builder.idle();
    assert.equal(seen[0], neutralCover);
    assert.equal(seen[1], "broken");
    assert.equal(s.build(a.id, String(first.id)).status, "success");
    assert.equal(s.build(a.id, String(failed.id)).status, "failed");
    assert.throws(
      () => builder.artifact(b.id, String(first.id)),
      /nicht gefunden/,
    );
    assert.throws(
      () => builder.artifact(a.id, String(failed.id)),
      /ohne erfolgreiches/,
    );
    assert.equal(
      fs.readFileSync(builder.artifact(a.id, String(first.id)), "utf8"),
      "%PDF-1.7\nFIRST_GOOD\n",
    );
    builder.finalize(a.id, String(first.id));
    s.close();
    s = new Store(root);
    assert.equal(s.build(a.id, String(first.id)).finalized, 1);
    assert.equal(s.app(a.id).company, "Build A");
    assert.equal(
      s.read(a.id, "anschreiben/Anschreiben.tex").toString(),
      "broken",
    );
  } finally {
    s.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("HTTP prefix, SPA history, asset URLs, CSRF/content types, ownership and body limit", async () => {
  const root = temp();
  const app = createApp(root, async () => "", 3117);
  const server = app.web.listen(3117, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as { port: number }).port,
    url = `http://127.0.0.1:${port}`;
  const headers = {
    Host: "127.0.0.1:3117",
    "Content-Type": "application/json",
    "X-Bewerbung-Request": "1",
  };
  const get = (p: string) =>
    fetch(url + p, { headers: { Host: headers.Host } });
  try {
    assert.equal((await get("/bewerbung/")).status, 200);
    const redirect = await fetch(url + "/bewerbung", { redirect: "manual" });
    assert.equal(redirect.status, 308);
    assert.equal(redirect.headers.get("location"), "/bewerbung/");
    assert.equal((await get("/api/health")).status, 404);
    assert.equal((await get("/bewerbung/api/health")).status, 200);
    const html = await (await get("/bewerbung/applications/synthetic")).text();
    assert.match(html, /\/bewerbung\/assets\//);
    const asset = html.match(/src="([^"]+\.js)"/)![1]!;
    const js = await get(asset);
    assert.equal(js.status, 200);
    assert.match(js.headers.get("content-type") || "", /javascript/);
    assert.equal((await get("/bewerbung/assets/missing.js")).status, 404);
    assert.equal((await get("/bewerbung/api/missing")).status, 404);
    assert.equal(
      (
        await fetch(url + "/bewerbung/api/applications", {
          method: "POST",
          headers: { ...headers, Origin: "https://evil.example" },
          body: "{}",
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(url + "/bewerbung/api/applications", {
          method: "POST",
          headers: { Host: headers.Host, "Content-Type": "text/plain" },
          body: "{}",
        })
      ).status,
      415,
    );
    const hostileHost = await new Promise<number | undefined>(
      (resolve, reject) => {
        const r = request(
          url + "/bewerbung/api/health",
          { headers: { Host: "attacker.example" } },
          (res) => {
            res.resume();
            resolve(res.statusCode);
          },
        );
        r.on("error", reject);
        r.end();
      },
    );
    assert.equal(hostileHost, 403);
    const response = await fetch(url + "/bewerbung/api/applications", {
      method: "POST",
      headers,
      body: JSON.stringify({ company: "HTTP A", role: "HTTP Rolle" }),
    });
    assert.equal(response.status, 201);
    const a = (await response.json()) as { id: string };
    assert.equal(
      (await get(`/bewerbung/api/applications/${a.id}/builds/not-owned/pdf`))
        .status,
      404,
    );
    assert.equal(
      (
        await fetch(url + "/bewerbung/api/templates/import", {
          method: "POST",
          headers,
          body: JSON.stringify({ oversized: "a".repeat(24 * 1024 * 1024) }),
        })
      ).status,
      413,
    );
  } finally {
    server.close();
    await app.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Pi document gate fails closed outside workspace and requires a live write decision", async () => {
  const extensionPath = "../server/pi-permissions.ts";
  const { default: permissions } = await import(extensionPath);
  const root = temp();
  fs.mkdirSync(path.join(root, "cv/profiles"), { recursive: true });
  const handlers = new Map<string, Function>();
  permissions({ on: (name: string, fn: Function) => handlers.set(name, fn) });
  let confirmations = 0,
    allow = false;
  const ctx = {
    cwd: root,
    ui: {
      confirm: async () => {
        confirmations++;
        return allow;
      },
    },
  };
  const call = handlers.get("tool_call")!;
  try {
    for (const p of [
      "/etc/passwd",
      "../../data/bewerbung.sqlite",
      "@/home/redjoker/.pi/agent/auth.json",
      "cv/profiles/../../../secrets.lua",
    ])
      assert.equal(
        (await call({ toolName: "read", input: { path: p } }, ctx)).block,
        true,
      );
    assert.equal(
      (await call({ toolName: "bash", input: { command: "pwd" } }, ctx)).block,
      true,
    );
    assert.equal(confirmations, 0);
    assert.equal(
      await call(
        { toolName: "read", input: { path: "application.json" } },
        ctx,
      ),
      undefined,
    );
    assert.equal(
      (
        await call(
          {
            toolName: "write",
            input: { path: "cv/profiles/a.lua", content: "return {}" },
          },
          ctx,
        )
      ).block,
      true,
    );
    assert.equal(confirmations, 1);
    allow = true;
    assert.equal(
      await call(
        {
          toolName: "write",
          input: { path: "cv/profiles/a.lua", content: "return {}" },
        },
        ctx,
      ),
      undefined,
    );
    fs.symlinkSync(
      path.join(root, "missing-target"),
      path.join(root, "cv/profiles/dangling.lua"),
    );
    assert.equal(
      (
        await call(
          {
            toolName: "write",
            input: { path: "cv/profiles/dangling.lua", content: "no" },
          },
          ctx,
        )
      ).block,
      true,
    );
    fs.symlinkSync("/etc/passwd", path.join(root, "cv/profiles/trap.lua"));
    assert.equal(
      (
        await call(
          { toolName: "read", input: { path: "cv/profiles/trap.lua" } },
          ctx,
        )
      ).block,
      true,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
