import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";
import express from "express";
import { NativeT3Runtime } from "../server/t3-runtime.ts";
import {
  NativeT3Projects,
  waitForNativeProjectCleanup,
} from "../server/t3-projects.ts";
import { createT3Gateway, legacyLocation } from "../server/t3-gateway.ts";
import { Store } from "../server/store.ts";
import { createApp } from "../server/app.ts";
import { HttpError } from "../server/files.ts";
const temporary = () =>
  fs.mkdtempSync(path.join(os.tmpdir(), "bewerbung-native-t3-"));
async function listen(server: http.Server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
async function close(server: http.Server) {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

// The isolated T3 instance must never acquire the real installed T3 home, even through a parent link.
test("native runtime rejects installed state paths and symlink aliases before spawning", () => {
  const root = temporary(),
    oldHome = process.env.HOME;
  process.env.HOME = root;
  try {
    fs.mkdirSync(path.join(root, ".t3", "userdata"), { recursive: true });
    fs.symlinkSync(path.join(root, ".t3"), path.join(root, "alias"));
    const options = {
      directory: root,
      sha256: "a".repeat(64),
      cwd: root,
      port: 3171,
      home: path.join(root, ".t3"),
    };
    for (const home of [
      path.join(root, ".t3"),
      path.join(root, ".t3", "userdata"),
      path.join(root, "alias", "new-home"),
    ])
      assert.throws(
        () => new NativeT3Runtime({ ...options, home }),
        /Installierter T3/,
      );
    assert.doesNotThrow(
      () =>
        new NativeT3Runtime({
          ...options,
          home: path.join(root, "independent"),
        }),
    );
    assert.equal(
      fs.existsSync(path.join(root, ".t3", "userdata", "statev2.sqlite")),
      false,
    );
  } finally {
    if (oldHome === undefined) delete process.env.HOME;
    else process.env.HOME = oldHome;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// This fixture is only the HTTP seam: real native permissions/import are checked against stock T3 separately.
test("project bridge forwards the caller's native auth, reuses actual project IDs and never substitutes owner access", async () => {
  const root = temporary(),
    store = new Store(root),
    a = store.create({ company: "Synthetic A" }),
    b = store.create({ company: "Synthetic B" });
  const projects: {
    id: string;
    title: string;
    workspaceRoot: string;
    deletedAt: null;
  }[] = [];
  const mutations: Record<string, unknown>[] = [];
  const seen: http.IncomingHttpHeaders[] = [];
  const peer = http.createServer(async (req, res) => {
    seen.push(req.headers);
    res.setHeader("Content-Type", "application/json");
    if (!req.headers.cookie) {
      res.writeHead(401);
      return res.end(
        JSON.stringify({ message: "Native authentication required" }),
      );
    }
    if (req.url === "/api/auth/session")
      return res.end(
        JSON.stringify({
          authenticated: true,
          permissions:
            req.headers.cookie === "fixture=readonly"
              ? ["filesystem:read"]
              : ["filesystem:read", "filesystem:write"],
        }),
      );
    if (req.url === "/api/projects")
      return res.end(
        JSON.stringify({ projects, updatedAt: "2026-01-01T00:00:00Z" }),
      );
    assert.equal(req.url, "/api/projects/mutate");
    if (req.headers.cookie === "fixture=readonly") {
      res.writeHead(403);
      return res.end(
        JSON.stringify({ message: "Native project write scope required" }),
      );
    }
    let text = "";
    for await (const part of req) text += part;
    const body = JSON.parse(text);
    mutations.push(body);
    if (body.type === "project.create") {
      const project = {
        id: body.projectId,
        title: body.title,
        workspaceRoot: body.workspaceRoot,
        deletedAt: null,
      };
      projects.push(project);
      return res.end(JSON.stringify(project));
    }
    res.end(JSON.stringify({}));
  });
  const origin = await listen(peer);
  try {
    const native = {
      origin,
      options: {
        directory: root,
        sha256: "a".repeat(64),
        home: root,
        cwd: root,
        port: 3171,
      },
      environment: () => ({ environmentId: "synthetic-native-environment" }),
    };
    const bridge = new NativeT3Projects(store, native);
    await assert.rejects(
      bridge.ensure(a.id, { headers: {} }),
      (error: unknown) => error instanceof HttpError && error.status === 401,
    );
    const context = {
      headers: {
        cookie: "fixture=writer",
        authorization: "Bearer synthetic-caller",
        host: "bewerbung.teejayslab.de",
        origin: "https://bewerbung.teejayslab.de",
        "x-forwarded-proto": "https",
      },
    };
    const first = await bridge.ensure(a.id, context),
      again = await bridge.ensure(a.id, context);
    assert.deepEqual(again, first);
    assert.equal(first.environmentId, "synthetic-native-environment");
    assert.equal(first.projectId, projects[0]!.id);
    assert.equal(mutations.length, 1);
    assert.equal(
      mutations[0]!.workspaceRoot,
      path.join(root, "applications", a.id, "workspace"),
    );
    assert.equal(mutations[0]!.type, "project.create");
    assert.equal("runtimeMode" in mutations[0]!, false);
    assert.equal("defaultModelSelection" in mutations[0]!, false);
    for (const headers of seen.slice(1)) {
      assert.equal(headers.cookie, "fixture=writer");
      assert.equal(headers.authorization, "Bearer synthetic-caller");
      assert.equal(headers.host, "bewerbung.teejayslab.de");
      assert.equal(headers.origin, "https://bewerbung.teejayslab.de");
    }
    await assert.rejects(
      bridge.authorize({ headers: {} }, "read"),
      (error: unknown) => error instanceof HttpError && error.status === 401,
    );
    await bridge.authorize(context, "write");
    await bridge.authorize({ headers: { cookie: "fixture=readonly" } }, "read");
    await assert.rejects(
      bridge.authorize({ headers: { cookie: "fixture=readonly" } }, "write"),
      (error: unknown) => error instanceof HttpError && error.status === 403,
    );
    await assert.rejects(
      bridge.ensure(b.id, { headers: { cookie: "fixture=readonly" } }),
      (error: unknown) => error instanceof HttpError && error.status === 403,
    );
    await assert.rejects(
      bridge.remove(a.id, { headers: { cookie: "fixture=readonly" } }),
      (error: unknown) => error instanceof HttpError && error.status === 403,
    );
    assert.equal(
      store.db.prepare("SELECT count(*) n FROM native_project_deletions").get()!
        .n,
      0,
    );
    assert.equal(store.app(a.id).company, "Synthetic A");
    assert.equal(mutations.length, 1);
  } finally {
    await close(peer);
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("business file cleanup waits for native outbox completion and ignores another project's pending work", async () => {
  const home = temporary(),
    directory = path.join(home, "userdata");
  fs.mkdirSync(directory);
  const writer = new DatabaseSync(path.join(directory, "statev2.sqlite"));
  writer.exec(
    "PRAGMA journal_mode=WAL; CREATE TABLE orchestration_v2_projection_threads(thread_id TEXT,payload_json TEXT);CREATE TABLE orchestration_v2_effect_outbox(thread_id TEXT,status TEXT,effect_type TEXT)",
  );
  try {
    writer
      .prepare("INSERT INTO orchestration_v2_projection_threads VALUES(?,?)")
      .run("thread-a", JSON.stringify({ projectId: "project-a" }));
    writer
      .prepare("INSERT INTO orchestration_v2_projection_threads VALUES(?,?)")
      .run("thread-b", JSON.stringify({ projectId: "project-b" }));
    writer.exec(
      "INSERT INTO orchestration_v2_effect_outbox VALUES('thread-b','running','provider-session.detach')",
    );
    await waitForNativeProjectCleanup(home, ["project-a"]);
    writer.exec(
      "INSERT INTO orchestration_v2_effect_outbox VALUES('thread-a','running','provider-session.detach')",
    );
    const waiting = waitForNativeProjectCleanup(home, ["project-a"]);
    writer.exec(
      "UPDATE orchestration_v2_effect_outbox SET status='succeeded' WHERE thread_id='thread-a'",
    );
    await waiting;
    assert.equal(
      writer
        .prepare(
          "SELECT status FROM orchestration_v2_effect_outbox WHERE thread_id='thread-b'",
        )
        .get()!.status,
      "running",
    );
    writer.exec(
      "UPDATE orchestration_v2_effect_outbox SET status='failed' WHERE thread_id='thread-a'",
    );
    await assert.rejects(
      waitForNativeProjectCleanup(home, ["project-a"]),
      /Arbeitsprozesse/,
    );
  } finally {
    writer.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("gateway preserves native HTTP bytes/cookies and streams before response completion; business API remains separate", async () => {
  const bytes = Buffer.from([0, 1, 2, 250, 255]);
  let received = Buffer.alloc(0);
  const peer = http.createServer(async (req, res) => {
    if (req.url === "/stream") {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write("data: first\n\n");
      return;
    }
    for await (const part of req) received = Buffer.concat([received, part]);
    res.writeHead(201, {
      "Content-Type": "application/octet-stream",
      "Set-Cookie": [
        "native_a=1; Path=/; HttpOnly",
        "native_b=2; Path=/; SameSite=Lax",
      ],
    });
    res.end(received);
  });
  const origin = await listen(peer),
    business = express();
  business.get("/bewerbung/api/health", (_req, res) =>
    res.json({ business: true }),
  );
  const gateway = createT3Gateway(business, origin),
    address = await listen(gateway);
  try {
    const result = await fetch(address + "/api/native-echo", {
      method: "POST",
      body: bytes,
    });
    assert.equal(result.status, 201);
    assert.deepEqual(Buffer.from(await result.arrayBuffer()), bytes);
    assert.equal(result.headers.getSetCookie().length, 2);
    assert.deepEqual(
      await (await fetch(address + "/bewerbung/api/health")).json(),
      { business: true },
    );
    const abort = new AbortController();
    const response = await fetch(address + "/stream", { signal: abort.signal }),
      reader = response.body!.getReader();
    const chunk = await reader.read();
    assert.equal(Buffer.from(chunk.value!).toString(), "data: first\n\n");
    abort.abort();
    assert.equal(
      legacyLocation(
        "/bewerbung/applications/11111111-1111-4111-8111-111111111111?panel=documents",
        "https://bewerbung.teejayslab.de",
      ),
      "https://bewerbung.teejayslab.de/bewerbungen/11111111-1111-4111-8111-111111111111?panel=documents",
    );
    assert.equal(
      legacyLocation("//evil.invalid/", "https://bewerbung.teejayslab.de"),
      "https://bewerbung.teejayslab.de/bewerbungen",
    );
  } finally {
    await close(gateway);
    await close(peer);
  }
});

test("native app mode retires old chat mutations and keeps business deletion revision/permission boundaries", async () => {
  const root = temporary();
  let nativeBusy = false,
    removed = 0,
    ensured = 0,
    caller = "writer";
  const app = createApp(root, async () => "", 3165, undefined, {
    nativeChat: () => ({
      navigation: async () => ({ environmentId: "native", applications: [] }),
      authorize: async (context, intent) => {
        if (!context.headers.cookie)
          throw new HttpError(401, "Native authentication required");
        if (intent === "write" && context.headers.cookie === "fixture=readonly")
          throw new HttpError(403, "Native filesystem write scope required");
      },
      busy: () => nativeBusy,
      ensure: async () => {
        ensured++;
        return { environmentId: "native", projectId: "project" };
      },
      remove: async () => {
        removed++;
        throw new HttpError(403, "Native permission refused");
      },
    }),
  });
  const server = app.web.listen(3165, "127.0.0.1");
  await once(server, "listening");
  const item = app.store.create({ company: "Synthetic A", role: "Engineer" });
  const api = (route: string, method = "GET", body?: unknown) =>
    fetch("http://127.0.0.1:3165/bewerbung/api" + route, {
      method,
      headers: {
        ...(caller ? { Cookie: "fixture=" + caller } : {}),
        ...(method === "GET"
          ? {}
          : { "Content-Type": "application/json", "X-Bewerbung-Request": "1" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  try {
    assert.equal((await (await api("/health")).json()).nativeChat, true);
    caller = "";
    assert.equal((await api("/applications")).status, 401);
    assert.equal(
      (
        await api(`/applications/${item.id}`, "PATCH", {
          revision: item.revision,
          notes: "blocked",
        })
      ).status,
      401,
    );
    caller = "readonly";
    assert.equal((await api("/applications")).status, 200);
    assert.equal(
      (
        await api(`/applications/${item.id}`, "PATCH", {
          revision: item.revision,
          notes: "blocked",
        })
      ).status,
      403,
    );
    assert.notEqual(app.store.app(item.id).notes, "blocked");
    caller = "writer";
    let nativeCalls = 0;
    app.harness.models = async () => {
      nativeCalls++;
      throw new Error("Retired path must not run");
    };
    app.harness.prompt = async () => {
      nativeCalls++;
      throw new Error("Retired path must not run");
    };
    for (const route of ["models", "prompt", "interrupt", "approvals/fake"])
      assert.equal(
        (await api(`/applications/${item.id}/${route}`, "POST", {})).status,
        410,
      );
    assert.equal(nativeCalls, 0);
    assert.equal(
      (await api(`/applications/${item.id}/t3-project`, "POST", {})).status,
      200,
    );
    assert.equal(ensured, 1);
    assert.equal(
      (await api(`/applications/${item.id}`, "DELETE", { revision: 0 })).status,
      409,
    );
    assert.equal(removed, 0);
    nativeBusy = true;
    assert.equal(
      (await (await api(`/applications/${item.id}`)).json()).harness.busy,
      true,
    );
    assert.equal(
      (
        await api(`/applications/${item.id}`, "PATCH", {
          revision: item.revision,
          notes: "blocked",
        })
      ).status,
      409,
    );
    nativeBusy = false;
    assert.equal(
      (
        await api(`/applications/${item.id}`, "DELETE", {
          revision: item.revision,
        })
      ).status,
      403,
    );
    assert.equal(removed, 1);
    assert.equal(app.store.app(item.id).company, "Synthetic A");
  } finally {
    await close(server);
    await app.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
