import fs from "node:fs";
import path from "node:path";
import express from "express";
import { startT3Application } from "../server/t3-main.ts";
import { check } from "../server/files.ts";
import { CvModImports } from "../server/cv-mod-prototype/imports.ts";
import {
  nativeModThreads,
  dockerModBuilder,
} from "../server/cv-mod-prototype/native.ts";
import { cvModPrototypeRoutes } from "../server/cv-mod-prototype/routes.ts";

const root = path.resolve(
  process.env.MOD_PROTOTYPE_DIR || ".work/cv-mod-import",
);
const allowed = path.resolve(".work") + path.sep;
check(
  root.startsWith(allowed),
  "MOD_PROTOTYPE_DIR muss unter .work/ liegen; Produktivdaten werden nicht verwendet",
);
fs.mkdirSync(root, { recursive: true, mode: 0o700 });
check(
  fs.realpathSync(root).startsWith(allowed),
  "Prototyp-Datenverzeichnis darf nicht nach außerhalb von .work/ verweisen",
);
check(
  !process.env.DATA_DIR && !process.env.T3CODE_HOME,
  "DATA_DIR/T3CODE_HOME nicht übernehmen; Prototyp nutzt eigene Ablagen",
);
const port = Number(process.env.MOD_PROTOTYPE_PORT || 3170);
process.env.DATA_DIR = path.join(root, "data");
process.env.PUBLIC_PORT = String(port);
process.env.T3_NATIVE_PORT = String(port + 1);
process.env.LEGACY_PORT = String(port + 2);
process.env.PUBLIC_ORIGIN = "http://127.0.0.1:" + port;
const router = express.Router();
const resources = await startT3Application({
  configureApi: (api) => api.use(router),
});
const jobs = new CvModImports(
  path.join(root, "mod-imports"),
  nativeModThreads({
    binary: path.join(resources.native.options.directory, "t3"),
    home: resources.native.options.home,
    environmentId: resources.native.environment().environmentId,
    publicOrigin: process.env.PUBLIC_ORIGIN,
  }),
  dockerModBuilder(
    fs.readFileSync("builder/image-id", "utf8").trim(),
    fs.readFileSync("pdf-tools/image-id", "utf8").trim(),
  ),
);
cvModPrototypeRoutes(router, jobs, resources.access);
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(signal, () => {
    void jobs.close();
  });
console.log(
  "CV-Mod-Prototyp: " +
    process.env.PUBLIC_ORIGIN +
    "/bewerbung/api/prototype/cv-mods",
);
console.log(
  "Eigene Ablage: " +
    root +
    ". Echte Modellrunde erst nach Klick auf „Hochladen & KI starten“. Native Provider-/Modell-/Berechtigungseinstellungen gelten.",
);
