import fs from "node:fs";
import path from "node:path";
import { createApp } from "./app.ts";
import { dockerRunner } from "./builds.ts";
import { dockerPdfRunner } from "./pdf-runner.ts";
process.umask(0o077);
const port = Number(process.env.PORT || 3119);
const app = createApp(
  path.resolve(process.env.DATA_DIR || "data"),
  dockerRunner(fs.readFileSync("builder/image-id", "utf8").trim()),
  port,
  fs.existsSync("pdf-tools/image-id") ? dockerPdfRunner(fs.readFileSync("pdf-tools/image-id", "utf8").trim()) : undefined,
);
const server = app.web.listen(port, "127.0.0.1", () =>
  console.log(`Bewerbung: http://127.0.0.1:${port}/bewerbung/`),
);
let stopping = false;
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, async () => {
    if (stopping) return;
    stopping = true;
    server.close();
    await app.close();
    process.exit(0);
  });
