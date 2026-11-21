import type { DatabaseSync } from "node:sqlite";
import {
  APPLICATION_STATUSES,
  type Settings,
  type UiState,
} from "../shared/api.ts";
import { check } from "./files.ts";

const defaults: Settings = {
  revision: 1,
  autoBuild: false,
  autoPruneBuilds: false,
  analysisModel: null,
  applicantName: "",
  collapsedStatuses: ["Fertig", "Gesendet", "Absage", "Zusage"],
};

export class Preferences {
  constructor(private db: DatabaseSync) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS preferences(singleton INTEGER PRIMARY KEY CHECK(singleton=1),value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS open_applications(app TEXT PRIMARY KEY REFERENCES apps(id) ON DELETE CASCADE,position INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS composer_drafts(app TEXT PRIMARY KEY REFERENCES apps(id) ON DELETE CASCADE,text TEXT NOT NULL);
    `);
    db.prepare("INSERT OR IGNORE INTO preferences VALUES(1,?)").run(
      JSON.stringify(defaults),
    );
    const stored = this.settings();
    const normalized: Settings & Record<string, unknown> = { ...stored };
    let changed = false;
    for (const key of ["theme", "sendOnEnter", "defaultProvider"])
      if (Object.hasOwn(normalized, key)) {
        delete normalized[key];
        changed = true;
      }
    if (normalized.autoPruneBuilds === undefined) {
      normalized.autoPruneBuilds = false;
      changed = true;
    }
    if (normalized.analysisModel === undefined) {
      normalized.analysisModel = null;
      changed = true;
    }
    if (normalized.applicantName === undefined) {
      normalized.applicantName = "";
      changed = true;
    }
    if ((stored.collapsedStatuses as string[]).includes("Entwurf")) {
      normalized.collapsedStatuses = [
        ...new Set(
          (stored.collapsedStatuses as string[]).map((status) =>
            status === "Entwurf" ? "In Arbeit" : status,
          ),
        ),
      ] as Settings["collapsedStatuses"];
      changed = true;
    }
    if (changed) {
      normalized.revision = stored.revision + 1;
      db.prepare("UPDATE preferences SET value=? WHERE singleton=1").run(
        JSON.stringify(normalized),
      );
    }
  }
  settings(): Settings {
    return JSON.parse(
      String(
        this.db
          .prepare("SELECT value FROM preferences WHERE singleton=1")
          .get()!.value,
      ),
    );
  }
  update(input: unknown): Settings {
    check(
      input && typeof input === "object" && !Array.isArray(input),
      "Einstellungen erwartet",
    );
    const patch = input as Record<string, unknown>,
      current = this.settings();
    check(
      patch.revision === current.revision,
      "Einstellungen inzwischen geändert. Neu laden.",
      409,
    );
    check(
      Object.keys(patch).every((key) => Object.hasOwn(defaults, key)),
      "Unbekannte Einstellung",
    );
    if (patch.analysisModel !== undefined && patch.analysisModel !== null) {
      const model = patch.analysisModel as Record<string, unknown>;
      check(
        typeof model === "object" &&
          !Array.isArray(model) &&
          Object.keys(model).every(
            (key) => key === "instanceId" || key === "model",
          ) &&
          [model.instanceId, model.model].every(
            (value) =>
              typeof value === "string" &&
              value.trim().length > 0 &&
              value.length <= 300,
          ),
        "Ungültiges Analysemodell",
      );
    }
    if (patch.applicantName !== undefined)
      check(
        typeof patch.applicantName === "string" &&
          patch.applicantName.length <= 120 &&
          !/[\x00-\x1f\x7f]/.test(patch.applicantName),
        "Ungültiger Bewerbername",
      );
    if (patch.autoBuild !== undefined)
      check(
        typeof patch.autoBuild === "boolean",
        "Ungültige Einstellung: autoBuild",
      );
    if (patch.autoPruneBuilds !== undefined)
      check(
        typeof patch.autoPruneBuilds === "boolean",
        "Ungültige Einstellung: autoPruneBuilds",
      );
    if (patch.collapsedStatuses !== undefined) {
      const values = patch.collapsedStatuses;
      check(
        Array.isArray(values) &&
          values.length <= APPLICATION_STATUSES.length &&
          new Set(values).size === values.length &&
          values.every((value) => APPLICATION_STATUSES.includes(value)),
        "Ungültige Statusauswahl",
      );
    }
    const result = {
      ...current,
      ...patch,
      revision: current.revision + 1,
    } as Settings;
    this.db
      .prepare("UPDATE preferences SET value=? WHERE singleton=1")
      .run(JSON.stringify(result));
    return result;
  }
  ui(): UiState {
    return {
      openIds: this.db
        .prepare("SELECT app FROM open_applications ORDER BY position DESC")
        .all()
        .map((row) => String(row.app)),
    };
  }
  open(app: string): UiState {
    const position = Number(
      this.db
        .prepare(
          "SELECT COALESCE(MAX(position),0)+1 AS next FROM open_applications",
        )
        .get()!.next,
    );
    this.db
      .prepare(
        "INSERT INTO open_applications(app,position) VALUES(?,?) ON CONFLICT(app) DO UPDATE SET position=excluded.position",
      )
      .run(app, position);
    return this.ui();
  }
  close(app: string): UiState {
    this.db.prepare("DELETE FROM open_applications WHERE app=?").run(app);
    return this.ui();
  }
  draft(app: string) {
    return {
      text: String(
        this.db.prepare("SELECT text FROM composer_drafts WHERE app=?").get(app)
          ?.text || "",
      ),
    };
  }
  saveDraft(app: string, text: unknown) {
    check(
      typeof text === "string" && text.length <= 50000 && !text.includes("\0"),
      "Entwurf zu lang oder ungültig",
    );
    if (text)
      this.db
        .prepare(
          "INSERT INTO composer_drafts(app,text) VALUES(?,?) ON CONFLICT(app) DO UPDATE SET text=excluded.text",
        )
        .run(app, text);
    else this.db.prepare("DELETE FROM composer_drafts WHERE app=?").run(app);
    return { text };
  }
}
