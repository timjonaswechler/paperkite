import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { APPLICATION_STATUSES } from "../shared/api.ts";
import { Store } from "../server/store.ts";
import { NativeT3Projects } from "../server/t3-projects.ts";

// One active status must replace both former labels, without losing sources or
// changing unrelated rows. A second startup must not migrate/increment again.
test("draft status migrates to In Arbeit once; copies/new records use the same five statuses", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bewerbung-status-"));
  let store = new Store(root);
  try {
    const a = store.create({ company: "Synthetic draft", role: "Engineer" });
    const b = store.create({
      company: "Synthetic sent",
      role: "Designer",
      status: "Gesendet",
    });
    const sources = store.read(a.id, "anschreiben/Anschreiben.tex");
    store.db.prepare("UPDATE apps SET status='Entwurf' WHERE id=?").run(a.id);
    const oldSettings = store.preferences.settings();
    store.db.prepare("UPDATE preferences SET value=?").run(
      JSON.stringify({
        ...oldSettings,
        collapsedStatuses: ["Entwurf", "In Arbeit", "Fertig"],
      }),
    );
    store.close();
    store = new Store(root);
    assert.deepEqual(APPLICATION_STATUSES, [
      "In Arbeit",
      "Fertig",
      "Gesendet",
      "Absage",
      "Zusage",
    ]);
    assert.equal(store.app(a.id).status, "In Arbeit");
    assert.equal(store.app(a.id).revision, a.revision + 1);
    assert.equal(
      JSON.parse(store.read(a.id, "application.json").toString()).status,
      "In Arbeit",
    );
    assert.deepEqual(store.read(a.id, "anschreiben/Anschreiben.tex"), sources);
    assert.deepEqual(store.app(b.id), b);
    assert.deepEqual(store.preferences.settings().collapsedStatuses, [
      "In Arbeit",
      "Fertig",
    ]);
    const migrated = store.app(a.id);
    assert.equal(store.create({ source: a.id }).status, "In Arbeit");
    assert.equal(
      store.create({ company: "New", role: "Other" }).status,
      "In Arbeit",
    );
    store.close();
    store = new Store(root);
    assert.deepEqual(store.app(a.id), migrated);
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// Navigation must associate by actual workspace, not project title, load older
// settled chats too, and never create a native project merely by reading a list.
test("application navigation groups multiple native chats by workspace and excludes deleted, subagent and foreign records", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bewerbung-navigation-"));
  const store = new Store(root);
  const a = store.create({ company: "Company A", role: "Engineer" });
  const b = store.create({ company: "Company B", role: "Designer" });
  const requests: string[] = [];
  const peer = http.createServer((req, res) => {
    requests.push(req.url!);
    assert.equal(req.method, "GET");
    assert.equal(req.headers.cookie, "fixture=caller");
    assert.equal(req.headers["x-t3-orchestration-protocol"], "2");
    const thread = (id: string, projectId: string, extra = {}) => ({
      id,
      projectId,
      title: id,
      status: "idle",
      updatedAt: "2026-01-01T00:00:00Z",
      deletedAt: null,
      lineage: { relationshipToParent: null },
      ...extra,
    });
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        projects: [
          {
            id: "a-main",
            title: "Identical title",
            workspaceRoot: store.workspace(a.id),
          },
          {
            id: "a-old",
            title: "Renamed",
            workspaceRoot: store.workspace(a.id),
            deletedAt: null,
            archivedAt: "2025-01-01",
          },
          {
            id: "foreign",
            title: "Identical title",
            workspaceRoot: path.join(root, "unrelated"),
            deletedAt: null,
          },
          {
            id: "gone",
            title: "Gone",
            workspaceRoot: store.workspace(a.id),
            deletedAt: "2026-01-01",
          },
        ],
        threads: [
          thread("new", "a-main", { updatedAt: "2026-02-01T00:00:00Z" }),
          thread("older-settled", "a-old", { settledOverride: "settled" }),
          thread("foreign-chat", "foreign"),
          thread("gone-project", "gone"),
          thread("deleted", "a-main", { deletedAt: "2026-01-01" }),
          thread("child", "a-main", {
            lineage: { relationshipToParent: "subagent" },
          }),
          thread("side", "a-main", {
            lineage: { relationshipToParent: null, sideChat: true },
          }),
        ],
      }),
    );
  });
  peer.listen(0, "127.0.0.1");
  await once(peer, "listening");
  try {
    const bridge = new NativeT3Projects(store, {
      origin: `http://127.0.0.1:${(peer.address() as AddressInfo).port}`,
      environment: () => ({ environmentId: "synthetic-native" }),
      options: {
        directory: root,
        home: root,
        cwd: root,
        sha256: "a".repeat(64),
        port: 3171,
      },
    });
    const result = await bridge.navigation({
      headers: { cookie: "fixture=caller" },
    });
    assert.equal(result.environmentId, "synthetic-native");
    assert.deepEqual(
      result.applications.find((app) => app.id === a.id),
      {
        id: a.id,
        projectId: "a-main",
        chats: [
          {
            id: "new",
            title: "new",
            status: "idle",
            updatedAt: "2026-02-01T00:00:00Z",
          },
          {
            id: "older-settled",
            title: "older-settled",
            status: "idle",
            updatedAt: "2026-01-01T00:00:00Z",
          },
        ],
      },
    );
    assert.deepEqual(
      result.applications.find((app) => app.id === b.id),
      { id: b.id, projectId: null, chats: [] },
    );
    assert.deepEqual(requests, ["/api/orchestration/shell"]);
    assert.equal(store.app(a.id).revision, a.revision);
  } finally {
    peer.closeAllConnections();
    await new Promise<void>((resolve) => peer.close(() => resolve()));
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
