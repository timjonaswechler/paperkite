import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import http, { type IncomingHttpHeaders } from "node:http";
import { check, fileMap, HttpError } from "./files.ts";
import { Store } from "./store.ts";
import type { NativeT3Runtime } from "./t3-runtime.ts";
import { prepareNativeDocuments } from "./t3-documents.ts";
import { prepareNativeWorkspace } from "./t3-workspace.ts";
import type { ApplicationNavigation } from "../shared/api.ts";

type NativeProject = {
  id: string;
  title: string;
  workspaceRoot: string;
  deletedAt: string | null;
  archivedAt?: string | null;
};
export type NativeProjectContext = { headers: IncomingHttpHeaders };
export interface ApplicationChatProjects {
  authorize(
    context: NativeProjectContext,
    intent: "read" | "write",
  ): Promise<void>;
  ensure(
    id: string,
    context: NativeProjectContext,
  ): Promise<{ environmentId: string; projectId: string }>;
  navigation(context: NativeProjectContext): Promise<ApplicationNavigation>;
  remove(id: string, context: NativeProjectContext): Promise<void>;
  busy(id: string): boolean;
}

// File disposal waits for T3's committed cleanup effects, not only its command acknowledgement.
export async function waitForNativeProjectCleanup(
  home: string,
  projects: string[],
) {
  if (!projects.length) return;
  const directory = path.join(home, "userdata"),
    database = path.join(directory, "statev2.sqlite");
  const db = new DatabaseSync(database, { readOnly: true });
  try {
    const query = db.prepare(
      `SELECT e.status,e.effect_type FROM orchestration_v2_effect_outbox e JOIN orchestration_v2_projection_threads t ON t.thread_id=e.thread_id WHERE json_extract(t.payload_json,'$.projectId') IN (${projects.map(() => "?").join(",")}) AND e.status IN ('pending','running','failed')`,
    );
    await new Promise<void>((resolve, reject) => {
      let done = false;
      const finish = (error?: Error) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        watcher.close();
        error ? reject(error) : resolve();
      };
      const inspect = () => {
        try {
          const rows = query.all(...projects);
          const unsafeFailure = rows.some(
            (row) =>
              row.status === "failed" &&
              ["provider-session.detach", "terminal.cleanup"].includes(
                String(row.effect_type),
              ),
          );
          if (unsafeFailure)
            return finish(
              new HttpError(
                409,
                "T3 konnte eigene Arbeitsprozesse noch nicht freigeben. Die Bewerbungsdateien wurden erhalten.",
              ),
            );
          if (
            !rows.some(
              (row) => row.status === "pending" || row.status === "running",
            )
          )
            finish();
        } catch (error) {
          finish(error instanceof Error ? error : new Error(String(error)));
        }
      };
      const watcher = fs.watch(directory, () => inspect());
      watcher.on("error", finish);
      const timer = setTimeout(
        () =>
          finish(
            new HttpError(
              409,
              "T3 bereinigt noch eigene Prozesse. Bewerbungsdateien bleiben bis zum nächsten Löschversuch erhalten.",
            ),
          ),
        60000,
      );
      inspect();
    });
  } finally {
    db.close();
  }
}

