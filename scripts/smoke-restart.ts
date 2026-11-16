import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import assert from "node:assert/strict";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "bewerbung-restart-"));
let child: ReturnType<typeof spawn> | undefined;
async function start() {
  child = spawn(process.execPath, ["--import", "tsx", "server/main.ts"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: "3115", DATA_DIR: root },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await Promise.race([
    once(child.stdout!, "data"),
    once(child, "exit").then(() => {
      throw new Error("Server start failed");
    }),
  ]);
}
async function stop() {
  if (child && child.exitCode === null) {
    const exit = once(child, "exit");
    child.kill("SIGTERM");
    await exit;
  }
  child = undefined;
}
const base = "http://127.0.0.1:3115/bewerbung/api";
const headers = {
  "Content-Type": "application/json",
  "X-Bewerbung-Request": "1",
};
try {
  await start();
  const app = (await (
    await fetch(base + "/applications", {
      method: "POST",
      headers,
      body: JSON.stringify({
        company: "Persist across process",
        role: "Synthetic role",
      }),
    })
  ).json()) as { id: string; revision: number };
  const saved = await fetch(base + `/applications/${app.id}/file`, {
    method: "PUT",
    headers,
    body: JSON.stringify({
      path: "cv/profiles/restart.lua",
      content: 'return { marker = "PERSIST-921" }',
      revision: app.revision,
    }),
  });
  assert.equal(saved.status, 200);
  const post = async (url: string, body: unknown, method = "POST") => {
    const response = await fetch(base + url, {
      method,
      headers,
      body: JSON.stringify(body),
    });
    assert.ok(response.ok, await response.clone().text());
    return response.json() as Promise<{ id: string; revision: number }>;
  };
  const source = await post("/applications", {
    company: "SYNTHETIC reuse source",
    role: "Synthetic source role",
  });
  const target = await post("/applications", {
    company: "SYNTHETIC reuse target",
    role: "Synthetic target role",
  });
  const sourceText = `return {skills={{label='First',items={'A'}},{label='Second',items={'B'}}}}`;
  const sourceSaved = await post(
    `/applications/${source.id}/file`,
    {
      path: "cv/profiles/default.lua",
      content: sourceText,
      revision: source.revision,
    },
    "PUT",
  );
  const targetSaved = await post(
    `/applications/${target.id}/file`,
    {
      path: "cv/profiles/default.lua",
      content: `return {skills={{label='Existing',items={'C'}}}}`,
      revision: target.revision,
    },
    "PUT",
  );
  await post(`/applications/${target.id}/reuse-entries`, {
    source: source.id,
    sourceProfile: "cv/profiles/default.lua",
    sourceRevision: sourceSaved.revision,
    destinationProfile: "cv/profiles/default.lua",
    revision: targetSaved.revision,
    selection: [{ section: "skills", index: 1 }],
    mode: "append",
  });
  await stop();
  await start();
  const restored = (await (
    await fetch(base + `/applications/${app.id}`)
  ).json()) as { company: string; role: string; revision: number };
  assert.equal(restored.company, "Persist across process");
  assert.equal(restored.role, "Synthetic role");
  assert.equal(restored.revision, 2);
  const bytes = await (
    await fetch(
      base + `/applications/${app.id}/file?path=cv/profiles/restart.lua`,
    )
  ).text();
  assert.equal(bytes, 'return { marker = "PERSIST-921" }');
  const targetProfile = (await (
    await fetch(
      base + `/applications/${target.id}/profile?path=cv/profiles/default.lua`,
    )
  ).json()) as { entries: { skills: { label: string }[] } };
  assert.deepEqual(
    targetProfile.entries.skills.map((x) => x.label),
    ["Existing", "Second"],
  );
  assert.equal(
    await (
      await fetch(
        base + `/applications/${source.id}/file?path=cv/profiles/default.lua`,
      )
    ).text(),
    sourceText,
  );
  console.log(
    "PASS complete Node process shutdown/restart retains SQLite, documents, selected entry copies and byte-identical source",
  );
} finally {
  await stop();
  fs.rmSync(root, { recursive: true, force: true });
}
