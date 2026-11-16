import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { Store } from "../server/store.ts";
import { CodexHarness } from "../server/codex.ts";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "bewerbung-codex-sandbox-"));
const store = new Store(root),
  a = store.create({ company: "SYNTHETIC native sandbox probe" }),
  h = new CodexHarness(store, () => {});
try {
  const s = await h.open(a.id);
  const outside = path.join(root, "outside.txt");
  fs.writeFileSync(outside, "SYNTHETIC_OUTSIDE_842");
  // Trusted test code invokes command/exec, which the webapp never exposes. No model prompt.
  try {
    const result = (await h.runtime.runPromise(
      s.client.raw.request("command/exec", {
        command: ["/bin/sh", "-c", `printf EXECUTED_592; /bin/cat ${outside}`],
        cwd: s.cwd,
        permissionProfile: "bewerbung",
        timeoutMs: 5000,
      }),
    )) as { stdout: string; stderr: string; exitCode: number };
    assert.notEqual(result.exitCode, 0);
    assert.doesNotMatch(result.stdout, /EXECUTED_592|SYNTHETIC_OUTSIDE_842/);
    console.log("PASS native sandbox denied command", result);
  } catch (e) {
    if (e instanceof assert.AssertionError) throw e;
    const message = String(e);
    assert.match(message, /sandbox|[Pp]ermission|Operation not permitted/);
    console.log("PASS native command blocked:", message);
  }
} finally {
  await h.close();
  store.close();
  fs.rmSync(root, { recursive: true, force: true });
}
