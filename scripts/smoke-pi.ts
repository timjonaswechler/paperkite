import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { Store } from "../server/store.ts";
import { Harness } from "../server/harness.ts";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "bewerbung-pi-smoke-"));
const store = new Store(root),
  app = store.create({ company: "Synthetic test only" });
let listeners: ((e: {
  type: string;
  payload: Record<string, unknown>;
}) => void)[] = [];
let harness = new Harness(store, (_app, e) => {
  for (const l of [...listeners]) l(e as never);
});
function waitFor(type: string) {
  return new Promise<{ type: string; payload: Record<string, unknown> }>(
    (resolve, reject) => {
      const timer = setTimeout(() => {
        listeners = listeners.filter((x) => x !== listener);
        reject(new Error("Timeout waiting for " + type));
      }, 90000);
      const listener = (e: {
        type: string;
        payload: Record<string, unknown>;
      }) => {
        if (e.type === type) {
          clearTimeout(timer);
          listeners = listeners.filter((x) => x !== listener);
          resolve(e);
        }
      };
      listeners.push(listener);
    },
  );
}
async function turn(text: string, model?: unknown) {
  const settled = waitFor("settled");
  await harness.prompt(app.id, text, model);
  await settled;
  const messages = store.events(app.id).filter((e) => e.type === "assistant");
  const last = messages.at(-1)!.payload as { text: string; error?: string };
  assert.ok(!last.error, last.error);
  return last.text;
}
try {
  const { models } = (await harness.models(app.id)) as {
    models: { provider: string; id: string }[];
  };
  const configured = harness.status(app.id).model;
  const chosen = models.find((m) => m.provider + "/" + m.id === configured);
  assert.ok(chosen, "Configured model not reported");
  console.log("Model:", chosen.provider + "/" + chosen.id);
  const response = await turn(
    "Synthetic integration test. Remember token ORANGE-482. Reply only ORANGE-482. Do not use tools.",
    chosen,
  );
  assert.match(response, /ORANGE-482/);
  assert.ok(store.events(app.id).some((e) => e.type === "delta"));
  console.log("PASS real streaming and settled");
  const native = store.db
    .prepare("SELECT native FROM sessions WHERE app=?")
    .get(app.id)!.native;
  await harness.close();
  harness = new Harness(store, (_app, e) => {
    for (const l of [...listeners]) l(e as never);
  });
  const resumed = await turn(
    "What exact token did I ask you to remember? Reply only that token, without tools.",
  );
  assert.match(resumed, /ORANGE-482/);
  assert.equal(
    store.db.prepare("SELECT native FROM sessions WHERE app=?").get(app.id)!
      .native,
    native,
  );
  console.log("PASS native persisted session resume");
  const approval = waitFor("approval"),
    settled = waitFor("settled");
  await harness.prompt(
    app.id,
    "Use write exactly once to create cv/profiles/synthetic.lua containing exactly return {}. This is a synthetic permission test. If denied, stop and do not retry.",
  );
  const pending = await approval;
  assert.ok(
    !fs.existsSync(
      path.join(store.workspace(app.id), "cv/profiles/synthetic.lua"),
    ),
  );
  await harness.approve(app.id, String(pending.payload.id), false);
  await settled;
  assert.ok(
    !fs.existsSync(
      path.join(store.workspace(app.id), "cv/profiles/synthetic.lua"),
    ),
  );
  console.log("PASS live denial leaves file absent");
  const approve = waitFor("approval"),
    done = waitFor("settled");
  await harness.prompt(
    app.id,
    "Now try once again: use write to create cv/profiles/synthetic.lua containing exactly return {}.",
  );
  const p = await approve;
  await harness.approve(app.id, String(p.payload.id), true);
  await done;
  assert.equal(
    fs.readFileSync(
      path.join(store.workspace(app.id), "cv/profiles/synthetic.lua"),
      "utf8",
    ),
    "return {}",
  );
  console.log("PASS live one-shot approval writes only scoped file");
  const editApproval = waitFor("approval"),
    edited = waitFor("settled");
  await harness.prompt(
    app.id,
    'Use edit exactly once on cv/profiles/synthetic.lua: replace the exact text return {} with return { marker = "edited" }. Use edit, not write.',
  );
  const editRequest = await editApproval;
  assert.match(String(editRequest.payload.title), /edit /);
  await harness.approve(app.id, String(editRequest.payload.id), true);
  await edited;
  assert.equal(
    store.read(app.id, "cv/profiles/synthetic.lua").toString(),
    'return { marker = "edited" }',
  );
  console.log(
    "PASS native edit with quota-checked operations and one-shot approval",
  );
  const delta = waitFor("delta"),
    interrupted = waitFor("settled");
  await harness.prompt(
    app.id,
    "Write 1000 numbered lines, each with a different short imaginary color name. Do not use tools.",
  );
  await delta;
  await harness.interrupt(app.id);
  const end = await interrupted;
  assert.equal(end.payload.aborted, true);
  assert.equal(harness.status(app.id).busy, false);
  console.log("PASS interruption and idle");
} finally {
  await harness.close();
  store.close();
  fs.rmSync(root, { recursive: true, force: true });
}
