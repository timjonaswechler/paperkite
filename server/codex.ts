import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as Exit from "effect/Exit";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import * as Client from "./upstream/codex/client.ts";
import type {
  DynamicToolCallParams,
  DynamicToolCallResponse,
} from "./upstream/codex/_generated/schema.gen.ts";
import { Store } from "./store.ts";
import { atomicFile, check, safeFile, isText, FILE_LIMIT } from "./files.ts";

type Pending = {
  id: string;
  title: string;
  message: string;
  resolve: (allow: boolean) => void;
};
type Session = {
  client: Client.CodexAppServerClient["Service"];
  scope: Scope.Closeable;
  native: string;
  cwd: string;
  busy: boolean;
  turn?: string;
  model?: string;
  pending: Map<string, Pending>;
};
const instructions =
  "Du hilfst bei genau einer Bewerbung. Nutze nur bewerbung_read und bewerbung_write für application.json, cv/ und anschreiben/. Fakten nicht erfinden. Änderungen nur nach einzelner Nutzerfreigabe. Keine Shell, keine Projekte, kein Git, keine Subagents. PDF-Builds erfolgen in der Webapp. Schreibzugriffe über native Werkzeuge und Sandbox-Erweiterungen sind gesperrt.";
export const documentTools = ["read", "write"].map((action) => ({
  type: "function",
  name: "bewerbung_" + action,
  description:
    action === "read"
      ? "Read a text document in this application only."
      : "Write a complete document in this application. Waits for a one-shot user approval. Never retry a denied request.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string" },
      ...(action === "write" ? { content: { type: "string" } } : {}),
    },
    required: action === "write" ? ["path", "content"] : ["path"],
    additionalProperties: false,
  },
}));
// Named permissions have no root-wide read access. All native writes/escalations are denied.
// Host-mediated document tools enforce the narrower file allowlist and a live UI decision.
export function codexConfig(cwd: string) {
  return `default_permissions = "bewerbung"\napproval_policy = "on-request"\napprovals_reviewer = "user"\nweb_search = "disabled"\nproject_doc_max_bytes = 0\n[permissions.bewerbung.filesystem]\n${JSON.stringify(cwd)} = "read"\n[permissions.bewerbung.network]\nenabled = false\n[features]\nshell_tool = false\nunified_exec = false\nmulti_agent = false\nmulti_agent_v2 = false\napps = false\ncode_mode = false\ncode_mode_host = true\nmemories = false\nskill_search = false\nskip_host_skill_discovery = true\n[agents]\nenabled = false\n[skills.bundled]\nenabled = false\n`;
}
export class CodexHarness {
  runtime = ManagedRuntime.make(NodeServices.layer);
  sessions = new Map<string, Session>();
  starting = new Map<string, Promise<Session>>();
  constructor(
    private store: Store,
    private changed: (app: string, event: unknown) => void,
  ) {
    store.db.exec(
      "CREATE TABLE IF NOT EXISTS codex_sessions(app TEXT PRIMARY KEY REFERENCES apps(id), native TEXT NOT NULL UNIQUE, cwd TEXT NOT NULL, model TEXT)",
    );
  }
  emit(app: string, type: string, payload: Record<string, unknown>) {
    const e = this.store.event(app, type, { ...payload, provider: "codex" });
    this.changed(app, e);
  }
  busy(app: string) {
    return this.starting.has(app) || !!this.sessions.get(app)?.busy;
  }
  status(app: string) {
    const s = this.sessions.get(app);
    const model =
      s?.model ||
      this.store.db
        .prepare("SELECT model FROM codex_sessions WHERE app=?")
        .get(app)?.model;
    return {
      provider: "codex",
      busy: this.busy(app),
      model: typeof model === "string" ? model : undefined,
      pending: [...(s?.pending.values() || [])].map(
        ({ resolve: _resolve, ...p }) => p,
      ),
      policy:
        "Nur Dokumentwerkzeuge; Schreiben mit Einzelfreigabe. Native Shell/Schreibzugriffe und Sandbox-Erweiterungen gesperrt.",
    };
  }
  private run<A, E>(effect: Effect.Effect<A, E>) {
    return this.runtime.runPromise(effect.pipe(Effect.timeout("30 seconds")));
  }
  async open(app: string): Promise<Session> {
    if (this.starting.has(app)) return this.starting.get(app)!;
    if (this.sessions.has(app)) return this.sessions.get(app)!;
    const job = this.create(app);
    this.starting.set(app, job);
    try {
      return await job;
    } finally {
      this.starting.delete(app);
    }
  }
  private async create(app: string): Promise<Session> {
    const cwd = fs.realpathSync(this.store.workspace(app));
    const home = path.join(path.resolve(this.store.root), "codex", app);
    fs.mkdirSync(home, { recursive: true, mode: 0o700 });
    // Native Codex opens its existing login itself. No credential content is read or copied here.
    const auth = "/home/redjoker/.codex/auth.json",
      link = path.join(home, "auth.json");
    check(
      fs.existsSync(auth),
      "Codex: native Anmeldung fehlt; keine Zugangsdaten in der App hinterlegen.",
      503,
    );
    if (!fs.existsSync(link)) fs.symlinkSync(auth, link);
    atomicFile(path.join(home, "config.toml"), codexConfig(cwd));
    const scope = await this.runtime.runPromise(Scope.make());
    try {
      const client = await this.runtime.runPromise(
        Effect.gen(function* () {
          const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
          const handle = yield* spawner.spawn(
            ChildProcess.make(
              "/home/redjoker/.local/bin/codex",
              ["app-server", "--strict-config"],
              {
                cwd,
                extendEnv: false,
                env: {
                  HOME: home,
                  CODEX_HOME: home,
                  PATH: "/usr/bin:/bin",
                  LANG: "C.UTF-8",
                },
              },
            ),
          );
          return Context.get(
            yield* Layer.build(Client.layerChildProcess(handle)),
            Client.CodexAppServerClient,
          );
        }).pipe(Effect.provideService(Scope.Scope, scope)),
      );
      const s: Session = {
        client,
        scope,
        cwd,
        native: "",
        busy: false,
        pending: new Map(),
      };
      await this.run(
        client.handleServerNotification("item/agentMessage/delta", (p) =>
          Effect.sync(() => {
            if (p.threadId === s.native)
              this.emit(app, "delta", { text: p.delta });
          }),
        ),
      );
      await this.run(
        client.handleServerNotification("turn/started", (p) =>
          Effect.sync(() => {
            if (p.threadId === s.native) {
              s.turn = p.turn.id;
              s.busy = true;
            }
          }),
        ),
      );
      await this.run(
        client.handleServerNotification("item/completed", (p) =>
          Effect.sync(() => {
            if (p.threadId !== s.native) return;
            if (p.item.type === "agentMessage")
              this.emit(app, "assistant", { text: p.item.text });
            else if (!["userMessage", "reasoning"].includes(p.item.type))
              this.emit(app, "tool", {
                phase: "tool_execution_end",
                name: p.item.type,
              });
          }),
        ),
      );
      await this.run(
        client.handleServerNotification("turn/completed", (p) =>
          Effect.sync(() => {
            if (p.threadId !== s.native) return;
            this.clearPending(s);
            s.busy = false;
            s.turn = undefined;
            this.store.bump(app);
            if (p.turn.error)
              this.emit(app, "error", { text: p.turn.error.message });
            this.emit(app, "settled", {
              aborted: p.turn.status === "interrupted",
            });
          }),
        ),
      );
      await this.run(
        client.handleServerRequest("item/tool/call", (p) =>
          Effect.promise(() => this.documentCall(app, s, p)),
        ),
      );
      // Approval of a native request can escape its sandbox. Never forward "accept".
      await this.run(
        client.handleServerRequest(
          "item/commandExecution/requestApproval",
          () =>
            Effect.sync(() => {
              this.emit(app, "notice", {
                text: "Codex-Shell/Sandbox-Erweiterung gesperrt. Nur Bewerbungs-Dokumentwerkzeuge sind freigebbar.",
              });
              return { decision: "decline" as const };
            }),
        ),
      );
      await this.run(
        client.handleServerRequest("item/fileChange/requestApproval", () =>
          Effect.sync(() => {
            this.emit(app, "notice", {
              text: "Nativer Dateipatch gesperrt. bewerbung_write mit Einzelfreigabe verwenden.",
            });
            return { decision: "decline" as const };
          }),
        ),
      );
      // Other native requests fail closed in the upstream client's method-not-found handler.
      await this.run(
        client.request("initialize", {
          clientInfo: { name: "bewerbung", version: "0.1.0" },
          capabilities: { experimentalApi: true },
        }),
      );
      await this.run(client.notify("initialized", undefined));
      const account = await this.run(
        client.request("account/read", { refreshToken: false }),
      );
      check(account.account, "Codex ist nicht angemeldet", 503);
      const saved = this.store.db
        .prepare("SELECT * FROM codex_sessions WHERE app=?")
        .get(app);
      const params = {
        cwd,
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        permissions: "bewerbung",
        baseInstructions: instructions,
      };
      let response: {
        thread: { id: string; cwd: string; path?: string };
        model: string;
        activePermissionProfile?: { id: string };
        approvalPolicy: string;
        approvalsReviewer: string;
        cwd: string;
        runtimeWorkspaceRoots?: string[];
      };
      if (saved) {
        check(
          saved.cwd === cwd && typeof saved.native === "string",
          "Codex-Sitzung gehört nicht zu diesem Arbeitsbereich",
          409,
        );
        const metadata = await this.run(
          client.request("thread/read", {
            threadId: saved.native,
            includeTurns: false,
          }),
        );
        this.checkOwner(metadata.thread, cwd, home, saved.native);
        // Same pinned T3 raw boundary used by CodexAdapterV2.resumeNativeThread.
        response = (await this.run(
          client.raw.request("thread/resume", {
            ...params,
            threadId: saved.native,
            excludeTurns: true,
          }),
        )) as typeof response;
      } else {
        // Experimental dynamicTools/permissions are present in installed 0.167.0, but omitted
        // from the pinned client's stable encoder. raw preserves these verified wire fields.
        response = (await this.run(
          client.raw.request("thread/start", {
            ...params,
            dynamicTools: documentTools,
          }),
        )) as typeof response;
      }
      check(
        response.activePermissionProfile?.id === "bewerbung" &&
          response.approvalPolicy === "on-request" &&
          response.approvalsReviewer === "user" &&
          response.cwd === cwd &&
          (!response.runtimeWorkspaceRoots ||
            response.runtimeWorkspaceRoots.every((root) => root === cwd)),
        "Codex hat die eingeschränkte Richtlinie nicht bestätigt",
        503,
      );
      this.checkOwner(
        response.thread,
        cwd,
        home,
        saved?.native as string | undefined,
      );
      s.native = response.thread.id;
      s.model = response.model;
      this.store.db
        .prepare(
          "INSERT INTO codex_sessions(app,native,cwd,model) VALUES(?,?,?,?) ON CONFLICT(app) DO UPDATE SET model=excluded.model",
        )
        .run(app, s.native, cwd, s.model);
      this.sessions.set(app, s);
      void this.runtime.runPromise(client.awaitTermination).catch(() => {
        if (this.sessions.get(app) !== s) return;
        this.clearPending(s);
        s.busy = false;
        this.sessions.delete(app);
        void this.runtime.runPromise(Scope.close(scope, Exit.void));
        this.emit(app, "error", {
          text: "Codex-Verbindung beendet. Nächste Nachricht setzt nur die eigene gespeicherte Sitzung fort.",
        });
      });
      return s;
    } catch (e) {
      await this.runtime.runPromise(Scope.close(scope, Exit.void));
      throw e;
    }
  }
  private checkOwner(
    thread: { id: string; cwd: string; path?: string | null },
    cwd: string,
    home: string,
    native?: string,
  ) {
    check(
      thread &&
        thread.cwd === cwd &&
        (!native || thread.id === native) &&
        typeof thread.path === "string" &&
        path
          .resolve(thread.path)
          .startsWith(home + path.sep + "sessions" + path.sep),
      "Codex-Sitzungsbesitz nicht bestätigt; Fortsetzen gesperrt",
      409,
    );
  }
  private clearPending(s: Session) {
    for (const p of s.pending.values()) p.resolve(false);
    s.pending.clear();
  }
  private async documentCall(
    app: string,
    s: Session,
    p: DynamicToolCallParams,
  ): Promise<DynamicToolCallResponse> {
    let text = "",
      success = false;
    try {
      check(
        s.native === p.threadId && s.busy && (!s.turn || s.turn === p.turnId),
        "Fremder/inaktiver Codex-Turn",
        409,
      );
      const args = p.arguments as { path: unknown; content?: unknown };
      check(
        args && typeof args.path === "string" && isText(args.path),
        "Textdokument erwartet",
      );
      safeFile(s.cwd, args.path);
      check(
        p.tool === "bewerbung_read" || p.tool === "bewerbung_write",
        "Werkzeug nicht erlaubt",
      );
      this.emit(app, "tool", {
        phase: "tool_execution_start",
        name: p.tool,
        id: p.callId,
        args,
      });
      if (p.tool === "bewerbung_read")
        text = this.store.read(app, args.path).toString("utf8");
      else {
        check(
          args.path !== "application.json" &&
            typeof args.content === "string" &&
            Buffer.byteLength(args.content) <= FILE_LIMIT &&
            !args.content.includes("\0"),
          "Ungültiger Dokumentinhalt",
        );
        const id = randomUUID();
        const allow = await new Promise<boolean>((resolve) => {
          const pending = {
            id,
            title: "Codex: Dokument ersetzen?",
            message: args.path + "\n\n" + args.content,
            resolve,
          };
          s.pending.set(id, pending);
          this.emit(app, "approval", {
            id,
            title: pending.title,
            message: pending.message,
          });
        });
        check(
          allow && s.busy && this.sessions.get(app) === s,
          "Nutzerfreigabe abgelehnt/abgelaufen",
        );
        // Re-check path and revision at the point of use; no host tool executes supplied code.
        this.store.save(
          app,
          args.path,
          args.content,
          this.store.app(app).revision,
        );
        text = "Dokument gespeichert.";
      }
      success = true;
    } catch (e) {
      text = e instanceof Error ? e.message : String(e);
    }
    this.emit(app, "tool", {
      phase: "tool_execution_end",
      name: p.tool,
      id: p.callId,
      isError: !success,
    });
    return { success, contentItems: [{ type: "inputText", text }] };
  }
  async models(app: string) {
    const s = await this.open(app);
    const result = await this.run(s.client.request("model/list", {}));
    return {
      models: result.data.map((m) => ({
        provider: "codex",
        id: m.model,
        name: m.displayName,
      })),
    };
  }
  async prompt(app: string, text: unknown, model?: unknown) {
    check(
      typeof text === "string" && text.trim() && text.length <= 50000,
      "Nachricht fehlt oder zu lang",
    );
    check(!this.busy(app), "Agent arbeitet noch", 409);
    const s = await this.open(app);
    check(!s.busy, "Agent arbeitet noch", 409);
    let selected: string | undefined;
    if (model) {
      const m = model as { provider: string; id: string };
      check(
        m.provider === "codex" && typeof m.id === "string",
        "Ungültiges Codex-Modell",
      );
      selected = m.id;
    }
    s.busy = true;
    try {
      this.emit(app, "user", { text });
      const result = (await this.run(
        s.client.raw.request("turn/start", {
          threadId: s.native,
          cwd: s.cwd,
          permissions: "bewerbung",
          approvalPolicy: "on-request",
          approvalsReviewer: "user",
          input: [{ type: "text", text }],
          ...(selected ? { model: selected } : {}),
        }),
      )) as { turn: { id: string } };
      if (s.busy) s.turn = result.turn.id;
      if (selected) s.model = selected;
    } catch (e) {
      await this.drop(app, s);
      this.emit(app, "error", { text: String(e) });
      throw e;
    }
    return this.status(app);
  }
  async approve(app: string, id: string, allow: unknown) {
    const s = this.sessions.get(app),
      p = s?.pending.get(id);
    check(s && p, "Freigabe nicht mehr aktiv", 409);
    check(typeof allow === "boolean", "Entscheidung fehlt");
    s.pending.delete(id);
    p.resolve(allow);
    this.emit(app, "approval-resolved", { id, allow });
  }
  async interrupt(app: string) {
    const s = this.sessions.get(app);
    check(s && s.turn, "Kein aktiver Codex-Turn", 409);
    this.clearPending(s);
    try {
      await this.run(
        s.client.request("turn/interrupt", {
          threadId: s.native,
          turnId: s.turn,
        }),
      );
    } catch (e) {
      await this.drop(app, s);
      throw e;
    }
    return this.status(app);
  }
  private async drop(app: string, s: Session) {
    this.sessions.delete(app);
    this.clearPending(s);
    s.busy = false;
    await this.runtime.runPromise(Scope.close(s.scope, Exit.void));
  }
  async closeApp(app: string) {
    check(!this.busy(app), "Agent arbeitet noch", 409);
    const session = this.sessions.get(app);
    if (session) await this.drop(app, session);
  }
  async close() {
    await Promise.all(
      [...this.starting.values()].map((p) => p.catch(() => {})),
    );
    for (const [app, s] of this.sessions) await this.drop(app, s);
    await this.runtime.dispose();
  }
}
