import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { waitForNativeProjectCleanup } from "../t3-projects.ts";
import { check } from "../files.ts";
import { prepareNativeWorkspace } from "../t3-workspace.ts";
import type { ModThreadRunner, ModBuilder } from "./imports.ts";

const exec = promisify(execFile);
export function nativeModThreads(options: {
  binary: string;
  home: string;
  environmentId: string;
  publicOrigin: string;
}): ModThreadRunner {
  // Prototype caller is restricted to its own gateway session; never use the installed T3 home.
  const cli = async (args: string[], signal?: AbortSignal) => {
    try {
      return (
        await exec(options.binary, [...args, "--base-dir", options.home], {
          env: { ...process.env, T3CODE_HOME: options.home },
          timeout: 60000,
          maxBuffer: 2 * 1024 * 1024,
          signal,
        })
      ).stdout;
    } catch {
      throw new Error(
        "Native T3-Operation fehlgeschlagen. Provider und Berechtigungsmodus in den nativen Prototyp-Einstellungen prüfen.",
      );
    }
  };
  async function show(threadId: string, signal?: AbortSignal) {
    return JSON.parse(
      await cli(
        ["thread", "show", threadId, "--json", "--messages", "1"],
        signal,
      ),
    ) as {
      thread: {
        activeRunId: string | null;
        latestRunId: string | null;
        status: string;
        pendingRequestCount: number;
        runCount: number;
      };
    };
  }
  return {
    generate: async (workspace, onThread, onAttention, signal) => {
      prepareNativeWorkspace(workspace);
      await cli(
        ["project", "add", workspace, "--title", "CV-Vorlagenimport"],
        signal,
      );
      const message =
        "Lies ADAPTER-CONTRACT.md und die Vorlagenquellen unter source/. Erstelle unter mod/ genau das beauftragte Mod-Format mit Formular und passender LaTeX-Datenanbindung. Verwende die bestehende Vorlage als Layoutbasis, nicht einen Universal-CV. Bei offenen Fragen den NEEDS-INPUT.md-Ablauf aus dem Vertrag verwenden. Keine produktiven Änderungen und keine realen CV-Inhalte als Beispieldaten.";
      const launched = JSON.parse(
        await cli(
          [
            "thread",
            "start",
            workspace,
            message,
            "--title",
            "Lebenslauf: Formular und Datenanbindung erstellen",
            "--json",
          ],
          signal,
        ),
      ) as { threadId: string; runId: string | null };
      check(
        typeof launched.threadId === "string" &&
          /^[a-zA-Z0-9_-]+$/.test(launched.threadId),
        "Ungültige native Thread-Antwort",
      );
      onThread(
        launched.threadId,
        new URL(
          "/" + options.environmentId + "/" + launched.threadId,
          options.publicOrigin,
        ).href,
      );
      for (;;) {
        signal.throwIfAborted();
        const { thread } = await show(launched.threadId, signal);
        if (thread.pendingRequestCount > 0) onAttention();
        else if (thread.runCount > 0 && thread.activeRunId === null) {
          check(
            thread.status !== "error",
            "Native KI meldet einen Fehler; Thread prüfen",
          );
          return;
        }
        await delay(3000, undefined, { signal });
      }
    },
    remove: async (workspace) => {
      const db = new DatabaseSync(
        path.join(options.home, "userdata", "statev2.sqlite"),
        { readOnly: true },
      );
      let projects: { project_id: string; deleted_at: string | null }[];
      try {
        projects = db
          .prepare(
            "SELECT project_id,deleted_at FROM projection_projects WHERE workspace_root=?",
          )
          .all(workspace) as unknown as typeof projects;
        const active = db
          .prepare(
            "SELECT 1 FROM orchestration_v2_projection_runs r JOIN orchestration_v2_projection_threads t ON t.thread_id=r.thread_id JOIN projection_projects p ON p.project_id=json_extract(t.payload_json,'$.projectId') WHERE p.workspace_root=? AND r.status IN ('preparing','queued','starting','running','waiting') LIMIT 1",
          )
          .get(workspace);
        check(!active, "Nativer KI-Thread arbeitet noch. Erst stoppen.", 409);
      } finally {
        db.close();
      }
      if (projects.some((project) => project.deleted_at === null))
        await cli(["project", "remove", workspace, "--force"]);
      await waitForNativeProjectCleanup(
        options.home,
        projects.map((p) => p.project_id),
      );
    },
    assertFinished: async (threadId) => {
      const { thread } = await show(threadId);
      check(
        thread.runCount > 0 &&
          thread.activeRunId === null &&
          thread.pendingRequestCount === 0 &&
          thread.status !== "error",
        "Der native Thread arbeitet noch, benötigt eine Antwort oder meldet einen Fehler",
        409,
      );
    },
  };
}
export function dockerModBuilder(
  builderImage: string,
  pdfImage: string,
): ModBuilder {
  check(
    [builderImage, pdfImage].every((x) => /^sha256:[a-f0-9]{64}$/.test(x)),
    "Prototyp-Build benötigt gepinnte Images",
  );
  const script = fileURLToPath(new URL("./build.py", import.meta.url));
  const common = [
    "run",
    "--rm",
    "--network=none",
    "--read-only",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",
    "--pids-limit=64",
    "--memory=768m",
    "--cpus=1",
    "--user",
    `${process.getuid!()}:${process.getgid!()}`,
    "--ulimit",
    "fsize=33554432:33554432",
    "--tmpfs",
    "/tmp:rw,nosuid,nodev,noexec,size=128m,mode=1777",
  ];
  async function run(args: string[], name: string, signal?: AbortSignal) {
    try {
      return await exec("/usr/bin/docker", args, {
        timeout: 120000,
        maxBuffer: 2 * 1024 * 1024,
        signal,
      });
    } catch (error) {
      await exec("/usr/bin/docker", ["rm", "-f", name]).catch(() => {});
      const e = error as { stdout?: string; stderr?: string };
      throw new Error(
        (
          "Build fehlgeschlagen\n" +
          (e.stdout || "") +
          "\n" +
          (e.stderr || "")
        ).slice(-6000),
      );
    }
  }
  return async (input, output, signal) => {
    const name = "cv-mod-build-" + randomUUID();
    const result = await run(
      [
        ...common,
        "--name",
        name,
        "--tmpfs",
        "/work:rw,nosuid,nodev,noexec,size=128m,mode=1777",
        "--mount",
        `type=bind,src=${input},dst=/input,readonly`,
        "--mount",
        `type=bind,src=${output},dst=/out`,
        "--mount",
        `type=bind,src=${script},dst=/prototype-builder.py,readonly`,
        "--entrypoint",
        "python3",
        builderImage,
        "/prototype-builder.py",
      ],
      name,
      signal,
    );
    const extract = "cv-mod-text-" + randomUUID();
    const text = await run(
      [
        ...common,
        "--name",
        extract,
        "--mount",
        `type=bind,src=${output},dst=/input,readonly`,
        "--entrypoint",
        "pdftotext",
        pdfImage,
        "/input/document.pdf",
        "-",
      ],
      extract,
      signal,
    );
    return { text: text.stdout, log: result.stdout + "\n" + result.stderr };
  };
}
