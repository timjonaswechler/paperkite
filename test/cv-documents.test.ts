import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Store } from "../server/store.ts";
import { Builds, dockerRunner } from "../server/builds.ts";
import { parseLiteralLua } from "../server/lua-profile.ts";
import type { CvState } from "../server/cv-documents.ts";
import { cvDocumentTemplate } from "./fixtures/cv-document-template.ts";
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), "cv-documents-"));
function setup() {
  const root = temp(),
    store = new Store(root),
    template = store.import(cvDocumentTemplate());
  const a = store.create({ company: "Synthetic A", template: template.id }),
    b = store.create({ company: "Synthetic B", template: template.id });
  return { root, store, a, b };
}
const save = (store: Store, id: string, state: CvState) =>
  store.cv.save(id, {
    revision: state.revision,
    fingerprint: state.fingerprint,
    data: state.data,
  });
const json = (v: unknown) => JSON.parse(JSON.stringify(v));
async function pdfText(file: string) {
  const image = fs.readFileSync("pdf-tools/image-id", "utf8").trim();
  return (
    await promisify(execFile)(
      "/usr/bin/docker",
      [
        "run",
        "--rm",
        "--network=none",
        "--read-only",
        "--cap-drop=ALL",
        "--user",
        `${process.getuid!()}:${process.getgid!()}`,
        "--mount",
        `type=bind,src=${path.dirname(file)},dst=/input,readonly`,
        "--entrypoint",
        "pdftotext",
        image,
        "/input/" + path.basename(file),
        "-",
      ],
      { timeout: 30000, maxBuffer: 1024 * 1024 },
    )
  ).stdout.replace(/\s+/g, " ");
}

