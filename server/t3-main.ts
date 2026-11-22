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
import { createNetworkT3Access, type NetworkT3Access } from "./t3-access.ts";
import express, { type Router } from "express";
import {
  CvModImports,
  type ModThreadRunner,
  type ModBuilder,
} from "./cv-mod-prototype/imports.ts";
import {
  nativeModThreads,
  dockerModBuilder,
} from "./cv-mod-prototype/native.ts";
import { cvModRoutes } from "./cv-mod-prototype/routes.ts";

export async function startT3Application(
  options: {
    logNative?: (line: string) => void;
    configureApi?: (api: Router) => void;
    modThreads?: ModThreadRunner;
    modBuilder?: ModBuilder;
  } = {},
) {
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
    log: options.logNative ?? ((line) => process.stdout.write(line)),
  });
  prepareNativeProviderHome(native.options.home);
  await native.start();
  const modRouter = express.Router();
  let cvMods: CvModImports | undefined;
  let access: NetworkT3Access | undefined;
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
        configureApi: (api) => {
          api.use(modRouter);
          options.configureApi?.(api);
        },
      },
    );
    access = await createNetworkT3Access(native, origin);
    cvMods = new CvModImports(
      path.join(data, "cv-mod-imports"),
      options.modThreads ||
        nativeModThreads({
          binary: path.join(native.options.directory, "t3"),
          home: native.options.home,
          environmentId: native.environment().environmentId,
          publicOrigin: origin,
        }),
      options.modBuilder ||
        (fs.existsSync("pdf-tools/image-id")
          ? dockerModBuilder(
              fs.readFileSync("builder/image-id", "utf8").trim(),
              fs.readFileSync("pdf-tools/image-id", "utf8").trim(),
            )
          : async () => {
              throw new Error("PDF-Buildumgebung für Vorlagenprüfung fehlt");
            }),
    );
    cvModRoutes(modRouter, cvMods, access);
    const imports = cvMods;
    const cvStore = app.store;
    imports.isUsed = (id) =>
      Boolean(
        cvStore.db
          .prepare(
            "SELECT 1 FROM cv_documents WHERE mod_id=? OR mod_id LIKE ? OR mod_id LIKE ? LIMIT 1",
          )
          .get(id, id + ".%", "form:" + id + ".%") ||
        cvStore.db
          .prepare("SELECT 1 FROM cover_documents WHERE mod_id LIKE ? LIMIT 1")
          .get("cover:" + id + ".%"),
      );
    cvStore.cv.resolveMod = (id) => imports.reviewed(id);
    cvStore.cover.resolveMod = (id) => imports.reviewedCover(id);
    cvStore.cv.forms.resolveImported = (id) => imports.reviewedForm(id);
    server = createT3Gateway(app.web, native.origin, access);
    legacy = createLegacyRedirect(app.web, origin);
    server.listen(port, "127.0.0.1");
    await once(server, "listening");
    legacy.listen(legacyPort, "127.0.0.1");
    await once(legacy, "listening");
  } catch (error) {
    server?.close();
    legacy?.close();
    await cvMods?.close();
    await app?.close();
    await native.close();
    throw error;
  }
  check(access, "Native Netzwerk-Anmeldung fehlt", 503);
  console.log(`Bewerbungsverwaltung und originaler T3-Chat: ${origin}`);
  const resources = { app, server, legacy };
  let closing: Promise<void> | undefined;
  const close = () =>
    (closing ||= (async () => {
      resources.server.close();
      resources.legacy.close();
      await cvMods?.close();
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
  return { app, native, server, legacy, close, access, cvMods };
}
