import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { execFileSync } from "node:child_process";
import { Store } from "../server/store.ts";
import { NativeT3Projects } from "../server/t3-projects.ts";
import { prepareNativeDocuments } from "../server/t3-documents.ts";
import { prepareNativeProviderHome } from "../server/t3-home.ts";

test("native file edits advance business CAS without double-counting API edits or losing either application's files", () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "bewerbung-native-workspace-"),
  );
  const store = new Store(root),
    a = store.create({ company: "Synthetic A" }),
    b = store.create({ company: "Synthetic B" });
  const home = path.join(root, "native"),
    userdata = path.join(home, "userdata");
  fs.mkdirSync(userdata, { recursive: true });
  const db = new DatabaseSync(path.join(userdata, "statev2.sqlite"));
  db.exec(
    "CREATE TABLE orchestration_v2_projection_runs(thread_id TEXT,status TEXT); CREATE TABLE orchestration_v2_projection_threads(thread_id TEXT,payload_json TEXT); CREATE TABLE projection_projects(project_id TEXT,workspace_root TEXT)",
  );
  db.close();
  const bridge = new NativeT3Projects(store, {
    origin: "http://127.0.0.1:1",
    options: {
      directory: root,
      sha256: "a".repeat(64),
      home,
      cwd: root,
      port: 1,
    },
    environment: () => ({ environmentId: "synthetic" }),
  });
  try {
    assert.equal(bridge.busy(a.id), false);
    store.save(a.id, "cv/profiles/native.lua", "return 'API edit'", a.revision);
    const savedRevision = store.app(a.id).revision;
    assert.equal(bridge.busy(a.id), false);
    assert.equal(
      store.app(a.id).revision,
      savedRevision,
      "normal API edit must not be counted twice",
    );
    const file = path.join(store.workspace(a.id), "cv/profiles/native.lua");
    fs.writeFileSync(file, "return 'NATIVE EDIT MUST SURVIVE'");
    assert.equal(bridge.busy(a.id), false);
    assert.equal(
      store.app(a.id).revision,
      savedRevision + 1,
      "external native edit invalidates an open business editor's revision",
    );
    assert.throws(
      () =>
        store.save(
          a.id,
          "cv/profiles/native.lua",
          "stale UI overwrite",
          savedRevision,
        ),
      /Inzwischen geändert/,
    );
    assert.equal(
      fs.readFileSync(file, "utf8"),
      "return 'NATIVE EDIT MUST SURVIVE'",
    );
    assert.equal(bridge.busy(a.id), false);
    assert.equal(store.app(a.id).revision, savedRevision + 1);
    store.update(a.id, {
      revision: store.app(a.id).revision,
      notes: "normal metadata edit",
    });
    const afterMetadata = store.app(a.id).revision;
    fs.writeFileSync(file, "return 'NATIVE AFTER METADATA'");
    bridge.busy(a.id);
    assert.equal(
      store.app(a.id).revision,
      afterMetadata + 1,
      "metadata commit must not mask a subsequent native edit",
    );
    assert.equal(store.app(b.id).revision, b.revision);
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("native selected-document copies are discoverable, independent and never overwrite native edits or resurrect deleted copies", () => {
  const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "bewerbung-native-documents-"),
    ),
    store = new Store(root);
  try {
    const original = Buffer.from("%PDF-1.7\nSYNTHETIC ORIGINAL"),
      document = store.documents.upload("Zeugnis.pdf", original);
    const a = store.create({
        company: "Synthetic A",
        documentIds: [document.id],
      }),
      b = store.create({ company: "Synthetic B", documentIds: [document.id] });
    prepareNativeDocuments(store, a.id);
    prepareNativeDocuments(store, b.id);
    const indexPath = path.join(
      store.workspace(a.id),
      "bewerbungsunterlagen/auswahl.json",
    );
    const index = () => JSON.parse(fs.readFileSync(indexPath, "utf8"));
    assert.equal(index().documents[0].id, document.id);
    const relative = index().documents[0].path,
      copy = path.join(store.workspace(a.id), relative),
      other = path.join(store.workspace(b.id), relative);
    assert.deepEqual(fs.readFileSync(copy), original);
    assert.equal(fs.lstatSync(copy).isSymbolicLink(), false);
    fs.writeFileSync(copy, "SYNTHETIC NATIVE EDIT");
    prepareNativeDocuments(store, a.id);
    assert.equal(fs.readFileSync(copy, "utf8"), "SYNTHETIC NATIVE EDIT");
    assert.equal(index().documents[0].workingCopyChanged, true);
    assert.deepEqual(store.documents.bytes(document.id), original);
    assert.deepEqual(fs.readFileSync(other), original);
    fs.unlinkSync(copy);
    prepareNativeDocuments(store, a.id);
    assert.equal(fs.existsSync(copy), false);
    assert.equal(index().documents[0].workingCopyMissing, true);
    store.documents.assign(a.id, []);
    prepareNativeDocuments(store, a.id);
    assert.deepEqual(index().documents, []);
    assert.deepEqual(fs.readFileSync(other), original);
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("native application Git roots never resolve to the enclosing app repository and create no commits or remotes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bewerbung-native-git-"));
  execFileSync("git", ["init", "--quiet", "--template=", root]);
  const store = new Store(path.join(root, "data"));
  new NativeT3Projects(store, {
    origin: "http://127.0.0.1:1",
    options: {
      directory: root,
      sha256: "a".repeat(64),
      home: path.join(root, "native"),
      cwd: root,
      port: 1,
    },
    environment: () => ({ environmentId: "synthetic" }),
  });
  try {
    const parentHead = fs.readFileSync(path.join(root, ".git/HEAD"), "utf8"),
      app = store.create({ company: "Synthetic nested Git" }),
      workspace = store.workspace(app.id);
    assert.equal(
      execFileSync("git", ["-C", workspace, "rev-parse", "--show-toplevel"], {
        encoding: "utf8",
      }).trim(),
      workspace,
    );
    assert.equal(
      execFileSync("git", ["-C", workspace, "remote"], {
        encoding: "utf8",
      }).trim(),
      "",
    );
    assert.throws(() =>
      execFileSync("git", ["-C", workspace, "rev-parse", "--verify", "HEAD"], {
        stdio: "ignore",
      }),
    );
    assert.throws(() =>
      execFileSync("git", ["-C", root, "rev-parse", "--verify", "HEAD"], {
        stdio: "ignore",
      }),
    );
    const external = path.join(root, "outside.txt");
    fs.writeFileSync(external, "UNCHANGED");
    fs.symlinkSync(external, path.join(workspace, ".git/native-hook-link"));
    store.save(
      app.id,
      "cv/profiles/native.lua",
      "return 'managed source'",
      app.revision,
    );
    assert.ok(
      store
        .files(app.id)
        .some((file) => file.name === "cv/profiles/native.lua"),
    );
    assert.equal(fs.readFileSync(external, "utf8"), "UNCHANGED");
    assert.equal(
      fs.readFileSync(path.join(root, ".git/HEAD"), "utf8"),
      parentHead,
    );
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("fresh native provider homes isolate sessions, reuse only normal auth and preserve later stock settings", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bewerbung-native-home-"));
  try {
    const user = path.join(root, "user"),
      home = path.join(root, "application-native"),
      auth = path.join(user, ".codex/auth.json");
    fs.mkdirSync(path.dirname(auth), { recursive: true });
    fs.writeFileSync(auth, "SYNTHETIC AUTH CONTENT NEVER COPIED");
    assert.equal(prepareNativeProviderHome(home, user), true);
    const settingsPath = path.join(home, "userdata/settings.json"),
      settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    assert.equal(
      settings.providerInstances.pi.environment[0].value,
      path.join(home, "providers/pi/sessions"),
    );
    assert.equal(
      settings.providerInstances.codex.config.homePath,
      path.join(home, "providers/codex"),
    );
    const link = path.join(home, "providers/codex/auth.json");
    assert.equal(fs.lstatSync(link).isSymbolicLink(), true);
    assert.equal(fs.readlinkSync(link), auth);
    assert.equal(settings.defaultRuntimeMode, undefined);
    assert.equal(settings.providerInstances.pi.config.launchArgs, undefined);
    const chosen = JSON.stringify({ ...settings, userPreference: "PRESERVE" });
    fs.writeFileSync(settingsPath, chosen);
    assert.equal(prepareNativeProviderHome(home, user), false);
    assert.equal(fs.readFileSync(settingsPath, "utf8"), chosen);
    assert.equal(
      fs.readFileSync(auth, "utf8"),
      "SYNTHETIC AUTH CONTENT NEVER COPIED",
    );
    const alias = path.join(root, "alias");
    fs.mkdirSync(alias);
    fs.symlinkSync(path.join(home, "userdata"), path.join(alias, "userdata"));
    assert.throws(() => prepareNativeProviderHome(alias, user), /Symlink/);
    fs.unlinkSync(path.join(alias, "userdata"));
    fs.mkdirSync(path.join(alias, "userdata"));
    const external = path.join(root, "external.sqlite");
    fs.writeFileSync(external, "UNCHANGED STATE");
    fs.linkSync(external, path.join(alias, "userdata/statev2.sqlite"));
    assert.throws(() => prepareNativeProviderHome(alias, user), /verknüpft/);
    assert.equal(fs.readFileSync(external, "utf8"), "UNCHANGED STATE");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("native document materialization refuses directory/file symlinks without touching their targets", () => {
  const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "bewerbung-native-links-"),
    ),
    store = new Store(root);
  try {
    const document = store.documents.upload(
        "Zeugnis.pdf",
        Buffer.from("%PDF-1.7\nSYNTHETIC"),
      ),
      a = store.create({ company: "Synthetic", documentIds: [document.id] });
    const outside = path.join(root, "outside"),
      directory = path.join(store.workspace(a.id), "bewerbungsunterlagen");
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, "keep"), "UNCHANGED");
    fs.symlinkSync(outside, directory);
    assert.throws(
      () => prepareNativeDocuments(store, a.id),
      /Unterlagenordner/,
    );
    assert.deepEqual(fs.readdirSync(outside), ["keep"]);
    fs.unlinkSync(directory);
    fs.mkdirSync(directory);
    const target = path.join(outside, "keep");
    fs.symlinkSync(target, path.join(directory, document.id + ".pdf"));
    assert.throws(() => prepareNativeDocuments(store, a.id), /reguläre Datei/);
    assert.equal(fs.readFileSync(target, "utf8"), "UNCHANGED");
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