test("complete CV reads without migration and saves names, selected education, prose/lists and unknown source fields independently", () => {
  const { root, store, a, b } = setup();
  try {
    const originalMain = store.read(a.id, "cv/Lebenslauf.tex"),
      other = store.read(b.id, "cv/profiles/general.lua");
    const state = store.cv.read(a.id);
    assert.equal(store.app(a.id).revision, 1);
    assert.equal(
      store.db.prepare("SELECT count(*) n FROM cv_documents").get()!.n,
      0,
    );
    assert.equal(state.data.person.firstName, "Demo");
    assert.equal(state.data.person.role, undefined);
    assert.deepEqual(
      state.data.sections.map((s) => s.kind),
      ["education", "experience", "skills"],
    );
    const edu = state.data.sections[0]!.entries[0]!;
    assert.equal(edu.fields.grade, "1,7");
    assert.equal(edu.fields.period, "2020 – 2024");
    const data = structuredClone(state.data);
    data.person.firstName = "Changed";
    data.person.displayName = "Changed Person";
    const entry = data.sections.find((s) => s.kind === "experience")!
      .entries[0]!;
    entry.fields.title = "ChangedPosition";
    entry.content.unshift({
      id: "prose-one",
      type: "paragraph",
      text: "Before paragraph",
    });
    entry.content.push({
      id: "prose-two",
      type: "paragraph",
      text: "After paragraph",
    });
    const changed = store.cv.save(a.id, { ...state, data });
    assert.equal(changed.revision, 2);
    assert.equal(
      changed.data.sections.find((s) => s.kind === "experience")!.entries[0]!
        .id,
      entry.id,
    );
    assert.throws(() => save(store, a.id, state), /inzwischen geändert/);
    const personal = json(
        parseLiteralLua(store.read(a.id, "cv/profile/personal.lua").toString()),
      ),
      education = json(
        parseLiteralLua(
          store.read(a.id, "cv/profile/education.lua").toString(),
        ),
      ),
      profile = json(
        parseLiteralLua(store.read(a.id, "cv/profiles/general.lua").toString()),
      );
    assert.equal(personal.first_name, "Changed");
    assert.deepEqual(personal.extra, { keep: true });
    assert.equal(education.unused.degree, "UnusedMarker");
    assert.deepEqual(profile.custom, { keep: true });
    assert.deepEqual(profile.experience[0].extra, { keep: true });
    assert.equal(profile.experience[0].content[0].text, "Before paragraph");
    assert.equal(
      store.read(a.id, "cv/Lebenslauf.tex").equals(originalMain),
      true,
    );
    assert.equal(
      store.read(b.id, "cv/profiles/general.lua").equals(other),
      true,
    );
    const selected = store.cv.read(a.id);
    selected.data.sections[0]!.entries = [];
    const deselected = save(store, a.id, selected);
    assert.equal(deselected.data.sections[0]!.entries.length, 0);
    assert.equal(
      json(
        parseLiteralLua(
          store.read(a.id, "cv/profile/education.lua").toString(),
        ),
      ).selected.degree,
      "DegreeMarker",
    );
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("empty secondary lists survive saving and source re-reading without blocking PDF requests", () => {
  const { root, store, a } = setup();
  try {
    const state = store.cv.read(a.id),
      entry = state.data.sections.find((s) => s.kind === "experience")!
        .entries[0]!;
    entry.content.push({
      id: "second-empty-list",
      type: "bulletList",
      items: [],
    });
    const saved = save(store, a.id, state);
    assert.equal(
      saved.data.sections.find((s) => s.kind === "experience")!.entries[0]!
        .content.length,
      2,
    );
    assert.equal(store.cv.plan(a.id)?.mod, false);
    const personal = path.join(
      store.workspace(a.id),
      "cv/profile/personal.lua",
    );
    fs.appendFileSync(personal, "\n-- synthetic native source change\n");
    assert.equal(
      store.cv.read(a.id).data.sections.find((s) => s.kind === "experience")!
        .entries[0]!.content.length,
      2,
    );
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a failed CV database write restores all projected source bytes and the application revision", () => {
  const { root, store, a } = setup();
  try {
    const names = [
      "application.json",
      "cv/profiles/general.lua",
      "cv/profile/personal.lua",
      "cv/profile/education.lua",
    ];
    const before = Object.fromEntries(
      names.map((name) => [name, store.read(a.id, name)]),
    );
    const state = store.cv.read(a.id);
    state.data.person.firstName = "MustNotPersist";
    store.db.exec(
      "CREATE TRIGGER reject_cv_document BEFORE INSERT ON cv_documents BEGIN SELECT RAISE(ABORT,'synthetic rejected write'); END",
    );
    assert.throws(() => save(store, a.id, state), /synthetic rejected write/);
    assert.equal(store.app(a.id).revision, 1);
    for (const name of names)
      assert.equal(store.read(a.id, name).equals(before[name]!), true, name);
    assert.equal(
      store.db.prepare("SELECT count(*) n FROM cv_documents").get()!.n,
      0,
    );
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("external native-source changes are not overwritten from a stale CV document", () => {
  const { root, store, a } = setup();
  try {
    const first = store.cv.read(a.id);
    const saved = save(store, a.id, first);
    const file = path.join(store.workspace(a.id), "cv/profiles/general.lua");
    fs.writeFileSync(
      file,
      fs.readFileSync(file, "utf8").replace("PositionMarker", "ExternalMarker"),
    );
    assert.throws(() => save(store, a.id, saved), /inzwischen geändert/);
    assert.equal(
      store.cv.read(a.id).data.sections.find((s) => s.kind === "experience")!
        .entries[0]!.fields.title,
      "ExternalMarker",
    );
    assert.match(fs.readFileSync(file, "utf8"), /ExternalMarker/);
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("real legacy-layout build consumes complete CV blocks, preserves original sources and tracks PDF freshness", async () => {
  const { root, store, a } = setup();
  const builds = new Builds(
    store,
    dockerRunner(fs.readFileSync("builder/image-id", "utf8").trim()),
  );
  try {
    const initial = store.cv.read(a.id);
    const entry = initial.data.sections.find((s) => s.kind === "experience")!
      .entries[0]!;
    entry.content.unshift({
      id: "paragraph-before",
      type: "paragraph",
      text: "ParagraphBefore51 with 50% & Rust_2026.",
    });
    entry.content.push({
      id: "paragraph-after",
      type: "paragraph",
      text: "ParagraphAfter53",
    });
    const experience = initial.data.sections.find(
      (s) => s.kind === "experience",
    )!;
    experience.entries.push({
      id: "excluded-entry",
      included: false,
      fields: { title: "ExcludedTitleMarker" },
      content: [
        { id: "excluded-body", type: "paragraph", text: "ExcludedTextMarker" },
      ],
    });
    const saved = save(store, a.id, initial);
    assert.equal(
      saved.data.sections.find((s) => s.kind === "experience")!.entries.length,
      2,
    );
    const original = store.read(a.id, "cv/Lebenslauf.tex");
    const result = { id: String(builds.request(a.id, "cv").id) };
    await builds.idle();
    assert.equal(
      store.build(a.id, result.id).status,
      "success",
      String(store.build(a.id, result.id).log),
    );
    const text = await pdfText(builds.artifact(a.id, result.id));
    for (const word of [
      "Demo",
      "Person",
      "DegreeMarker",
      "1,7",
      "PositionMarker",
      "ParagraphBefore51",
      "BulletMarkerA",
      "ParagraphAfter53",
      "Rust_2026",
      "Technology",
      "Lua, TeX",
    ])
      assert.ok(text.includes(word), word + " missing: " + text);
    assert.equal(text.includes("ExcludedTitleMarker"), false);
    assert.equal(text.includes("ExcludedTextMarker"), false);
    const editedExcluded = store.cv.read(a.id);
    editedExcluded.data.sections.find(
      (s) => s.kind === "experience",
    )!.entries[1]!.fields.title = "ExcludedChangedMarker";
    save(store, a.id, editedExcluded);
    assert.equal(builds.documentStatus(a.id).cv, "current");
    assert.ok(
      text.indexOf("ParagraphBefore51") < text.indexOf("BulletMarkerA") &&
        text.indexOf("BulletMarkerA") < text.indexOf("ParagraphAfter53"),
    );
    assert.equal(store.read(a.id, "cv/Lebenslauf.tex").equals(original), true);
    assert.equal(builds.documentStatus(a.id).cv, "current");
    assert.ok(builds.inputFiles(a.id, result.id)["cv-build.json"]);
    store.update(a.id, {
      revision: store.app(a.id).revision,
      notes: "Non-CV change",
    });
    assert.equal(builds.documentStatus(a.id).cv, "current");
    const personalFile = path.join(
      store.workspace(a.id),
      "cv/profile/personal.lua",
    );
    fs.appendFileSync(personalFile, "\n-- trigger legacy source re-read\n");
    assert.equal(
      store.cv.read(a.id).data.sections.find((s) => s.kind === "experience")!
        .entries[1]!.included,
      false,
    );
    const next = store.cv.read(a.id);
    next.data.person.firstName = "Later";
    next.data.person.displayName = "Later Person";
    save(store, a.id, next);
    assert.equal(builds.documentStatus(a.id).cv, "outdated");
    assert.equal(
      (await pdfText(builds.artifact(a.id, result.id))).includes("Demo Person"),
      true,
    );
  } finally {
    await builds.idle();
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("binding immutable mod versions works for blank and existing CVs, survives copies and cleans up with application deletion", async () => {
  const { root, store, a } = setup();
  const empty = store.create({ company: "Empty CV" });
  const manifest = {
    format: "bewerbung-cv-mod-prototype-v1",
    engine: "lualatex",
    entrypoint: "layout/main.tex",
    fields: [],
  };
  const files = {
    "mod.json": Buffer.from(JSON.stringify(manifest)),
    "layout/main.tex": fs.readFileSync("test/fixtures/cv-mod-synthetic.tex"),
  };
  store.cv.resolveMod = (id) => {
    assert.ok(id === "import-id" || id === "import-id.version-one");
    return {
      id: "import-id.version-one",
      name: "Synthetic mod",
      digest: "fixed-one",
      fields: [],
      files,
    };
  };
  const builds = new Builds(
    store,
    dockerRunner(fs.readFileSync("builder/image-id", "utf8").trim()),
  );
  try {
    let state = store.cv.bind(empty.id, empty.revision, "import-id");
    assert.equal(state.modId, "import-id.version-one");
    state.data.person.displayName = "EmptyApplicantMarker";
    state.data.sections = [
      {
        id: "mod-inclusion-section",
        kind: "experience",
        label: "Work",
        entries: [
          {
            id: "mod-included",
            fields: { title: "IncludedModMarker" },
            content: [],
          },
          {
            id: "mod-excluded",
            included: false,
            fields: { title: "ExcludedModMarker" },
            content: [],
          },
        ],
      },
    ];
    state = save(store, empty.id, state);
    const result = { id: String(builds.request(empty.id, "cv").id) };
    await builds.idle();
    assert.equal(
      store.build(empty.id, result.id).status,
      "success",
      String(store.build(empty.id, result.id).log),
    );
    assert.ok(
      (await pdfText(builds.artifact(empty.id, result.id))).includes(
        "EmptyApplicantMarker",
      ),
    );
    assert.ok(builds.inputFiles(empty.id, result.id)["layout/main.tex"]);
    const modText = await pdfText(builds.artifact(empty.id, result.id));
    assert.ok(modText.includes("IncludedModMarker"));
    assert.equal(modText.includes("ExcludedModMarker"), false);
    assert.equal(store.cv.read(empty.id).data.sections[0]!.entries.length, 2);
    assert.equal(builds.documentStatus(empty.id).cv, "current");
    const resolve = store.cv.resolveMod;
    store.cv.resolveMod = () => {
      throw Error("Unavailable checked mod");
    };
    assert.equal(builds.documentStatus(empty.id).cv, "outdated");
    assert.match(store.cv.read(empty.id).modWarning || "", /Unavailable/);
    store.cv.resolveMod = resolve;
    store.cv.bind(a.id, store.app(a.id).revision, "import-id");
    const copy = store.create({ source: a.id, company: "Independent copy" });
    assert.equal(store.cv.read(copy.id).modId, "import-id.version-one");
    const changed = store.cv.read(copy.id);
    changed.data.person.firstName = "OnlyCopy";
    changed.data.person.displayName = "OnlyCopy Person";
    save(store, copy.id, changed);
    assert.equal(store.cv.read(a.id).data.person.firstName, "Demo");
    store.remove(copy.id, store.app(copy.id).revision);
    assert.equal(
      store.db
        .prepare("SELECT count(*) n FROM cv_documents WHERE app=?")
        .get(copy.id)!.n,
      0,
    );
  } finally {
    await builds.idle();
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
