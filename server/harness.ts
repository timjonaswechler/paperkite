import fs from "node:fs";
import path from "node:path";
import * as Effect from "effect/Effect";
import * as Scope from "effect/Scope";
import * as Exit from "effect/Exit";
import * as Queue from "effect/Queue";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  makePiRpcConnection,
  type PiRpcConnection,
} from "./upstream/pi-rpc.ts";
import { check } from "./files.ts";
import { Store } from "./store.ts";
import { CodexHarness } from "./codex.ts";

type Session = {
  connection: PiRpcConnection;
  scope: Scope.Closeable;
  busy: boolean;
  pending: Map<string, Record<string, unknown>>;
  policyReady: () => void;
  model?: string;
};
const systemPrompt =
  "Du hilfst bei genau einer Bewerbung. Die Fakten stehen in application.json. Dokumente liegen in cv/ und anschreiben/. Erfinde keine Qualifikationen oder Arbeitgeberdaten. Prüfe bestehende Quellen, ändere nur passende Dokumente und erkläre Änderungen. Kein Git, keine Projekte, keine Subagents, keine Shell. PDF-Builds werden über die App ausgelöst. Alle Schreibzugriffe benötigen eine einzelne Nutzerfreigabe.";
class PiHarness {
  runtime = ManagedRuntime.make(NodeServices.layer);
  sessions = new Map<string, Session>();
  starting = new Map<string, Promise<Session>>();
  constructor(
    private store: Store,
    private changed: (app: string, event: unknown) => void,
  ) {}
  emit(app: string, type: string, payload: unknown) {
    const e = this.store.event(app, type, payload);
    this.changed(app, e);
    return e;
  }
  busy(app: string) {
    return this.starting.has(app) || !!this.sessions.get(app)?.busy;
  }
  status(app: string) {
    const s = this.sessions.get(app);
    const model =
      s?.model ||
      this.store.db.prepare("SELECT model FROM sessions WHERE app=?").get(app)
        ?.model;
    return {
      provider: "pi",
      busy: this.busy(app),
      model: typeof model === "string" ? model : undefined,
      pending: [...(s?.pending.values() || [])],
      policy:
        "read innerhalb der Bewerbung; edit/write nur mit Einzelfreigabe; keine Shell/MCP",
    };
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
    const cwd = this.store.workspace(app),
      dir = path.join(this.store.root, "sessions", app);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const saved = this.store.db
      .prepare("SELECT * FROM sessions WHERE app=?")
      .get(app);
    const args = [
      "--mode",
      "rpc",
      "--no-extensions",
      "--no-skills",
      "--no-prompt-templates",
      "--no-context-files",
      "--no-themes",
      "--no-mcp",
      "--no-approve",
      "--tools",
      "read,edit,write",
      "--session-dir",
      dir,
      "--system-prompt",
      systemPrompt,
      "-e",
      path.resolve("server/pi-permissions.ts"),
    ];
    if (saved?.native) {
      check(
        typeof saved.native === "string" &&
          saved.native.startsWith(dir + path.sep),
        "Ungültige Session",
        500,
      );
      args.push("--session", saved.native);
    }
    const scope = await this.runtime.runPromise(Scope.make());
    try {
      const connection = await this.runtime.runPromise(
        makePiRpcConnection({
          command: "/home/redjoker/.local/bin/pi",
          args,
          cwd,
          env: {
            HOME: "/home/redjoker",
            PATH: "/home/redjoker/.local/bin:/usr/local/bin:/usr/bin:/bin",
            LANG: "C.UTF-8",
            PI_OFFLINE: "1",
          },
        }).pipe(Effect.provideService(Scope.Scope, scope)),
      );
      let policyReady!: () => void;
      const ready = new Promise<void>((resolve) => {
        policyReady = resolve;
      });
      const s: Session = {
        connection,
        scope,
        busy: false,
        pending: new Map(),
        policyReady,
      };
      this.sessions.set(app, s);
      void this.runtime
        .runPromise(
          Effect.gen(
            function* (this: PiHarness) {
              while (true) {
                const event = yield* Queue.take(connection.events);
                yield* Effect.sync(() => this.onEvent(app, s, event));
              }
            }.bind(this),
          ).pipe(Effect.provideService(Scope.Scope, scope)),
        )
        .catch(() => {
          if (this.sessions.get(app) !== s) return;
          s.busy = false;
          s.pending.clear();
          this.sessions.delete(app);
          void this.runtime
            .runPromise(Scope.close(s.scope, Exit.void))
            .catch(() => {});
          this.emit(app, "error", {
            text: "Pi-Verbindung beendet. Nächste Nachricht setzt die gespeicherte Sitzung fort.",
          });
        });
      const state = (await this.runtime.runPromise(
        connection.request({ type: "get_state" }),
      )) as {
        sessionFile?: string;
        model?: { provider?: string; id?: string };
      };
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          ready,
          new Promise((_, reject) => {
            timer = setTimeout(
              () =>
                reject(
                  new Error(
                    "Pi-Dokumentfreigaben wurden nicht geladen; Sitzung gesperrt.",
                  ),
                ),
              5000,
            );
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
      check(
        typeof state.sessionFile === "string" &&
          state.sessionFile.startsWith(dir + path.sep),
        "Pi hat keine lokale Sitzung angelegt",
        503,
      );
      s.model = state.model
        ? `${state.model.provider}/${state.model.id}`
        : undefined;
      this.store.db
        .prepare(
          "INSERT INTO sessions(app,provider,native,model) VALUES(?,?,?,?) ON CONFLICT(app) DO UPDATE SET native=excluded.native,model=excluded.model",
        )
        .run(app, "pi", state.sessionFile, s.model || null);
      return s;
    } catch (e) {
      this.sessions.delete(app);
      await this.runtime.runPromise(Scope.close(scope, Exit.void));
      throw e;
    }
  }
  private onEvent(app: string, s: Session, e: Record<string, unknown>) {
    const type = e.type;
    if (type === "message_update") {
      const delta = e.assistantMessageEvent as {
        type?: string;
        delta?: string;
      };
      if (delta?.type === "text_delta")
        this.emit(app, "delta", { text: delta.delta });
    } else if (type === "message_end") {
      const m = e.message as {
        role?: string;
        content?: { type: string; text?: string }[];
        errorMessage?: string;
        stopReason?: string;
      };
      if (m?.role === "assistant")
        this.emit(app, "assistant", {
          text:
            m.content
              ?.filter((c) => c.type === "text")
              .map((c) => c.text)
              .join("") || "",
          error: m.errorMessage,
          stopReason: m.stopReason,
        });
    } else if (
      type === "tool_execution_start" ||
      type === "tool_execution_end"
    ) {
      this.emit(app, "tool", {
        phase: type,
        name: e.toolName,
        id: e.toolCallId,
        args: e.args,
        result: e.result,
        isError: e.isError,
      });
    } else if (type === "extension_ui_request") {
      if (e.method === "confirm" && typeof e.id === "string") {
        s.pending.set(e.id, e);
        this.emit(app, "approval", e);
      } else if (e.method === "notify") {
        if (e.message === "BEWERBUNG_DOCUMENT_POLICY_V1") s.policyReady();
        else this.emit(app, "notice", { text: e.message });
      } else if (
        e.method === "select" ||
        e.method === "input" ||
        e.method === "editor"
      ) {
        void this.runtime.runPromise(
          s.connection.send({
            type: "extension_ui_response",
            id: e.id,
            cancelled: true,
          }),
        );
        this.emit(app, "notice", {
          text: "Nicht unterstützte Pi-Dialoganfrage wurde abgelehnt.",
        });
      }
    } else if (type === "agent_settled") {
      s.busy = false;
      s.pending.clear();
      this.store.bump(app);
      this.emit(app, "settled", { aborted: e.aborted });
    }
  }
  async models(app: string) {
    const s = await this.open(app);
    return this.runtime.runPromise(
      s.connection.request({ type: "get_available_models" }),
    );
  }
  async prompt(app: string, text: unknown, model?: unknown) {
    check(
      typeof text === "string" &&
        text.trim().length > 0 &&
        text.length <= 50000,
      "Nachricht fehlt oder zu lang",
    );
    check(!this.busy(app), "Agent arbeitet noch", 409);
    const s = await this.open(app);
    check(!s.busy, "Agent arbeitet noch", 409);
    s.busy = true;
    try {
      if (model) {
        check(typeof model === "object" && model !== null, "Ungültiges Modell");
        const m = model as { provider: unknown; id: unknown };
        check(
          typeof m.provider === "string" && typeof m.id === "string",
          "Ungültiges Modell",
        );
        await this.runtime.runPromise(
          s.connection.request({
            type: "set_model",
            provider: m.provider,
            modelId: m.id,
          }),
        );
        s.model = m.provider + "/" + m.id;
      }
      this.emit(app, "user", { text });
      await this.runtime.runPromise(
        s.connection.request({ type: "prompt", message: text }),
      );
    } catch (e) {
      s.busy = false;
      s.pending.clear();
      this.sessions.delete(app);
      await this.runtime.runPromise(Scope.close(s.scope, Exit.void));
      this.emit(app, "error", { text: String(e) });
      throw e;
    }
    return this.status(app);
  }
  async approve(app: string, id: string, allow: unknown) {
    const s = this.sessions.get(app);
    check(s && s.pending.has(id), "Freigabe nicht mehr aktiv", 409);
    check(typeof allow === "boolean", "Entscheidung fehlt");
    s.pending.delete(id);
    await this.runtime.runPromise(
      s.connection.send({
        type: "extension_ui_response",
        id,
        confirmed: allow,
      }),
    );
    this.emit(app, "approval-resolved", { id, allow });
  }
  async interrupt(app: string) {
    const s = this.sessions.get(app);
    check(s, "Keine aktive Sitzung", 409);
    await this.runtime.runPromise(s.connection.request({ type: "abort" }));
    s.pending.clear();
    return this.status(app);
  }
  async closeApp(app: string) {
    check(!this.busy(app), "Agent arbeitet noch", 409);
    const session = this.sessions.get(app);
    if (!session) return;
    this.sessions.delete(app);
    session.pending.clear();
    await this.runtime.runPromise(Scope.close(session.scope, Exit.void));
  }
  async close() {
    for (const [app, s] of this.sessions) {
      this.sessions.delete(app);
      await this.runtime.runPromise(Scope.close(s.scope, Exit.void));
    }
    await this.runtime.dispose();
  }
}

export class Harness {
  private pi: PiHarness;
  private codex: CodexHarness;
  constructor(
    private store: Store,
    changed: (app: string, event: unknown) => void,
  ) {
    this.pi = new PiHarness(store, changed);
    this.codex = new CodexHarness(store, changed);
    store.db.exec(
      "CREATE TABLE IF NOT EXISTS harness_choice(app TEXT PRIMARY KEY REFERENCES apps(id), provider TEXT NOT NULL)",
    );
  }
  private provider(app: string): string {
    this.store.app(app);
    return (
      (this.store.db
        .prepare("SELECT provider FROM harness_choice WHERE app=?")
        .get(app)?.provider as string) || "pi"
    );
  }
  private selected(app: string) {
    return this.provider(app) === "codex" ? this.codex : this.pi;
  }
  private select(app: string, provider?: unknown) {
    this.store.app(app);
    if (provider === undefined) return this.selected(app);
    check(provider === "pi" || provider === "codex", "Unbekannter Harness");
    check(!this.busy(app), "Agent arbeitet noch", 409);
    this.store.db
      .prepare(
        "INSERT INTO harness_choice(app,provider) VALUES(?,?) ON CONFLICT(app) DO UPDATE SET provider=excluded.provider",
      )
      .run(app, provider);
    return this.selected(app);
  }
  busy(app: string) {
    return this.pi.busy(app) || this.codex.busy(app);
  }
  status(app: string) {
    return { ...this.selected(app).status(app), busy: this.busy(app) };
  }
  setProvider(app: string, provider: unknown) {
    this.select(app, provider);
    return this.status(app);
  }
  async models(app: string, provider?: unknown) {
    return this.select(app, provider).models(app);
  }
  async prompt(
    app: string,
    text: unknown,
    model?: unknown,
    provider?: unknown,
  ) {
    check(!this.busy(app), "Agent arbeitet noch", 409);
    return this.select(app, provider).prompt(app, text, model);
  }
  async approve(app: string, id: string, allow: unknown) {
    return this.selected(app).approve(app, id, allow);
  }
  async interrupt(app: string) {
    return this.selected(app).interrupt(app);
  }
  async closeApp(app: string) {
    check(!this.busy(app), "Agent arbeitet noch", 409);
    await this.pi.closeApp(app);
    await this.codex.closeApp(app);
  }
  async close() {
    await this.pi.close();
    await this.codex.close();
  }
}
