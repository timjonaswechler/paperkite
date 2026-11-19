import fs from "node:fs";
import path from "node:path";
import { once } from "node:events";
import { createApp } from "./app.ts";
import { dockerRunner } from "./builds.ts";
import { dockerPdfRunner } from "./pdf-runner.ts";
import { NativeT3Runtime } from "./t3-runtime.ts";
import { NativeT3Projects } from "./t3-projects.ts";
import { createLegacyRedirect, createT3Gateway } from "./t3-gateway.ts";
import { check } from "./files.ts";
import { prepareNativeProviderHome } from "./t3-home.ts";
import { createNetworkT3Access } from "./t3-access.ts";

export async function startT3Application() {
  process.umask(0o077);
  const config = JSON.parse(
    fs.readFileSync("native-t3/config.json", "utf8"),
  ) as { version: string; directory: string; sha256: string };
  check(config.version === "0.1.10", "Ungeprüfte T3-Laufzeitversion", 500);
  const data = path.resolve(process.env.DATA_DIR || "data");
  const port = Number(process.env.PUBLIC_PORT || 3120),
    legacyPort = Number(process.env.LEGACY_PORT || 3119);
  const origin = process.env.PUBLIC_ORIGIN || "https://bewerbung.teejayslab.de";
  const native = new NativeT3Runtime({
    directory: path.resolve(config.directory),
    sha256: config.sha256,
    home: path.join(data, "native-t3"),
    cwd: path.join(data, "applications"),
    port: Number(process.env.T3_NATIVE_PORT || 3121),
    log: (line) => process.stdout.write(line),
  });
  prepareNativeProviderHome(native.options.home);
  await native.start();
  let app: ReturnType<typeof createApp> | undefined;
  let server: ReturnType<typeof createT3Gateway> | undefined;
  let legacy: ReturnType<typeof createLegacyRedirect> | undefined;
  try {
    app = createApp(
      data,
      dockerRunner(fs.readFileSync("builder/image-id", "utf8").trim()),
      port,
      fs.existsSync("pdf-tools/image-id")
        ? dockerPdfRunner(fs.readFileSync("pdf-tools/image-id", "utf8").trim())
        : undefined,
      {
        extraHosts: [
          new URL(origin).host,
          `127.0.0.1:${legacyPort}`,
          `localhost:${legacyPort}`,
        ],
        nativeChat: (store) => new NativeT3Projects(store, native),
      },
    );
    const access = await createNetworkT3Access(native, origin);
    server = createT3Gateway(app.web, native.origin, access);
    legacy = createLegacyRedirect(app.web, origin);
    server.listen(port, "127.0.0.1");
    await once(server, "listening");
    legacy.listen(legacyPort, "127.0.0.1");
    await once(legacy, "listening");
  } catch (error) {
    server?.close();
    legacy?.close();
    await app?.close();
    await native.close();
    throw error;
  }
  console.log(`Bewerbungsverwaltung und originaler T3-Chat: ${origin}`);
  const resources = { app, server, legacy };
  let closing: Promise<void> | undefined;
  const close = () =>
    (closing ||= (async () => {
      resources.server.close();
      resources.legacy.close();
      await native.close();
      await resources.app.close();
    })());
  for (const signal of ["SIGTERM", "SIGINT"])
    process.on(signal, () => {
      void close().then(
        () => process.exit(0),
        () => process.exit(1),
      );
    });
  void native.waitForExit().then(() => {
    if (!closing) void close().finally(() => process.exit(1));
  });
  return { app, native, server, legacy, close };
}
