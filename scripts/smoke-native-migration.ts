import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import { Store } from "../server/store.ts";
if (process.env.SMOKE_SYNTHETIC !== "1")
  throw new Error("Synthetic opt-in required");
const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "bewerbung-native-migration-"),
  ),
  data = path.join(root, "data"),
  user = path.join(root, "user");
try {
  fs.mkdirSync(path.join(user, ".codex"), { recursive: true });
  fs.writeFileSync(
    path.join(user, ".codex/auth.json"),
    "SYNTHETIC NORMAL AUTH",
  );
  const store = new Store(data),
    app = store.create({ company: "Synthetic migration", role: "Fixture" }),
    workspace = store.workspace(app.id);
  store.close();
  const pi = path.join(data, "sessions", app.id, "session.jsonl"),
    codex = path.join(data, "codex", app.id),
    rollout = path.join(codex, "sessions/2026/11/18/rollout-fixture.jsonl");
  fs.mkdirSync(path.dirname(pi), { recursive: true });
  fs.mkdirSync(path.dirname(rollout), { recursive: true });
  const piBytes =
      JSON.stringify({
        type: "session",
        version: 3,
        id: "5731cedf-7f03-410a-a1ba-f07e2a53fbcd",
        cwd: workspace,
      }) + "\n",
    codexBytes =
      JSON.stringify({
        type: "session_meta",
        payload: { id: "d2548e4e-a1fb-42df-847a-a8c20bc3152b", cwd: workspace },
      }) + "\n";
  fs.writeFileSync(pi, piBytes);
  fs.writeFileSync(rollout, codexBytes);
  fs.writeFileSync(
    path.join(codex, "auth.json"),
    "SYNTHETIC LEGACY CREDENTIAL MUST NOT COPY",
  );
  fs.writeFileSync(
    path.join(codex, "config.toml"),
    "SYNTHETIC OLD RESTRICTIVE POLICY MUST NOT COPY",
  );
  const state = new DatabaseSync(path.join(codex, "state_5.sqlite"));
  state.exec("CREATE TABLE threads(id TEXT,rollout_path TEXT)");
  state.prepare("INSERT INTO threads VALUES(?,?)").run("native-id", rollout);
  state.close();
  const result = execFileSync(
    process.execPath,
    ["--import", "tsx", "scripts/migrate-native-sessions.ts", "--offline"],
    { env: { ...process.env, HOME: user, DATA_DIR: data }, encoding: "utf8" },
  );
  assert.equal(JSON.parse(result.trim()).prepared, true);
  const home = path.join(data, "native-t3"),
    copy = path.join(home, "providers/codex-legacy-" + app.id),
    settings = JSON.parse(
      fs.readFileSync(path.join(home, "userdata/settings.json"), "utf8"),
    );
  assert.equal(
    fs.readFileSync(
      path.join(home, "providers/pi/sessions", app.id, "session.jsonl"),
      "utf8",
    ),
    piBytes,
  );
  assert.equal(fs.readFileSync(pi, "utf8"), piBytes);
  assert.equal(fs.readFileSync(rollout, "utf8"), codexBytes);
  assert.equal(fs.existsSync(path.join(copy, "config.toml")), false);
  assert.equal(
    fs.lstatSync(path.join(copy, "auth.json")).isSymbolicLink(),
    true,
  );
  assert.equal(
    fs.readlinkSync(path.join(copy, "auth.json")),
    path.join(user, ".codex/auth.json"),
  );
  const copied = new DatabaseSync(path.join(copy, "state_5.sqlite"), {
    readOnly: true,
  });
  assert.equal(
    copied.prepare("SELECT rollout_path FROM threads").get()!.rollout_path,
    path.join(copy, "sessions/2026/11/18/rollout-fixture.jsonl"),
  );
  copied.close();
  assert.equal(
    settings.providerInstances["codex-legacy-" + app.id].config.homePath,
    copy,
  );
  assert.equal(
    settings.providerInstances["codex-legacy-" + app.id].config.launchArgs,
    undefined,
  );
  const reopened = new Store(data);
  assert.equal(reopened.app(app.id).revision, app.revision);
  reopened.close();
  assert.equal(
    fs.readFileSync(path.join(codex, "auth.json"), "utf8"),
    "SYNTHETIC LEGACY CREDENTIAL MUST NOT COPY",
  );
  console.log(
    "PASS offline native migration: independent copies, native UUID/cwd bytes preserved, copied Codex index relocated, old policy/auth excluded, business data retained; no model turns",
  );
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
