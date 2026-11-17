// Native session disposal only: model catalogs, never an inference/prompt or production data.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { Store } from "../server/store.ts";
import { Harness } from "../server/harness.ts";
const root = fs.mkdtempSync(
  path.join(os.tmpdir(), "bewerbung-delete-sessions-"),
);
const store = new Store(root),
  harness = new Harness(store, () => {});
try {
  for (const provider of ["pi", "codex"] as const) {
    const removed = store.create({ company: "SYNTHETIC disposable A" }),
      retained = store.create({ company: "SYNTHETIC retained B" });
    for (const app of [removed, retained]) {
      const catalog = (await harness.models(app.id, provider)) as {
        models: unknown[];
      };
      assert.ok(catalog.models.length > 0);
      assert.equal(harness.busy(app.id), false);
    }
    const table = provider === "pi" ? "sessions" : "codex_sessions";
    const original = store.db
      .prepare(`SELECT native FROM ${table} WHERE app=?`)
      .get(retained.id)!.native;
    await harness.closeApp(removed.id);
    store.remove(removed.id, removed.revision);
    assert.throws(() => store.app(removed.id));
    const after = (await harness.models(retained.id, provider)) as {
      models: unknown[];
    };
    assert.ok(after.models.length > 0);
    assert.equal(
      store.db
        .prepare(`SELECT native FROM ${table} WHERE app=?`)
        .get(retained.id)!.native,
      original,
    );
    await harness.closeApp(retained.id);
    store.remove(retained.id, retained.revision);
    console.log(
      `PASS ${provider}: deletion closes only its own real native session; second session/auth/catalog remains usable; no model inference`,
    );
  }
} finally {
  await harness.close();
  store.close();
  fs.rmSync(root, { recursive: true, force: true });
}
