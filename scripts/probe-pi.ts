import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../server/store.ts";
import { Harness } from "../server/harness.ts";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "bewerbung-pi-probe-"));
const s = new Store(root),
  a = s.create({ company: "Synthetic probe" });
const h = new Harness(s, () => {});
try {
  const result = (await h.models(a.id)) as {
    models: { provider: string; id: string }[];
  };
  console.log(
    JSON.stringify(
      {
        count: result.models.length,
        models: result.models
          .filter((m) => m.id.includes("mini") || m.id.includes("codex"))
          .map((m) => ({ provider: m.provider, id: m.id })),
        status: h.status(a.id),
      },
      null,
      2,
    ),
  );
} finally {
  await h.close();
  s.close();
  fs.rmSync(root, { recursive: true, force: true });
}
