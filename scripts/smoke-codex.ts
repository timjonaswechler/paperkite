import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { Store } from "../server/store.ts";
import { Harness } from "../server/harness.ts";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "bewerbung-codex-smoke-"));
const store = new Store(root),
  app = store.create({ company: "SYNTHETIC Codex test only" });
type Event = { type: string; payload: Record<string, unknown> };
let listeners: ((e: Event) => void)[] = [];
const changed = (_app: string, e: unknown) => {
  const event = e as Event;
  if (["assistant", "error", "notice", "tool"].includes(event.type))
    console.log(event.type, event.payload);
  for (const l of [...listeners]) l(event);
};
let harness = new Harness(store, changed);
function waitFor(type: string) {
  return new Promise<Event>((resolve, reject) => {
    const timer = setTimeout(() => {
      listeners = listeners.filter((x) => x !== listener);
      reject(new Error("Timeout " + type));
    }, 90000);
    const listener = (e: Event) => {
      if (e.type === type) {
        clearTimeout(timer);
        listeners = listeners.filter((x) => x !== listener);
        resolve(e);
      }
    };
    listeners.push(listener);
  });
}
async function turn(text: string) {
  const done = waitFor("settled");
  await harness.prompt(app.id, text, undefined, "codex");
  await done;
  const events = store.events(app.id);
  const error = events.findLast((e) => e.type === "error");
  assert.equal(error, undefined, JSON.stringify(error));
  return String(events.findLast((e) => e.type === "assistant")?.payload.text);
}
try {
  const models = await harness.models(app.id, "codex");
  console.log("Authenticated catalog", models);
  assert.match(
    await turn(
      "Synthetic test. Remember token VIOLET-637. Reply only VIOLET-637, no tools.",
    ),
    /VIOLET-637/,
  );
  assert.ok(store.events(app.id).some((e) => e.type === "delta"));
  console.log("PASS streaming and completion");
  const native = store.db
    .prepare("SELECT native FROM codex_sessions WHERE app=?")
    .get(app.id)!.native;
  const copy = store.create({ source: app.id });
  assert.equal(
    store.db.prepare("SELECT * FROM codex_sessions WHERE app=?").get(copy.id),
    undefined,
  );
  await harness.close();
  harness = new Harness(store, changed);
  assert.match(
    await turn(
      "What exact token did I ask you to remember? Reply only that token, no tools.",
    ),
    /VIOLET-637/,
  );
  assert.equal(
    store.db
      .prepare("SELECT native FROM codex_sessions WHERE app=?")
      .get(app.id)!.native,
    native,
  );
  console.log("PASS process resume and copy identity isolation");
  for (const allow of [false, true]) {
    const approval = waitFor("approval"),
      done = waitFor("settled");
    const file = allow ? "cv/profiles/allowed.lua" : "cv/profiles/denied.lua";
    await harness.prompt(
      app.id,
      `This is a NEW independent user request, not a retry: Use bewerbung_write exactly once to write ${file} with exactly return {}. Synthetic approval test. If denied stop, never retry within this turn.`,
      undefined,
      "codex",
    );
    const p = await approval;
    assert.ok(!fs.existsSync(path.join(store.workspace(app.id), file)));
    await harness.approve(app.id, String(p.payload.id), allow);
    await done;
    assert.equal(
      fs.existsSync(path.join(store.workspace(app.id), file)),
      allow,
    );
    if (allow) assert.equal(store.read(app.id, file).toString(), "return {}");
    console.log("PASS live approval", allow);
  }
  const delta = waitFor("delta"),
    done = waitFor("settled");
  await harness.prompt(
    app.id,
    "Write 1000 numbered lines with imaginary color names. No tools.",
    undefined,
    "codex",
  );
  await delta;
  await harness.interrupt(app.id);
  assert.equal((await done).payload.aborted, true);
  assert.equal(harness.status(app.id).busy, false);
  console.log("PASS interrupt");
} finally {
  await harness.close();
  store.close();
  fs.rmSync(root, { recursive: true, force: true });
}