export class NativeT3Projects implements ApplicationChatProjects {
  constructor(
    private store: Store,
    private runtime: Pick<
      NativeT3Runtime,
      "origin" | "environment" | "options"
    >,
  ) {
    store.db.exec(
      "CREATE TABLE IF NOT EXISTS native_project_deletions(app TEXT PRIMARY KEY,projects TEXT NOT NULL); CREATE TABLE IF NOT EXISTS native_workspace_revisions(app TEXT PRIMARY KEY REFERENCES apps(id) ON DELETE CASCADE,revision INTEGER NOT NULL,fingerprint TEXT NOT NULL)",
    );
    store.initializeWorkspace = (id) =>
      prepareNativeWorkspace(store.workspace(id));
    store.onWorkspaceCommit = (id) => {
      this.recordWorkspace(id);
      prepareNativeDocuments(store, id);
    };
  }
  async authorize(context: NativeProjectContext, intent: "read" | "write") {
    const session = await this.request<{
      authenticated: boolean;
      permissions?: string[];
    }>("/api/auth/session", context);
    check(
      session.authenticated,
      "Bitte zuerst beim originalen T3 anmelden.",
      401,
    );
    const permission =
      intent === "write" ? "filesystem:write" : "filesystem:read";
    check(
      session.permissions?.includes(permission),
      "Die native T3-Anmeldung erlaubt diesen Dateizugriff nicht.",
      403,
    );
  }
  busy(id: string) {
    const db = new DatabaseSync(
      path.join(this.runtime.options.home, "userdata", "statev2.sqlite"),
      { readOnly: true },
    );
    try {
      // These are T3's own active-run states; this only guards business snapshots/file disposal.
      const active = Boolean(
        db
          .prepare(
            `SELECT 1 FROM orchestration_v2_projection_runs r JOIN orchestration_v2_projection_threads t ON t.thread_id=r.thread_id JOIN projection_projects p ON p.project_id=json_extract(t.payload_json,'$.projectId') WHERE p.workspace_root=? AND r.status IN ('preparing','queued','starting','running','waiting') LIMIT 1`,
          )
          .get(this.store.workspace(id)),
      );
      if (!active) this.syncExternalFiles(id);
      return active;
    } finally {
      db.close();
    }
  }
  private workspaceFingerprint(id: string) {
    const files = fileMap(this.store.workspace(id));
    return createHash("sha256")
      .update(
        JSON.stringify(
          Object.keys(files)
            .filter((name) => name !== "application.json")
            .sort()
            .map((name) => [
              name,
              createHash("sha256").update(files[name]!).digest("hex"),
            ]),
        ),
      )
      .digest("hex");
  }
  private recordWorkspace(
    id: string,
    fingerprint = this.workspaceFingerprint(id),
  ) {
    this.store.db
      .prepare(
        "INSERT INTO native_workspace_revisions(app,revision,fingerprint) VALUES(?,?,?) ON CONFLICT(app) DO UPDATE SET revision=excluded.revision,fingerprint=excluded.fingerprint",
      )
      .run(id, this.store.app(id).revision, fingerprint);
  }
  private syncExternalFiles(id: string) {
    const fingerprint = this.workspaceFingerprint(id);
    const previous = this.store.db
      .prepare("SELECT fingerprint FROM native_workspace_revisions WHERE app=?")
      .get(id);
    if (previous && previous.fingerprint !== fingerprint) this.store.bump(id);
    else this.recordWorkspace(id, fingerprint);
  }
  private async request<T>(
    endpoint: string,
    context: NativeProjectContext,
    body?: Record<string, unknown>,
  ): Promise<T> {
    const headers: Record<string, string> = {
      Accept: "application/json",
      "x-t3-orchestration-protocol": "2",
    };
    // Native T3 authorizes the caller's own browser/token; never substitute an owner/CLI credential.
    for (const name of [
      "cookie",
      "authorization",
      "origin",
      "host",
      "x-forwarded-proto",
    ] as const) {
      const value = context.headers[name];
      if (typeof value === "string") headers[name] = value;
    }
    if (body !== undefined) headers["Content-Type"] = "application/json";
    // Fetch rewrites Host; preserving it is required for T3's unchanged cookie Origin checks.
    const response = await new Promise<{
      status: number;
      value: Record<string, unknown>;
    }>((resolve, reject) => {
      const request = http.request(
        new URL(endpoint, this.runtime.origin),
        {
          method: body === undefined ? "GET" : "POST",
          headers,
          signal: AbortSignal.timeout(60000),
        },
        (incoming) => {
          const chunks: Buffer[] = [];
          incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
          incoming.on("error", reject);
          incoming.on("end", () => {
            try {
              resolve({
                status: incoming.statusCode || 502,
                value: JSON.parse(Buffer.concat(chunks).toString("utf8")),
              });
            } catch (error) {
              reject(error);
            }
          });
        },
      );
      request.on("error", reject);
      request.end(body === undefined ? undefined : JSON.stringify(body));
    });
    const value = response.value;
    if (response.status < 200 || response.status >= 300)
      throw new HttpError(
        response.status,
        typeof value.message === "string"
          ? value.message
          : typeof value.error === "string"
            ? value.error
            : "T3 hat den Vorgang abgelehnt. Anmeldung und native Berechtigungen prüfen.",
      );
    return value as T;
  }
  private async projects(context: NativeProjectContext) {
    const snapshot = await this.request<{ projects: NativeProject[] }>(
      "/api/projects",
      context,
    );
    check(
      Array.isArray(snapshot.projects),
      "T3-Projektliste nicht verfügbar",
      503,
    );
    return snapshot.projects;
  }
  async navigation(
    context: NativeProjectContext,
  ): Promise<ApplicationNavigation> {
    const snapshot = await this.request<{
      projects: (Omit<NativeProject, "deletedAt"> & {
        deletedAt?: string | null;
      })[];
      threads: {
        id: string;
        projectId: string;
        title: string;
        status: string;
        updatedAt: string;
        deletedAt: string | null;
        lineage: { relationshipToParent: string | null; sideChat?: boolean };
      }[];
    }>("/api/orchestration/shell", context);
    check(
      Array.isArray(snapshot.projects) && Array.isArray(snapshot.threads),
      "Native Chatliste nicht verfügbar",
      503,
    );
    return {
      environmentId: this.runtime.environment().environmentId,
      applications: this.store.list().map((app) => {
        const projects = snapshot.projects.filter(
          (project) =>
            project.workspaceRoot === this.store.workspace(app.id) &&
            project.deletedAt == null,
        );
        const ids = new Set(projects.map((project) => project.id));
        return {
          id: app.id,
          projectId:
            projects.find((project) => project.archivedAt == null)?.id ??
            projects[0]?.id ??
            null,
          chats: snapshot.threads
            .filter(
              (thread) =>
                ids.has(thread.projectId) &&
                thread.deletedAt === null &&
                thread.lineage.relationshipToParent !== "subagent" &&
                thread.lineage.sideChat !== true,
            )
            .map(({ id, title, status, updatedAt }) => ({
              id,
              title,
              status,
              updatedAt,
            }))
            .sort(
              (a, b) =>
                b.updatedAt.localeCompare(a.updatedAt) ||
                a.id.localeCompare(b.id),
            ),
        };
      }),
    };
  }
  async ensure(id: string, context: NativeProjectContext) {
    const app = this.store.app(id),
      workspace = this.store.workspace(id);
    check(
      !this.store.db
        .prepare("SELECT app FROM native_project_deletions WHERE app=?")
        .get(id),
      "Löschung der Bewerbung wird noch abgeschlossen",
      409,
    );
    const existing = (await this.projects(context)).find(
      (project) =>
        project.workspaceRoot === workspace && project.deletedAt === null,
    );
    const session = await this.request<{ permissions?: string[] }>(
      "/api/auth/session",
      context,
    );
    if (!existing && session.permissions?.includes("filesystem:write"))
      prepareNativeWorkspace(workspace);
    let project = existing;
    if (project?.archivedAt != null)
      project = await this.request<NativeProject>(
        "/api/projects/mutate",
        context,
        {
          type: "project.update",
          commandId: randomUUID(),
          projectId: project.id,
          archived: false,
        },
      );
    if (!project) {
      try {
        project = await this.request<NativeProject>(
          "/api/projects/mutate",
          context,
          {
            type: "project.create",
            commandId: randomUUID(),
            projectId: randomUUID(),
            title: [app.company, app.role].filter(Boolean).join(" · "),
            workspaceRoot: workspace,
          },
        );
      } catch (error) {
        // Another browser can finish the same native project creation first.
        if (
          !(error instanceof HttpError) ||
          (error.status !== 400 && error.status !== 409)
        )
          throw error;
        project = (await this.projects(context)).find(
          (candidate) =>
            candidate.workspaceRoot === workspace &&
            candidate.deletedAt === null,
        );
        if (!project) throw error;
      }
    }
    check(
      project &&
        project.workspaceRoot === workspace &&
        project.deletedAt === null,
      "T3-Projekt gehört nicht zur Bewerbung",
      409,
    );
    if (session.permissions?.includes("filesystem:write"))
      prepareNativeDocuments(this.store, id);
    if (
      !this.store.db
        .prepare("SELECT app FROM native_workspace_revisions WHERE app=?")
        .get(id)
    )
      this.recordWorkspace(id);
    return {
      environmentId: this.runtime.environment().environmentId,
      projectId: project.id,
    };
  }
  async remove(id: string, context: NativeProjectContext) {
    const workspace = this.store.workspace(id);
    const projects = (await this.projects(context)).filter(
      (project) => project.workspaceRoot === workspace,
    );
    const previous = this.store.db
      .prepare("SELECT projects FROM native_project_deletions WHERE app=?")
      .get(id);
    const ids = [
      ...new Set([
        ...projects.map((project) => project.id),
        ...(previous
          ? (JSON.parse(String(previous.projects)) as string[])
          : []),
      ]),
    ];
    if (!ids.length) return;
    this.store.db
      .prepare(
        "INSERT INTO native_project_deletions(app,projects) VALUES(?,?) ON CONFLICT(app) DO UPDATE SET projects=excluded.projects",
      )
      .run(id, JSON.stringify(ids));
    let committed = false;
    try {
      for (const project of projects.filter(
        (project) => project.deletedAt === null,
      )) {
        // The application's existing explicit deletion confirmation includes its own native chats.
        await this.request("/api/projects/mutate", context, {
          type: "project.delete",
          commandId: randomUUID(),
          projectId: project.id,
          force: true,
        });
        committed = true;
      }
    } catch (error) {
      if (
        !committed &&
        !previous &&
        error instanceof HttpError &&
        (error.status === 401 || error.status === 403)
      )
        this.store.db
          .prepare("DELETE FROM native_project_deletions WHERE app=?")
          .run(id);
      throw error;
    }
    await waitForNativeProjectCleanup(this.runtime.options.home, ids);
    this.store.db
      .prepare("DELETE FROM native_project_deletions WHERE app=?")
      .run(id);
  }
}
