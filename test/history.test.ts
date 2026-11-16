import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { request } from "node:http";
import { createApp } from "../server/app.ts";
import { loadHistory, mergeEvents } from "../src/history.ts";

test("history follows actual HTTP pages past 10,000 deltas and retains the final message", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bewerbung-history-"));
  const app = createApp(root, async () => "", 3119);
  const server = app.web.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const own = app.store.create({ company: "Synthetic history fixture" });
    const other = app.store.create({ company: "Other" });
    app.store.db.exec("BEGIN");
    app.store.event(own.id, "user", { text: "Anfang" });
    for (let n = 0; n < 9999; n++)
      app.store.event(own.id, "delta", { text: "x" });
    app.store.event(own.id, "assistant", {
      text: "Ende nach der Seitengrenze",
    });
    app.store.event(other.id, "assistant", { text: "Fremde Bewerbung" });
    app.store.db.exec("COMMIT");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const url = `http://127.0.0.1:${address.port}/bewerbung/api/applications/${own.id}/events`;
    const cursors: number[] = [];
    const events = await loadHistory<{
      id: number;
      type: string;
      payload: { text: string };
    }>(async (after) => {
      cursors.push(after);
      return new Promise((resolve, reject) => {
        const req = request(
          url + "?after=" + after,
          {
            headers: { Host: "127.0.0.1:3119" },
          },
          (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
            res.on("error", reject);
            res.on("end", () => {
              try {
                assert.equal(res.statusCode, 200);
                resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
              } catch (error) {
                reject(error);
              }
            });
          },
        );
        req.on("error", reject);
        req.end();
      });
    });
    assert.deepEqual(cursors, [0, 10000, 10001]);
    assert.deepEqual(
      events.map((e) => [e.id, e.type]),
      [
        [1, "user"],
        [10001, "assistant"],
      ],
    );
    assert.equal(events[1].payload.text, "Ende nach der Seitengrenze");
  } finally {
    server.close();
    await app.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("history reconciliation keeps concurrent live events once and in order", () => {
  const history = [
    { id: 1, type: "user" },
    { id: 3, type: "assistant" },
  ];
  const live = [
    { id: 3, type: "assistant" },
    { id: 2, type: "tool" },
    { id: 4, type: "user" },
    { id: 5, type: "delta" },
  ];
  assert.deepEqual(mergeEvents(history, live), [
    { id: 1, type: "user" },
    { id: 2, type: "tool" },
    { id: 3, type: "assistant" },
    { id: 4, type: "user" },
  ]);
});

test("history stops after navigation and rejects a stuck server cursor", async () => {
  let active = true,
    requests = 0;
  assert.deepEqual(
    await loadHistory(
      async () => {
        requests++;
        active = false;
        return [{ id: 1, type: "user" }];
      },
      () => active,
    ),
    [],
  );
  assert.equal(requests, 1);
  requests = 0;
  await assert.rejects(
    () =>
      loadHistory(async () => {
        requests++;
        return [{ id: 1, type: "user" }];
      }),
    /Cursor/,
  );
  assert.equal(requests, 2);
});
