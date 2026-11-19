import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { assertIndependentT3Home } from "./t3-runtime.ts";
import { check } from "./files.ts";

// Configure only stock provider storage. No model, tools, system prompt or mode overrides.
export function prepareNativeProviderHome(
  home: string,
  userHome = os.homedir(),
) {
  assertIndependentT3Home(home, userHome);
  const settings = path.join(home, "userdata", "settings.json");
  if (fs.existsSync(settings)) {
    check(
      !fs.lstatSync(settings).isSymbolicLink(),
      "Native Einstellungen dürfen kein Symlink sein",
      500,
    );
    return false;
  }
  const pi = path.join(home, "providers", "pi", "sessions"),
    codex = path.join(home, "providers", "codex");
  for (const directory of [path.dirname(settings), pi, codex])
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const auth = path.join(userHome, ".codex", "auth.json");
  if (
    fs.existsSync(auth) &&
    !fs.lstatSync(path.join(codex, "auth.json"), { throwIfNoEntry: false })
  )
    fs.symlinkSync(auth, path.join(codex, "auth.json"));
  fs.writeFileSync(
    settings,
    JSON.stringify(
      {
        providerInstances: {
          pi: {
            driver: "pi",
            enabled: true,
            environment: [
              {
                name: "PI_CODING_AGENT_SESSION_DIR",
                value: pi,
                sensitive: false,
              },
            ],
            config: { enabled: true },
          },
          codex: {
            driver: "codex",
            enabled: true,
            config: {
              enabled: true,
              setupMode: "existing",
              homePath: codex,
              shadowHomePath: "",
            },
          },
        },
      },
      null,
      2,
    ),
    { flag: "wx", mode: 0o600 },
  );
  return true;
}
