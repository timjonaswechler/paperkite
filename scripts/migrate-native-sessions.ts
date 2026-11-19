// Offline copy preparation only. Import is performed by the unchanged authenticated T3 UI.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { prepareNativeProviderHome } from "../server/t3-home.ts";
import { prepareNativeWorkspace } from "../server/t3-workspace.ts";
import { check, atomicFile } from "../server/files.ts";

check(
  process.argv.includes("--offline"),
  "Erst bewerbung.service stoppen; danach ausdrücklich --offline angeben.",
);
const data = path.resolve(process.env.DATA_DIR || "data"),
  home = path.join(data, "native-t3");
check(
  !fs.existsSync(path.join(home, "userdata/statev2.sqlite")),
  "Native Instanz wurde bereits gestartet; keine Offline-Erstmigration darüberlegen.",
  409,
);
check(
  !fs.existsSync(path.join(home, "migration.json")),
  "Sitzungskopien wurden bereits vorbereitet.",
  409,
);
prepareNativeProviderHome(home);
const settingsFile = path.join(home, "userdata/settings.json"),
  settings = JSON.parse(fs.readFileSync(settingsFile, "utf8"));
const db = new DatabaseSync(path.join(data, "bewerbung.sqlite"), {
  readOnly: true,
});
const apps = db.prepare("SELECT id,company,role FROM apps ORDER BY id").all();
db.close();
const staging = path.join(home, ".migration-" + randomUUID());
fs.mkdirSync(staging, { recursive: true, mode: 0o700 });
const originals = new Map<string, string>(),
  copies: { source: string; destination: string; kind: string }[] = [],
  profiles: { id: string; name: string; source: string; copy: string }[] = [];
const digest = (file: string) =>
  createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const excluded = new Set(["auth.json", "config.toml", "tmp", ".tmp", ".cache"]);
function copyTree(source: string, target: string, onlyJsonl = false) {
  const stat = fs.lstatSync(source);
  check(
    !stat.isSymbolicLink(),
    "Native Zustandskopie verfolgt keine Symlinks.",
    409,
  );
  if (stat.isDirectory()) {
    fs.mkdirSync(target, { recursive: true, mode: 0o700 });
    for (const name of fs.readdirSync(source)) {
      if (!onlyJsonl && excluded.has(name)) continue;
      copyTree(path.join(source, name), path.join(target, name), onlyJsonl);
    }
    return;
  }
  if (!stat.isFile() || (onlyJsonl && !source.endsWith(".jsonl"))) return;
  originals.set(source, digest(source));
  fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(target, 0o600);
  fs.utimesSync(target, stat.atime, stat.mtime);
}
function relocateCodex(homeCopy: string, source: string, destination: string) {
  const prefix = source + path.sep,
    replacement = destination + path.sep;
  for (const name of fs.readdirSync(homeCopy)) {
    if (!name.endsWith(".sqlite")) continue;
    const database = new DatabaseSync(path.join(homeCopy, name));
    try {
      for (const table of database
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all()) {
        const quoted = '"' + String(table.name).replaceAll('"', '""') + '"';
        if (
          !database
            .prepare("PRAGMA table_info(" + quoted + ")")
            .all()
            .some((column) => column.name === "rollout_path")
        )
          continue;
        database
          .prepare(
            "UPDATE " +
              quoted +
              " SET rollout_path=? || substr(rollout_path,?) WHERE substr(rollout_path,1,?)=?",
          )
          .run(replacement, prefix.length + 1, prefix.length, prefix);
      }
    } finally {
      database.close();
    }
  }
}
try {
  const pi = path.join(staging, "pi-sessions");
  fs.mkdirSync(pi);
  for (const app of apps) {
    const id = String(app.id);
    check(/^[a-f0-9-]{36}$/.test(id), "Ungültige Bewerbungs-ID");
    const piSource = path.join(data, "sessions", id);
    if (fs.existsSync(piSource)) copyTree(piSource, path.join(pi, id), true);
    const source = path.join(data, "codex", id);
    if (!fs.existsSync(source) || !fs.existsSync(path.join(source, "sessions")))
      continue;
    const profile = "codex-legacy-" + id,
      temporary = path.join(staging, profile),
      destination = path.join(home, "providers", profile);
    check(
      !fs.existsSync(destination),
      "Vorhandene native Sitzungskopie wird nicht ersetzt.",
      409,
    );
    copyTree(source, temporary);
    relocateCodex(temporary, source, destination);
    const auth = path.join(os.homedir(), ".codex/auth.json");
    if (fs.existsSync(auth))
      fs.symlinkSync(auth, path.join(temporary, "auth.json"));
    profiles.push({
      id: profile,
      name: "Codex · " + String(app.company) + " · Altverlauf",
      source,
      copy: destination,
    });
    copies.push({ source: temporary, destination, kind: "codex" });
  }
  for (const app of apps)
    prepareNativeWorkspace(
      path.join(data, "applications", String(app.id), "workspace"),
    );
  for (const [source, hash] of originals)
    check(
      digest(source) === hash,
      "Native Quelldatei wurde parallel verändert; Migration nicht freigegeben.",
      409,
    );
  const piDestination = path.join(home, "providers/pi/sessions");
  check(
    fs.readdirSync(piDestination).length === 0,
    "Neue Pi-Sitzungsablage ist nicht leer.",
    409,
  );
  fs.rmdirSync(piDestination);
  fs.renameSync(pi, piDestination);
  for (const copy of copies) fs.renameSync(copy.source, copy.destination);
  for (const profile of profiles)
    settings.providerInstances[profile.id] = {
      driver: "codex",
      enabled: true,
      displayName: profile.name,
      config: {
        enabled: true,
        setupMode: "existing",
        homePath: profile.copy,
        shadowHomePath: "",
      },
    };
  atomicFile(settingsFile, JSON.stringify(settings, null, 2));
  atomicFile(
    path.join(home, "migration.json"),
    JSON.stringify(
      {
        format: 1,
        prepared: new Date().toISOString(),
        applications: apps.map((app) => String(app.id)),
        nativeFiles: [...originals].map(([source, sha256]) => ({
          source,
          sha256,
        })),
        codexProfiles: profiles.map(({ id, source, copy }) => ({
          id,
          source,
          copy,
        })),
        importMethod: "original T3 welcome UI; select all and import",
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      prepared: true,
      applications: apps.length,
      nativeFiles: originals.size,
      codexProfiles: profiles.length,
      modelTurns: 0,
    }),
  );
} finally {
  fs.rmSync(staging, { recursive: true, force: true });
}
