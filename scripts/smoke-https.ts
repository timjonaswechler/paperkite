// Explicit deployment smoke: only its own uniquely named synthetic application is removed.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
if (process.env.DEPLOYMENT_SMOKE !== "1")
  throw new Error(
    "Set DEPLOYMENT_SMOKE=1 to authorize synthetic production data",
  );
const host = "https://srv.devices.teejayslab.de",
  base = host + "/bewerbung/api";
const company = "SYNTHETIC HTTPS deployment verification " + randomUUID();
const headers = {
  "Content-Type": "application/json",
  "X-Bewerbung-Request": "1",
};
let id: string | undefined;
async function json(url: string, body?: unknown) {
  const response = await fetch(base + url, {
    ...(body === undefined
      ? {}
      : { method: "POST", headers, body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15000),
  });
  assert.ok(response.ok, await response.clone().text());
  return response.json();
}
try {
  const html = await (await fetch(host + "/bewerbung/")).text();
  assert.match(html, /<title>Bewerbungen<\/title>/);
  for (const asset of html.matchAll(
    /(?:src|href)="(\/bewerbung\/assets\/[^\"]+)"/g,
  ))
    assert.equal((await fetch(host + asset[1])).status, 200);
  const root = await (await fetch(host + "/")).text();
  assert.doesNotMatch(root, /<title>Bewerbungen<\/title>/);
  assert.match(root, /T3/i);
  assert.equal((await fetch(host + "/interface/")).status, 200);
  const invalidImport = await fetch(base + "/templates/import", {
    method: "POST",
    headers,
    body: "{}",
  });
  assert.equal(invalidImport.status, 400);
  assert.match(await invalidImport.text(), /bewerbung-template-v1/);
  const a = await json("/applications", { company });
  id = a.id;
  const stream = await fetch(base + `/applications/${id}/stream`, {
    signal: AbortSignal.timeout(5000),
  });
  const reader = stream.body!.getReader();
  const first = await reader.read();
  assert.match(new TextDecoder().decode(first.value), /connected/);
  await reader.cancel();
  const source = await fetch(base + `/applications/${id}/download`);
  assert.equal(source.status, 200);
  assert.match(source.headers.get("content-type")!, /zip/);
  assert.equal(
    Buffer.from(await source.arrayBuffer())
      .subarray(0, 2)
      .toString(),
    "PK",
  );
  const b = await json(`/applications/${id}/builds`, { kind: "cover" });
  const deadline = Date.now() + 130000;
  while (true) {
    const current = await json(`/applications/${id}`);
    const build = current.builds.find((x: { id: string }) => x.id === b.id);
    if (build.status === "success") break;
    assert.notEqual(build.status, "failed");
    assert.ok(Date.now() < deadline, "Build timeout");
    await new Promise((r) => setTimeout(r, 300));
  }
  for (const kind of ["pdf", "zip"]) {
    const response = await fetch(
      base + `/applications/${id}/builds/${b.id}/${kind}?download=1`,
    );
    assert.equal(response.status, 200);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(
      bytes.subarray(0, kind === "pdf" ? 5 : 2).toString(),
      kind === "pdf" ? "%PDF-" : "PK",
    );
  }
  console.log(
    "PASS HTTPS app HTML, assets, importer contract, SSE flush, API, real PDF/ZIP downloads; / T3 and /interface intact",
  );
} finally {
  if (id) {
    const root = path.resolve("data"),
      db = new DatabaseSync(path.join(root, "bewerbung.sqlite"));
    try {
      db.exec("PRAGMA foreign_keys=ON; BEGIN IMMEDIATE");
      const row = db.prepare("SELECT company FROM apps WHERE id=?").get(id);
      assert.equal(row?.company, company);
      const builds = db
        .prepare("SELECT id,status FROM builds WHERE app=?")
        .all(id);
      assert.ok(
        builds.every((b) => !["queued", "running"].includes(String(b.status))),
        "Active build: leave named synthetic application in place",
      );
      for (const table of [
        "events",
        "builds",
        "sessions",
        "codex_sessions",
        "harness_choice",
      ])
        db.prepare(`DELETE FROM ${table} WHERE app=?`).run(id);
      db.prepare("DELETE FROM apps WHERE id=?").run(id);
      db.exec("COMMIT");
      fs.rmSync(path.join(root, "applications", id), {
        recursive: true,
        force: true,
      });
      for (const b of builds)
        fs.rmSync(path.join(root, "builds", String(b.id)), {
          recursive: true,
          force: true,
        });
      console.log("Removed only owned synthetic HTTPS application", id);
    } catch (e) {
      if (db.isTransaction) db.exec("ROLLBACK");
      throw e;
    } finally {
      db.close();
    }
  }
}
