import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { CodexHarness, codexConfig } from "../server/codex.ts";
import { Harness } from "../server/harness.ts";
import { Store } from "../server/store.ts";
import { safeFile } from "../server/files.ts";

test("Codex dynamic document tools require owner and live one-shot decision; escaping and stale approvals fail closed", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bewerbung-codex-unit-")),
    store = new Store(root),
    app = store.create({ company: "Synthetic policy" }),
    other = store.create({ company: "Other" });
  const h = new CodexHarness(store, () => {});
  const s = {
    native: "own-thread",
    cwd: store.workspace(app.id),
    busy: true,
    turn: "own-turn",
    pending: new Map(),
  } as Parameters<(typeof h)["documentCall"]>[1];
  h.sessions.set(app.id, s);
  const call = (
    tool: string,
    args: Record<string, string>,
    threadId = "own-thread",
    turnId = "own-turn",
  ) =>
    h["documentCall"](app.id, s, {
      tool,
      arguments: args,
      threadId,
      turnId,
      callId: "call",
    });
  try {
    for (const file of ["../other.lua", "/etc/passwd", "application.json"]) {
      assert.equal(
        (await call("bewerbung_write", { path: file, content: "bad" })).success,
        false,
      );
      assert.equal(s.pending.size, 0);
    }
    assert.equal(
      (
        await call(
          "bewerbung_read",
          { path: "application.json" },
          "foreign-thread",
        )
      ).success,
      false,
    );
    assert.equal(
      (
        await call(
          "bewerbung_read",
          { path: "application.json" },
          "own-thread",
          "foreign-turn",
        )
      ).success,
      false,
    );
    assert.equal(
      (await call("shell", { path: "application.json" })).success,
      false,
    );
    const read = await call("bewerbung_read", { path: "application.json" });
    assert.equal(read.success, true);
    assert.match(JSON.stringify(read), /Synthetic policy/);
    assert.doesNotMatch(JSON.stringify(read), /Other/);
    const file = "cv/profiles/approved.lua";
    const denied = call("bewerbung_write", {
      path: file,
      content: "return {}",
    });
    let id = [...s.pending.keys()][0];
    assert.ok(id);
    assert.throws(() => store.read(app.id, file));
    await assert.rejects(
      () => h.approve(other.id, id, true),
      /nicht mehr aktiv/,
    );
    await h.approve(app.id, id, false);
    assert.equal((await denied).success, false);
    assert.throws(() => store.read(app.id, file));
    await assert.rejects(() => h.approve(app.id, id, true), /nicht mehr aktiv/);
    const allowed = call("bewerbung_write", {
      path: file,
      content: 'return { marker = "approved" }',
    });
    id = [...s.pending.keys()][0];
    assert.throws(() => store.read(app.id, file));
    await h.approve(app.id, id, true);
    assert.equal((await allowed).success, true);
    assert.equal(
      store.read(app.id, file).toString(),
      'return { marker = "approved" }',
    );
    const pending = call("bewerbung_write", {
      path: file,
      content: "overwritten",
    });
    h["clearPending"](s);
    assert.equal((await pending).success, false);
    assert.equal(
      store.read(app.id, file).toString(),
      'return { marker = "approved" }',
    );
    // A dangling symlink must be caught even though existsSync reports false.
    fs.symlinkSync(
      path.join(root, "not-created.lua"),
      path.join(s.cwd, "cv/profiles/dangling.lua"),
    );
    assert.throws(() => safeFile(s.cwd, "cv/profiles/dangling.lua"), /Symlink/);
    assert.equal(
      (
        await call("bewerbung_write", {
          path: "cv/profiles/dangling.lua",
          content: "bad",
        })
      ).success,
      false,
    );
    assert.equal(s.pending.size, 0);
    const home = path.join(root, "codex", app.id);
    h["checkOwner"](
      { id: "own", cwd: s.cwd, path: path.join(home, "sessions", "own.jsonl") },
      s.cwd,
      home,
      "own",
    );
    for (const thread of [
      { id: "foreign", cwd: s.cwd, path: path.join(home, "sessions", "x") },
      {
        id: "own",
        cwd: store.workspace(other.id),
        path: path.join(home, "sessions", "x"),
      },
      {
        id: "own",
        cwd: s.cwd,
        path: path.join(root, "codex", other.id, "sessions", "x"),
      },
      {
        id: "own",
        cwd: s.cwd,
        path: path.join(home, "sessions", "..", "foreign.jsonl"),
      },
    ])
      assert.throws(
        () => h["checkOwner"](thread, s.cwd, home, "own"),
        /Sitzungsbesitz/,
      );
    const config = codexConfig(s.cwd);
    assert.match(config, /shell_tool = false/);
    assert.match(config, /approvals_reviewer = "user"/);
    assert.doesNotMatch(
      config,
      /danger-full-access|workspace-write|acceptForSession/,
    );
    assert.match(config, /network\]\nenabled = false/);
  } finally {
    h.sessions.clear();
    await h.close();
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("copy never inherits Pi/Codex identity or provider choice; session owner is unique and provider choice persists", async () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "bewerbung-session-test-"),
  );
  let store = new Store(root);
  let harness = new Harness(store, () => {});
  try {
    const a = store.create({ company: "Source session" });
    store.db
      .prepare("INSERT INTO sessions VALUES(?,?,?,?)")
      .run(a.id, "pi", "/synthetic/pi", "pi-saved-model");
    store.db
      .prepare("INSERT INTO codex_sessions VALUES(?,?,?,?)")
      .run(
        a.id,
        "synthetic-native",
        store.workspace(a.id),
        "codex-saved-model",
      );
    store.db
      .prepare("INSERT INTO harness_choice VALUES(?,?)")
      .run(a.id, "codex");
    assert.equal(harness.status(a.id).model, "codex-saved-model");
    harness.setProvider(a.id, "pi");
    assert.equal(harness.status(a.id).model, "pi-saved-model");
    harness.setProvider(a.id, "codex");
    const b = store.create({ source: a.id });
    assert.equal(harness.status(b.id).provider, "pi");
    assert.equal(harness.status(b.id).model, undefined);
    for (const table of ["sessions", "codex_sessions", "harness_choice"])
      assert.equal(
        store.db.prepare(`SELECT * FROM ${table} WHERE app=?`).get(b.id),
        undefined,
      );
    assert.throws(
      () =>
        store.db
          .prepare("INSERT INTO codex_sessions VALUES(?,?,?,?)")
          .run(b.id, "synthetic-native", store.workspace(b.id), null),
      /UNIQUE/,
    );
    await harness.close();
    store.close();
    store = new Store(root);
    harness = new Harness(store, () => {});
    assert.equal(harness.status(a.id).provider, "codex");
    assert.equal(harness.status(a.id).model, "codex-saved-model");
    assert.equal(harness.status(b.id).provider, "pi");
    assert.equal(harness.status(b.id).model, undefined);
  } finally {
    await harness.close();
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
