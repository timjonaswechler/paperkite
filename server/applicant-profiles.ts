import { createHash } from "node:crypto";
import type { Store } from "./store.ts";
import type {
  ApplicantProfile,
  SignatureInfo,
  ApplicationApplicantProfile,
} from "../shared/api.ts";
import {
  applicantVariables,
  emptyApplicantProfile,
  validateApplicantProfile,
} from "../shared/applicant-profile.ts";
import { check, putMap } from "./files.ts";
import { normalizeSignaturePng } from "./signature-image.ts";
import type { ApplicantBindings } from "../shared/api.ts";
import type { ApplicantRenderContext } from "./applicant-rendering.ts";

export class ApplicantProfiles {
  constructor(private store: Store) {
    const initialized = store.db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='application_applicant_profiles'",
      )
      .get();
    store.db.exec(`
      CREATE TABLE IF NOT EXISTS applicant_signatures(id TEXT PRIMARY KEY,png BLOB NOT NULL,width INTEGER NOT NULL,height INTEGER NOT NULL,created TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS application_applicant_profiles(app TEXT PRIMARY KEY REFERENCES apps(id) ON DELETE CASCADE,profile TEXT NOT NULL);
    `);
    if (!initialized) {
      const baseline = JSON.stringify(
        emptyApplicantProfile(store.preferences.settings().applicantName),
      );
      store.db
        .prepare(
          "INSERT INTO application_applicant_profiles SELECT id,? FROM apps",
        )
        .run(baseline);
    }
  }
  current(): ApplicantProfile {
    return this.store.preferences.settings().applicantProfile;
  }
  signature(id: string): SignatureInfo & { png: Buffer } {
    check(/^[a-f0-9]{64}$/.test(id), "Unterschrift nicht gefunden", 404);
    const row = this.store.db
      .prepare("SELECT * FROM applicant_signatures WHERE id=?")
      .get(id);
    check(row, "Unterschrift nicht gefunden", 404);
    const png = Buffer.from(row.png as Uint8Array);
    check(
      createHash("sha256").update(png).digest("hex") === id,
      "Gespeicherte Unterschrift ist beschädigt",
      503,
    );
    return {
      id,
      bytes: png.length,
      width: Number(row.width),
      height: Number(row.height),
      png,
    };
  }
  uploadSignature(input: unknown): SignatureInfo {
    check(Buffer.isBuffer(input), "Unterschrift als PNG benötigt");
    const result = normalizeSignaturePng(input);
    const id = createHash("sha256").update(result.png).digest("hex");
    if (
      !this.store.db
        .prepare("SELECT 1 FROM applicant_signatures WHERE id=?")
        .get(id)
    ) {
      const used = Number(
        this.store.db
          .prepare(
            "SELECT COALESCE(SUM(length(png)),0) AS bytes FROM applicant_signatures",
          )
          .get()!.bytes,
      );
      check(
        used + result.png.length <= 64 * 1024 * 1024,
        "Unterschriftenablage maximal 64 MiB",
        413,
      );
      this.store.db
        .prepare("INSERT INTO applicant_signatures VALUES(?,?,?,?,?)")
        .run(
          id,
          result.png,
          result.width,
          result.height,
          new Date().toISOString(),
        );
    }
    return {
      id,
      bytes: result.png.length,
      width: result.width,
      height: result.height,
    };
  }
  snapshot(id: string): ApplicantProfile | null {
    const row = this.store.db
      .prepare("SELECT profile FROM application_applicant_profiles WHERE app=?")
      .get(id);
    if (!row) return null;
    const profile: unknown = JSON.parse(String(row.profile));
    validateApplicantProfile(profile);
    return profile;
  }
  capture(id: string, source?: string) {
    const profile = source ? this.snapshot(source) : this.current();
    if (profile)
      this.store.db
        .prepare("INSERT INTO application_applicant_profiles VALUES(?,?)")
        .run(id, JSON.stringify(profile));
  }
  renderContext(
    id: string,
    bindings: ApplicantBindings | undefined,
  ): ApplicantRenderContext | undefined {
    if (!bindings) return undefined;
    const profile = this.snapshot(id);
    check(
      profile ||
        (Object.keys(bindings.fields).length === 0 &&
          bindings.signature === "none"),
      "Für diese Vorlage zuerst das Bewerberprofil übernehmen",
      409,
    );
    const values = profile || emptyApplicantProfile();
    check(
      bindings.signature !== "required" || values.signatureId,
      "Diese Vorlage benötigt eine Unterschrift. Im Bewerberprofil hochladen oder erstellen und für diese Bewerbung übernehmen.",
      409,
    );
    return {
      profile: values,
      ...(bindings.signature !== "none" && values.signatureId
        ? { signaturePng: this.signature(values.signatureId).png }
        : {}),
    };
  }
  fingerprint(id: string) {
    const profile = this.snapshot(id);
    return this.profileFingerprint(profile);
  }
  private profileFingerprint(profile: ApplicantProfile | null) {
    return createHash("sha256")
      .update(
        JSON.stringify(
          profile
            ? {
                variables: applicantVariables(profile),
                signatureId: profile.signatureId,
              }
            : null,
        ),
      )
      .digest("hex");
  }
  read(id: string): ApplicationApplicantProfile {
    const app = this.store.app(id);
    const profile = this.snapshot(id),
      current = this.current();
    let signature: SignatureInfo | null = null;
    if (profile?.signatureId) {
      const { png: _png, ...info } = this.signature(profile.signatureId);
      signature = info;
    }
    return {
      revision: app.revision,
      profile,
      current,
      outdated:
        this.profileFingerprint(profile) !== this.profileFingerprint(current),
      signature,
    };
  }
  adopt(id: string, revision: unknown, signatureOnly = false) {
    const app = this.store.app(id);
    check(
      app.status !== "Gesendet",
      "Gesendete Bewerbung ist schreibgeschützt",
      409,
    );
    check(
      app.revision === revision,
      "Bewerbung inzwischen geändert. Neu laden.",
      409,
    );
    const old = this.snapshot(id),
      current = this.current();
    if (signatureOnly)
      check(
        current.signatureId,
        "Zuerst eine Unterschrift hochladen oder erstellen",
        409,
      );
    const profile =
      signatureOnly && old
        ? { ...old, signatureId: current.signatureId }
        : current;
    if (this.profileFingerprint(old) === this.profileFingerprint(profile))
      return this.read(id);
    const original = this.store.read(id, "application.json");
    this.store.db.exec("BEGIN IMMEDIATE");
    try {
      this.store.db
        .prepare(
          "INSERT INTO application_applicant_profiles VALUES(?,?) ON CONFLICT(app) DO UPDATE SET profile=excluded.profile",
        )
        .run(id, JSON.stringify(profile));
      this.store.bump(id, {});
      this.store.db.exec("COMMIT");
    } catch (error) {
      this.store.db.exec("ROLLBACK");
      putMap(this.store.workspace(id), { "application.json": original });
      this.store.onWorkspaceCommit?.(id);
      throw error;
    }
    return this.read(id);
  }
}
