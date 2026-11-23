import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Store } from "../server/store.ts";
import { Builds } from "../server/builds.ts";
import { neutralCover } from "../server/files.ts";

const temporary = () =>
  fs.mkdtempSync(path.join(os.tmpdir(), "bewerbung-organization-"));
const pdf = (text: string) => Buffer.from("%PDF-1.7\n" + text);
const master = (name: string) => ({
  format: "bewerbung-template-v1",
  files: Object.fromEntries(
    Object.entries({
      "cv/Lebenslauf.tex": name,
      "cv/lua/loader.lua": "return {}",
      "cv/profiles/general.lua": "return { experience = {}, skills = {} }",
      "cv/profiles/software.lua":
        'return { skills = {{ label = "Source", items = {"A"} }} }',
    }).map(([name, text]) => [name, Buffer.from(text).toString("base64")]),
  ),
});

test("central documents are stored once, validated before storage and removable only without references", () => {
  const root = temporary(),
    store = new Store(root);
  try {
    const bytes = pdf("Synthetic certificate A");
    const a = store.documents.upload("Zeugnis.pdf", bytes);
    const duplicate = store.documents.upload("Andere Bezeichnung.pdf", bytes);
    assert.equal(duplicate.id, a.id);
    assert.equal("duplicate" in duplicate && duplicate.duplicate, true);
    assert.equal(store.documents.list().length, 1);
    assert.equal(fs.readdirSync(path.join(root, "documents")).length, 1);
    assert.deepEqual(store.documents.bytes(a.id), bytes);
    assert.equal(
      store.documents.rename(a.id, "Bachelorzeugnis").label,
      "Bachelorzeugnis",
    );
    assert.deepEqual(store.documents.bytes(a.id), bytes);
    for (const name of [
      "../zeugnis.pdf",
      "C:\\zeugnis.pdf",
      "a\n.pdf",
      "/zeugnis.pdf",
    ])
      assert.throws(() => store.documents.upload(name, bytes), /Dateiname/);
    assert.throws(
      () => store.documents.upload("falsch.png", bytes),
      /Dateiendung/,
    );
    assert.throws(
      () =>
        store.documents.upload("html.pdf", Buffer.from("<script>bad</script>")),
      /Nur PDF/,
    );
    assert.throws(
      () =>
        store.documents.upload("gross.pdf", Buffer.alloc(25 * 1024 * 1024 + 1)),
      /25 MiB/,
    );
    assert.equal(store.documents.list().length, 1);
    const app = store.create({ company: "A", documentIds: [a.id] });
    assert.equal(store.documents.get(a.id).usedBy, 1);
    assert.throws(
      () => store.documents.remove(a.id),
      /noch in einer Bewerbung/,
    );
    store.update(app.id, { revision: app.revision, documentIds: [] });
    store.documents.remove(a.id);
    assert.equal(store.documents.list().length, 0);
    assert.equal(fs.readdirSync(path.join(root, "documents")).length, 0);
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("selected attachments are independent references, while successful builds retain their original attachment set", async () => {
  const root = temporary(),
    store = new Store(root);
  const builds = new Builds(store, async (_input, output, kind) => {
    fs.writeFileSync(
      path.join(output, "document.pdf"),
      pdf("Synthetic " + kind),
    );
    return "Synthetic runner";
  });
  try {
    const a = store.documents.upload("A.pdf", pdf("Certificate A"));
    const b = store.documents.upload("B.pdf", pdf("Certificate B"));
    const first = store.create({ company: "Firma A", documentIds: [a.id] });
    const copy = store.create({ source: first.id, company: "Firma B" });
    assert.deepEqual(store.documents.ids(copy.id), [a.id]);
    store.update(copy.id, { revision: copy.revision, documentIds: [b.id] });
    assert.deepEqual(store.documents.ids(first.id), [a.id]);
    assert.deepEqual(store.documents.ids(copy.id), [b.id]);
    assert.equal(fs.readdirSync(path.join(root, "documents")).length, 2);
    const before = store.app(first.id);
    for (const ids of [
      [a.id, a.id],
      ["00000000-0000-4000-8000-000000000000"],
      null,
    ])
      assert.throws(() =>
        store.update(first.id, { revision: before.revision, documentIds: ids }),
      );
    assert.equal(store.app(first.id).revision, before.revision);
    assert.deepEqual(store.documents.ids(first.id), [a.id]);
    const built = builds.request(first.id, "cv");
    await builds.idle();
    builds.finalize(first.id, String(built.id));
    store.update(first.id, { revision: first.revision, documentIds: [b.id] });
    store.documents.rename(a.id, "Neuer Anzeigename");
    const frozen = store.documents.snapshotFiles(String(built.id));
    assert.deepEqual(Object.keys(frozen), ["Anlagen/01_A.pdf"]);
    assert.deepEqual(frozen["Anlagen/01_A.pdf"], pdf("Certificate A"));
    assert.deepEqual(Object.keys(store.documents.files(first.id)), [
      "Anlagen/01_B.pdf",
    ]);
    assert.equal(store.documents.get(a.id).usedBy, 0);
    assert.throws(() => store.documents.remove(a.id), /gespeicherten Build/);
    assert.throws(
      () => builds.artifact(copy.id, String(built.id)),
      /nicht gefunden/,
    );
  } finally {
    await builds.idle();
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("attachment selection accepts exactly 100 MiB and rejects overflow before changing the application; library accounting enforces 1 GiB", () => {
  const root = temporary(),
    store = new Store(root);
  try {
    const bytes = Buffer.alloc(25 * 1024 * 1024);
    bytes.write("%PDF-1.7\n");
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      bytes[bytes.length - 1] = i;
      ids.push(store.documents.upload(`Fixture-${i}.pdf`, bytes).id);
    }
    const app = store.create({
      company: "Exact boundary",
      documentIds: ids.slice(0, 4),
    });
    assert.throws(
      () => store.update(app.id, { revision: app.revision, documentIds: ids }),
      /100 MiB/,
    );
    assert.equal(store.app(app.id).revision, app.revision);
    assert.deepEqual(store.documents.ids(app.id), ids.slice(0, 4));
    // Size-only fixture: quota accounting needs no additional gigabyte on disk.
    store.db
      .prepare("INSERT INTO documents VALUES(?,?,?,?,?,?,?)")
      .run(
        "00000000-0000-4000-8000-000000000005",
        "Quota-fixture.pdf",
        "Quota fixture",
        "application/pdf",
        1024 * 1024 * 1024 - 5 * 25 * 1024 * 1024,
        "f".repeat(64),
        "2026-01-01",
      );
    assert.throws(
      () => store.documents.upload("Overflow.pdf", pdf("Unique overflow")),
      /1 GiB/,
    );
    assert.equal(store.documents.list().length, 6);
    assert.equal(fs.readdirSync(path.join(root, "documents")).length, 5);
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("creation chooses CV and cover independently, never inherits company facts from a CV source, and rejects invalid selections atomically", () => {
  const root = temporary(),
    store = new Store(root);
  try {
    const template = store.import(master("CV SOURCE A"));
    const a = store.create({
      company: "Alte Firma",
      role: "Alte Rolle",
      posting: "Alte Anzeige",
      notes: "Private alte Notiz",
      template: template.id,
    });
    const cover = store.create({ company: "Cover source" });
    store.save(
      cover.id,
      "anschreiben/Anschreiben.tex",
      "EXPLICIT COVER B",
      cover.revision,
    );
    const attachment = store.documents.upload("Zeugnis.pdf", pdf("Synthetic"));
    store.update(a.id, { revision: a.revision, documentIds: [attachment.id] });
    const fresh = store.create({
      company: "Neue Firma",
      role: "Neue Rolle",
      status: "In Arbeit",
      cvSource: a.id,
      coverSource: cover.id,
      profile: "software",
      posting: "Neue Anzeige",
      notes: "Neue Notiz",
      documentIds: [attachment.id],
    });
    assert.equal(
      store.read(fresh.id, "cv/Lebenslauf.tex").toString(),
      "CV SOURCE A",
    );
    assert.equal(
      store.read(fresh.id, "anschreiben/Anschreiben.tex").toString(),
      "EXPLICIT COVER B",
    );
    assert.equal(fresh.profile, "software");
    assert.equal(fresh.status, "In Arbeit");
    assert.equal(fresh.posting, "Neue Anzeige");
    assert.equal(fresh.notes, "Neue Notiz");
    assert.equal(fresh.company, "Neue Firma");
    assert.deepEqual(store.documents.ids(fresh.id), [attachment.id]);
    const neutral = store.create({ company: "Neutral", cvSource: a.id });
    assert.equal(
      store.read(neutral.id, "anschreiben/Anschreiben.tex").toString(),
      neutralCover,
    );
    assert.equal(neutral.notes, "");
    assert.equal(neutral.posting, "");
    assert.deepEqual(store.documents.ids(neutral.id), []);
    const fullCopy = store.create({ source: fresh.id });
    assert.equal(fullCopy.status, "In Arbeit");
    assert.deepEqual(store.documents.ids(fullCopy.id), [attachment.id]);
    assert.equal(
      store.read(fullCopy.id, "anschreiben/Anschreiben.tex").toString(),
      "EXPLICIT COVER B",
    );
    const count = store.list().length;
    const directories = fs.readdirSync(path.join(root, "applications"));
    for (const input of [
      { profile: "missing" },
      { status: "Settled" },
      { documentIds: ["00000000-0000-4000-8000-000000000000"] },
    ])
      assert.throws(() =>
        store.create({
          company: "Invalid",
          template: template.id,
          ...input,
        } as Parameters<Store["create"]>[0]),
      );
    assert.equal(store.list().length, count);
    assert.deepEqual(
      fs.readdirSync(path.join(root, "applications")),
      directories,
    );
    assert.deepEqual(store.templates()[0].profiles, ["general", "software"]);
    assert.equal(
      store.read(a.id, "cv/Lebenslauf.tex").toString(),
      "CV SOURCE A",
    );
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("cover preparation is a persistent default for new applications, not a rewrite of existing documents or masters", () => {
  const root = temporary();
  let store = new Store(root);
  try {
    assert.equal(store.preferences.settings().prepareCoverLetter, true);
    const template = store.import(master("CV unchanged"));
    const originalMaster = store.templateLibrary.files(template.id);
    const existing = store.create({
      company: "Existing",
      template: template.id,
    });
    store.save(
      existing.id,
      "anschreiben/Anschreiben.tex",
      "Existing personal letter",
      existing.revision,
    );
    const before = store.app(existing.id);
    const settings = store.preferences.update({
      revision: store.preferences.settings().revision,
      prepareCoverLetter: false,
    });
    const skipped = store.create({
      company: "No letter",
      role: "Engineer",
      template: template.id,
    });
    const withoutTemplate = store.create({
      company: "No master",
      role: "Engineer",
    });
    for (const app of [skipped, withoutTemplate]) {
      assert.equal(
        store
          .files(app.id)
          .some((file) => file.name === "anschreiben/Anschreiben.tex"),
        false,
      );
      assert.throws(() => store.cover.read(app.id), /Datei nicht gefunden/);
      assert.equal(
        store.db
          .prepare("SELECT 1 FROM cover_documents WHERE app=?")
          .get(app.id),
        undefined,
      );
    }
    assert.equal(
      store.read(skipped.id, "cv/Lebenslauf.tex").toString(),
      "CV unchanged",
    );
    assert.deepEqual(store.templateLibrary.files(template.id), originalMaster);
    assert.deepEqual(store.app(existing.id), before);
    assert.equal(
      store.read(existing.id, "anschreiben/Anschreiben.tex").toString(),
      "Existing personal letter",
    );
    // Explicitly choosing a source is intentional reuse, not automatic preparation.
    const reused = store.create({
      company: "Explicit reuse",
      coverSource: existing.id,
    });
    assert.equal(
      store.read(reused.id, "anschreiben/Anschreiben.tex").toString(),
      "Existing personal letter",
    );
    store.close();
    store = new Store(root);
    assert.deepEqual(store.preferences.settings(), settings);
    assert.equal(
      store
        .files(skipped.id)
        .some((file) => file.name.startsWith("anschreiben/")),
      false,
    );
    store.preferences.update({
      revision: settings.revision,
      prepareCoverLetter: true,
    });
    const enabled = store.create({ company: "Enabled again" });
    assert.equal(
      store.read(enabled.id, "anschreiben/Anschreiben.tex").toString(),
      neutralCover,
    );
    assert.equal(
      store
        .files(skipped.id)
        .some((file) => file.name.startsWith("anschreiben/")),
      false,
    );
    assert.equal(
      store.read(existing.id, "anschreiben/Anschreiben.tex").toString(),
      "Existing personal letter",
    );
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("later manual cover preparation is idempotent, revision checked and rolls back files and records together", () => {
  const root = temporary(),
    store = new Store(root);
  try {
    store.preferences.update({
      revision: store.preferences.settings().revision,
      prepareCoverLetter: false,
      applicantName: "Ada Example",
    });
    const app = store.create({ company: "Fresh company", role: "Fresh role" });
    assert.throws(
      () => store.cover.create(app.id, { revision: app.revision + 1 }),
      /inzwischen geändert/,
    );
    assert.equal(
      store.files(app.id).some((file) => file.name.startsWith("anschreiben/")),
      false,
    );
    store.db.exec(
      "CREATE TRIGGER reject_cover_insert BEFORE INSERT ON cover_documents BEGIN SELECT RAISE(ABORT, 'synthetic cover failure'); END",
    );
    assert.throws(
      () => store.cover.create(app.id, { revision: app.revision }),
      /synthetic cover failure/,
    );
    assert.deepEqual(store.app(app.id), app);
    assert.equal(
      store.files(app.id).some((file) => file.name.startsWith("anschreiben/")),
      false,
    );
    assert.equal(
      store.db.prepare("SELECT COUNT(*) AS n FROM cover_documents").get()!.n,
      0,
    );
    store.db.exec("DROP TRIGGER reject_cover_insert");
    const prepared = store.cover.create(app.id, { revision: app.revision });
    assert.deepEqual(prepared.fields, {
      sender: "Ada Example",
      recipient: "Fresh company",
      subject: "Bewerbung als Fresh role",
      salutation: "Sehr geehrte Damen und Herren,",
      body: "",
      closing: "Mit freundlichen Grüßen",
    });
    assert.equal(prepared.revision, app.revision + 1);
    assert.equal(prepared.requiresConversion, false);
    assert.deepEqual(
      store.cover.create(app.id, { revision: app.revision }),
      prepared,
    );
    const edited = store.cover.save(app.id, {
      ...prepared,
      fields: { ...prepared.fields, body: "Manual user text" },
    });
    assert.deepEqual(
      store.cover.create(app.id, { revision: app.revision }),
      edited,
    );
    const sent = store.create({ company: "Sent", status: "Gesendet" });
    assert.throws(
      () => store.cover.create(sent.id, { revision: sent.revision }),
      /schreibgeschützt/,
    );
    assert.equal(
      store.db.prepare("SELECT COUNT(*) AS n FROM cover_documents").get()!.n,
      1,
    );
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("settings, opened applications and per-application chat drafts persist independently of application status and revisions", () => {
  const root = temporary();
  let store = new Store(root);
  try {
    const a = store.create({ company: "A" }),
      b = store.create({ company: "B" });
    const defaults = store.preferences.settings();
    assert.equal(defaults.autoPruneBuilds, false);
    assert.equal(defaults.prepareCoverLetter, true);
    const saved = store.preferences.update({
      revision: defaults.revision,
      prepareCoverLetter: false,
      autoPruneBuilds: true,
      autoBuild: true,
      collapsedStatuses: ["Absage"],
    });
    assert.equal(saved.revision, defaults.revision + 1);
    assert.throws(
      () =>
        store.preferences.update({
          revision: defaults.revision,
          autoBuild: false,
        }),
      /inzwischen geändert/,
    );
    for (const input of [
      { autoBuild: "true" },
      { autoPruneBuilds: "true" },
      { autoPruneBuilds: null },
      { prepareCoverLetter: "false" },
      { prepareCoverLetter: null },
      { prepareCoverLetter: 0 },
      { theme: "dark" },
      { sendOnEnter: false },
      { defaultProvider: "codex" },
      { collapsedStatuses: ["Working"] },
      { collapsedStatuses: ["In Arbeit", "In Arbeit"] },
      { shell: true },
    ])
      assert.throws(() =>
        store.preferences.update({ revision: saved.revision, ...input }),
      );
    store.preferences.open(a.id);
    store.preferences.open(b.id);
    assert.deepEqual(store.preferences.ui().openIds, [b.id, a.id]);
    store.update(a.id, { revision: a.revision, status: "Gesendet" });
    assert.deepEqual(store.preferences.ui().openIds, [b.id, a.id]);
    store.preferences.close(b.id);
    assert.equal(store.app(b.id).company, "B");
    assert.deepEqual(store.preferences.ui().openIds, [a.id]);
    store.preferences.saveDraft(a.id, "Entwurf A");
    store.preferences.saveDraft(b.id, "Entwurf B");
    assert.equal(store.app(b.id).revision, b.revision);
    store.close();
    store = new Store(root);
    assert.deepEqual(store.preferences.settings(), saved);
    assert.deepEqual(store.preferences.ui().openIds, [a.id]);
    assert.equal(store.preferences.draft(a.id).text, "Entwurf A");
    assert.equal(store.preferences.draft(b.id).text, "Entwurf B");
    assert.equal(store.app(a.id).status, "Gesendet");
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("business preferences migrate retired T3 fields once without losing business values or touching native settings", () => {
  const root = temporary();
  let store = new Store(root);
  try {
    const application = store.create({
      company: "Migration fixture",
      role: "Engineer",
    });
    const source = store.read(application.id, "anschreiben/Anschreiben.tex");
    store.preferences.open(application.id);
    store.preferences.saveDraft(application.id, "Unsent migration fixture");
    const nativeSettings = path.join(
      root,
      "native-t3",
      "userdata",
      "settings.json",
    );
    fs.mkdirSync(path.dirname(nativeSettings), { recursive: true });
    const nativeBytes = Buffer.from(
      '{"providerInstances":{},"defaultModelSelection":null}\n',
    );
    fs.writeFileSync(nativeSettings, nativeBytes);
    store.db.prepare("UPDATE preferences SET value=? WHERE singleton=1").run(
      JSON.stringify({
        revision: 17,
        theme: "dark",
        sendOnEnter: false,
        defaultProvider: "codex",
        autoBuild: true,
        collapsedStatuses: ["Entwurf", "Fertig", "Zusage"],
      }),
    );
    store.close();
    store = new Store(root);
    const migrated = {
      revision: 18,
      analysisModel: null,
      applicantName: "",
      prepareCoverLetter: true,
      autoPruneBuilds: false,
      autoBuild: true,
      collapsedStatuses: ["In Arbeit", "Fertig", "Zusage"],
    };
    assert.deepEqual(store.preferences.settings(), migrated);
    assert.deepEqual(
      JSON.parse(
        String(store.db.prepare("SELECT value FROM preferences").get()!.value),
      ),
      migrated,
    );
    assert.deepEqual(fs.readFileSync(nativeSettings), nativeBytes);
    assert.deepEqual(store.app(application.id), application);
    assert.deepEqual(
      store.read(application.id, "anschreiben/Anschreiben.tex"),
      source,
    );
    assert.deepEqual(store.preferences.ui().openIds, [application.id]);
    assert.equal(
      store.preferences.draft(application.id).text,
      "Unsent migration fixture",
    );
    for (const patch of [
      { theme: "light" },
      { sendOnEnter: true },
      { defaultProvider: "pi" },
    ])
      assert.throws(
        () =>
          store.preferences.update({ revision: migrated.revision, ...patch }),
        /Unbekannte Einstellung/,
      );
    assert.throws(
      () => store.preferences.update({ revision: 17, autoBuild: false }),
      /inzwischen geändert/,
    );
    store.close();
    store = new Store(root);
    assert.deepEqual(store.preferences.settings(), migrated);
    const saved = store.preferences.update({
      revision: migrated.revision,
      autoBuild: false,
    });
    assert.deepEqual(saved, { ...migrated, revision: 19, autoBuild: false });
    assert.deepEqual(fs.readFileSync(nativeSettings), nativeBytes);
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("search covers German company names, roles, literal posting text and final chat messages, not streaming deltas or unsent drafts", () => {
  const root = temporary(),
    store = new Store(root);
  try {
    const a = store.create({
      company: "Müller GmbH",
      role: "Photonik",
      posting: "Text %_/[] Ende",
      notes: "Projekt-ABC",
    });
    const b = store.create({
      company: "Andere Firma",
      role: "Projekt-ABC",
      status: "Gesendet",
    });
    store.event(a.id, "assistant", {
      text: "Vorlauf ".repeat(40) + "Omega-Spezialwort passt.",
    });
    store.event(b.id, "delta", { text: "NurDeltaTreffer" });
    store.preferences.saveDraft(a.id, "UngesendetesGeheimwort");
    assert.deepEqual(
      store.search("MÜLLER").map((r) => r.id),
      [a.id],
    );
    assert.deepEqual(
      store.search("Projekt-ABC", "Gesendet").map((r) => r.id),
      [b.id],
    );
    assert.equal(store.search("Omega-Spezialwort")[0].match, "chat");
    assert.match(
      store.search("Omega-Spezialwort")[0].preview,
      /Omega-Spezialwort/,
    );
    assert.deepEqual(
      store.search("%_/[]").map((r) => r.id),
      [a.id],
    );
    assert.deepEqual(store.search("' OR 1=1 --"), []);
    assert.deepEqual(store.search("NurDeltaTreffer"), []);
    assert.deepEqual(store.search("UngesendetesGeheimwort"), []);
    assert.throws(() => store.search("x", "Snoozed"), /Statusfilter/);
    assert.throws(() => store.search(["x"]), /Suchtext/);
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("opening an old database adds organization tables without rewriting existing applications, files or native sessions", () => {
  const root = temporary(),
    id = "00000000-0000-4000-8000-000000000001";
  const db = new DatabaseSync(path.join(root, "bewerbung.sqlite"));
  db.exec(
    "CREATE TABLE apps(id TEXT PRIMARY KEY,company TEXT NOT NULL,role TEXT NOT NULL,status TEXT NOT NULL,posting TEXT NOT NULL,notes TEXT NOT NULL,profile TEXT NOT NULL,template TEXT,revision INTEGER NOT NULL,created TEXT NOT NULL,updated TEXT NOT NULL)",
  );
  db.prepare("INSERT INTO apps VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(
    id,
    "Vorhandene Firma",
    "Vorhandene Rolle",
    "Gesendet",
    "Anzeige",
    "Notiz",
    "general",
    null,
    7,
    "2026-01-01",
    "2026-01-02",
  );
  db.exec(
    "CREATE TABLE sessions(app TEXT PRIMARY KEY REFERENCES apps(id),provider TEXT NOT NULL,native TEXT,model TEXT)",
  );
  db.prepare("INSERT INTO sessions VALUES(?,?,?,?)").run(
    id,
    "pi",
    "synthetic-owned-session",
    "synthetic-model",
  );
  const before = db.prepare("SELECT * FROM apps WHERE id=?").get(id);
  db.close();
  const file = path.join(
    root,
    "applications",
    id,
    "workspace",
    "cv",
    "Lebenslauf.tex",
  );
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "LEGACY CV BYTES");
  const store = new Store(root);
  try {
    assert.deepEqual(store.app(id), before);
    assert.equal(fs.readFileSync(file, "utf8"), "LEGACY CV BYTES");
    assert.equal(
      store.db.prepare("SELECT native FROM sessions WHERE app=?").get(id)!
        .native,
      "synthetic-owned-session",
    );
    assert.equal(store.documents.list().length, 0);
    assert.deepEqual(store.preferences.ui().openIds, []);
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
