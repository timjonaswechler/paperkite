import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { check } from "./files.ts";

export type NativeT3Descriptor = {
  environmentId: string;
  [key: string]: unknown;
};
export type NativeT3Options = {
  directory: string;
  sha256: string;
  home: string;
  cwd: string;
  port: number;
  log?: (line: string) => void;
  environment?: NodeJS.ProcessEnv;
};

export function assertIndependentT3Home(
  directory: string,
  userHome = process.env.HOME || ".",
) {
  const home = path.resolve(directory);
  let ancestor = home;
  const missing: string[] = [];
  while (!fs.existsSync(ancestor)) {
    missing.unshift(path.basename(ancestor));
    ancestor = path.dirname(ancestor);
  }
  const physicalHome = path.join(fs.realpathSync(ancestor), ...missing);
  const installed = path.resolve(userHome, ".t3");
  const installedHome = fs.existsSync(installed)
    ? fs.realpathSync(installed)
    : installed;
  check(
    physicalHome !== installedHome &&
      !physicalHome.startsWith(installedHome + path.sep),
    "Installierter T3-Bestand darf nicht verwendet werden",
    500,
  );
  for (const directory of [home, path.join(home, "userdata")])
    check(
      !fs.lstatSync(directory, { throwIfNoEntry: false })?.isSymbolicLink(),
      "T3-Datenverzeichnis darf kein Symlink sein",
      500,
    );
  const userdata = path.join(home, "userdata");
  if (fs.existsSync(userdata))
    for (const name of fs.readdirSync(userdata)) {
      if (!/\.sqlite(?:-wal|-shm)?$/.test(name) && name !== "settings.json")
        continue;
      const stat = fs.lstatSync(path.join(userdata, name));
      check(
        !stat.isSymbolicLink() && stat.nlink === 1,
        "Native T3-Zustandsdateien dürfen nicht verknüpft sein",
        500,
      );
    }
}

// Owns only the pinned app-local T3 process; chat and provider policy stay in the native engine.
export class NativeT3Runtime {
  private child?: ChildProcess;
  private stopped?: Promise<unknown>;
  private descriptor?: NativeT3Descriptor;
  readonly origin: string;
  constructor(readonly options: NativeT3Options) {
    this.origin = `http://127.0.0.1:${options.port}`;
    check(
      Number.isSafeInteger(options.port) &&
        options.port > 1024 &&
        options.port < 65536,
      "Ungültiger T3-Port",
      500,
    );
    check(
      /^[a-f0-9]{64}$/.test(options.sha256),
      "Gepinnter T3-Hash fehlt",
      500,
    );
    assertIndependentT3Home(options.home);
  }
  async start() {
    check(!this.child, "T3 bereits gestartet", 500);
    const executable = path.join(path.resolve(this.options.directory), "t3");
    const stat = fs.lstatSync(executable);
    check(stat.isFile() && !stat.isSymbolicLink(), "T3-Programm fehlt", 500);
    const sha = createHash("sha256")
      .update(fs.readFileSync(executable))
      .digest("hex");
    check(
      sha === this.options.sha256,
      "T3-Programm weicht vom geprüften Original ab",
      500,
    );
    fs.mkdirSync(this.options.home, { recursive: true, mode: 0o700 });
    fs.mkdirSync(this.options.cwd, { recursive: true, mode: 0o700 });
    const child = spawn(
      executable,
      [
        "serve",
        "--host",
        "127.0.0.1",
        "--port",
        String(this.options.port),
        "--base-dir",
        path.resolve(this.options.home),
        "--no-browser",
        path.resolve(this.options.cwd),
      ],
      {
        cwd: path.resolve(this.options.directory),
        env: {
          ...process.env,
          ...this.options.environment,
          T3CODE_HOME: path.resolve(this.options.home),
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    this.child = child;
    this.stopped = once(child, "exit").catch(() => undefined);
    let started!: () => void, failed!: (error: Error) => void;
    const ready = new Promise<void>((resolve, reject) => {
      started = resolve;
      failed = reject;
    });
    child.once("error", failed);
    child.once("exit", () => failed(new Error("Native T3-Instanz beendet")));
    let pending = "";
    for (const stream of [child.stdout!, child.stderr!])
      stream.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        pending = (pending + text).slice(-20000);
        this.options.log?.(text);
        if (/server is ready|pairing\s*url:/i.test(pending)) started();
      });
    const timer = setTimeout(
      () => failed(new Error("Native T3-Instanz nicht bereit")),
      60000,
    );
    try {
      await ready;
      const response = await fetch(
        this.origin + "/.well-known/t3/environment",
        { signal: AbortSignal.timeout(10000) },
      );
      check(response.ok, "T3-Metadaten nicht verfügbar", 503);
      const descriptor = (await response.json()) as NativeT3Descriptor;
      check(
        typeof descriptor.environmentId === "string" &&
          descriptor.environmentId.length > 0,
        "T3-Umgebung nicht identifizierbar",
        503,
      );
      this.descriptor = descriptor;
      return descriptor;
    } catch (error) {
      await this.close();
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  environment() {
    check(
      this.descriptor &&
        this.child?.exitCode === null &&
        this.child.signalCode === null,
      "Native T3-Instanz nicht verfügbar",
      503,
    );
    return this.descriptor;
  }
  waitForExit() {
    check(this.stopped, "T3 wurde noch nicht gestartet", 500);
    return this.stopped;
  }
  async close() {
    const child = this.child;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    child.kill("SIGTERM");
    const timer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
    }, 60000);
    try {
      await this.stopped;
    } finally {
      clearTimeout(timer);
    }
  }
}
