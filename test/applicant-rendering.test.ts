import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../server/store.ts";
import { Builds } from "../server/builds.ts";
import {
  emptyApplicantProfile,
  validateApplicantBindings,
} from "../shared/applicant-profile.ts";
import { parseForm } from "../shared/cv-form.ts";
import type { FormSpec } from "../shared/cv-form.ts";
import { importManifest } from "../server/cv-mod-prototype/model.ts";
import { fileMap } from "../server/files.ts";

const temporary = () =>
  fs.mkdtempSync(path.join(os.tmpdir(), "paperkite-applicant-rendering-"));
const image = () =>
  fs.readFileSync(
    new URL(
      "./fixtures/applicant-signatures/rgba-filter-0.png",
      import.meta.url,
    ),
  );
const profile = () => ({
  ...emptyApplicantProfile(),
  firstName: "Erika",
  lastName: "Muster",
  street: "Straße & Weg 7",
  postalCode: "01067",
  city: "Dresden",
});
const form = (signature: "none" | "optional" | "required"): FormSpec => ({
  format: "bewerbung-cv-form-v2",
  engine: "lualatex",
  entrypoint: "layout/main.tex",
  form: [
    {
      type: "text",
      key: "fullName",
      label: "Name",
      target: "pdf",
      required: true,
    },
    { type: "text", key: "streetLine", label: "Straße", target: "pdf" },
    { type: "text", key: "ownText", label: "Eigener Text", target: "pdf" },
  ],
  applicant: { fields: { fullName: "name", streetLine: "street" }, signature },
});

test("profile bindings are explicit, typed and restricted to appropriate document fields", () => {
  const good = form("required");
  assert.deepEqual(parseForm(good), good);
  for (const bad of [
    { ...good, applicant: { fields: { missing: "name" }, signature: "none" } },
    {
      ...good,
      applicant: { fields: { fullName: "password" }, signature: "none" },
    },
    {
      ...good,
      applicant: { fields: { fullName: "name" }, signature: "automatic" },
    },
    {
      ...good,
      form: [
        {
          type: "entries",
          key: "items",
          label: "Einträge",
          children: good.form,
        },
      ],
      applicant: { fields: { fullName: "name" }, signature: "none" },
    },
  ])
    assert.throws(() => parseForm(bad));
  assert.throws(() =>
    validateApplicantBindings(
      { fields: JSON.parse('{"__proto__":"name"}'), signature: "none" },
      [],
    ),
  );
  assert.throws(() =>
    importManifest({
      format: "bewerbung-cover-mod-v1",
      engine: "pdflatex",
      entrypoint: "main.tex",
      applicant: { fields: { recipient: "sender" }, signature: "none" },
    }),
  );
});

test("two independent layouts use one frozen profile; profile-bound editor values cannot override it", () => {
  const root = temporary(),
    store = new Store(root);
  try {
    store.preferences.update({ revision: 1, applicantProfile: profile() });
    const app = store.create({ company: "SYNTHETIC Company", role: "Role" });
    const cv = store.cv.forms.install("Profile CV", form("none"), {
      "layout/main.tex": Buffer.from("synthetic layout"),
    });
    store.cv.bind(app.id, app.revision, cv.id);
    const before = store.cv.read(app.id);
    assert.equal(before.form!.values.fullName, "Erika Muster");
    assert.equal(before.form!.values.streetLine, "Straße & Weg 7");
    assert.throws(
      () =>
        store.cv.save(app.id, {
          revision: before.revision,
          fingerprint: before.fingerprint,
          formValues: { ...before.form!.values, fullName: "Someone else" },
        }),
      /Bewerberprofil/,
    );
    const saved = store.cv.save(app.id, {
      revision: before.revision,
      fingerprint: before.fingerprint,
      formValues: { ...before.form!.values, ownText: "Keep my exact content" },
    });
    const raw = JSON.parse(
      String(
        store.db
          .prepare("SELECT data FROM cv_form_values WHERE app=?")
          .get(app.id)!.data,
      ),
    );
    assert.equal(raw.fullName, undefined);
    assert.equal(raw.ownText, "Keep my exact content");
    store.cover.resolveMod = (id) => ({
      id,
      name: "Profile Cover",
      digest: "fixture",
      files: { "main.tex": Buffer.from("synthetic cover") },
      manifest: {
        format: "bewerbung-cover-mod-v1",
        engine: "pdflatex",
        entrypoint: "main.tex",
        applicant: { fields: { sender: "sender" }, signature: "none" },
      },
    });
    const letter = store.cover.read(app.id);
    const bound = store.cover.bind(app.id, {
      revision: letter.revision,
      fingerprint: letter.fingerprint,
      modId: "cover:fixture",
    });
    assert.equal(
      bound.fields.sender,
      "Erika Muster\nStraße & Weg 7\n01067 Dresden",
    );
    assert.equal(bound.fields.recipient, "SYNTHETIC Company");
    const written = store.cover.save(app.id, {
      revision: bound.revision,
      fingerprint: bound.fingerprint,
      fields: { ...bound.fields, body: "My unchanged letter body" },
    });
    assert.throws(
      () =>
        store.cover.save(app.id, {
          revision: written.revision,
          fingerprint: written.fingerprint,
          fields: { ...written.fields, sender: "Other applicant" },
        }),
      /Bewerberprofil/,
    );
    const cvFingerprint = store.cv.fingerprint(app.id),
      coverFingerprint = store.cover.fingerprint(app.id);
    store.preferences.update({
      revision: store.preferences.settings().revision,
      applicantProfile: {
        ...profile(),
        firstName: "Changed",
        street: "Different road",
      },
    });
    assert.equal(store.cv.fingerprint(app.id), cvFingerprint);
    assert.equal(store.cover.fingerprint(app.id), coverFingerprint);
    store.applicantProfiles.adopt(app.id, store.app(app.id).revision);
    assert.equal(store.cv.read(app.id).form!.values.fullName, "Changed Muster");
    assert.match(store.cover.read(app.id).fields.sender, /^Changed Muster/);
    assert.equal(
      store.cover.read(app.id).fields.body,
      "My unchanged letter body",
    );
    assert.equal(
      store.cv.read(app.id).form!.values.ownText,
      "Keep my exact content",
    );
    assert.notEqual(store.cv.fingerprint(app.id), cvFingerprint);
    assert.notEqual(store.cover.fingerprint(app.id), coverFingerprint);
    assert.equal(saved.form!.values.fullName, "Erika Muster");
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("classic CV bindings protect personal data while leaving unrelated fields editable", () => {
  const root = temporary(),
    store = new Store(root);
  try {
    store.preferences.update({ revision: 1, applicantProfile: profile() });
    const app = store.create({ company: "Classic synthetic" });
    store.cv.resolveMod = (id) => ({
      id,
      name: "Classic profile CV",
      digest: "fixture",
      files: { "main.tex": Buffer.from("synthetic") },
      fields: [],
      applicant: {
        fields: { "person.displayName": "name", "person.street": "street" },
        signature: "none",
      },
    });
    store.cv.bind(app.id, app.revision, "classic-profile");
    const state = store.cv.read(app.id);
    assert.equal(state.data.person.displayName, "Erika Muster");
    assert.equal(state.data.person.street, "Straße & Weg 7");
    assert.throws(
      () =>
        store.cv.save(app.id, {
          revision: state.revision,
          fingerprint: state.fingerprint,
          data: {
            ...state.data,
            person: { ...state.data.person, displayName: "Wrong person" },
          },
        }),
      /Bewerberprofil/,
    );
    const saved = store.cv.save(app.id, {
      revision: state.revision,
      fingerprint: state.fingerprint,
      data: {
        ...state.data,
        person: { ...state.data.person, email: "synthetic@example.invalid" },
      },
    });
    assert.equal(saved.data.person.email, "synthetic@example.invalid");
    assert.equal(saved.data.person.displayName, "Erika Muster");
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("required signature blocks the build before queuing; private graphics appear only in the build snapshot", async () => {
  const root = temporary(),
    store = new Store(root);
  const builds = new Builds(store, async () => {
    throw Error("This test inspects snapshots, not PDFs");
  });
  try {
    store.preferences.update({ revision: 1, applicantProfile: profile() });
    const app = store.create({ company: "A" });
    const required = store.cv.forms.install("Signed CV", form("required"), {
      "layout/main.tex": Buffer.from("synthetic"),
    });
    store.cv.bind(app.id, app.revision, required.id);
    assert.throws(
      () => builds.request(app.id, "cv"),
      /benötigt eine Unterschrift/,
    );
    assert.equal(store.builds(app.id).length, 0);
    const uploaded = store.applicantProfiles.uploadSignature(image());
    store.preferences.update({
      revision: store.preferences.settings().revision,
      applicantProfile: { ...profile(), signatureId: uploaded.id },
    });
    assert.throws(() => store.cv.plan(app.id), /benötigt eine Unterschrift/);
    store.applicantProfiles.adopt(app.id, store.app(app.id).revision, true);
    const plan = store.cv.plan(app.id)!;
    assert.deepEqual(
      plan.files["applicant-signature.png"],
      store.applicantProfiles.signature(uploaded.id).png,
    );
    assert.match(
      plan.files["applicant-data.tex"]!.toString(),
      /Straße \\& Weg 7/,
    );
    assert.equal(
      Object.keys(fileMap(store.workspace(app.id))).some((p) =>
        p.includes("applicant-signature"),
      ),
      false,
    );
    assert.equal(store.documents.list().length, 0);
    store.preferences.update({
      revision: store.preferences.settings().revision,
      applicantProfile: profile(),
    });
    assert.deepEqual(
      store.cv.plan(app.id)!.files["applicant-signature.png"],
      plan.files["applicant-signature.png"],
    );
    const unsigned = store.cv.forms.install("Unsigned CV", form("none"), {
      "layout/main.tex": Buffer.from("different synthetic"),
    });
    store.cv.bind(app.id, store.app(app.id).revision, unsigned.id);
    assert.equal(
      store.cv.plan(app.id)!.files["applicant-signature.png"],
      undefined,
    );
    assert.throws(
      () =>
        store.cv.forms.install("Reserved", form("none"), {
          "layout/main.tex": Buffer.from("text"),
          "layout/applicant-data.tex": Buffer.from("do not overwrite"),
        }),
      /Reservierter/,
    );
  } finally {
    await builds.idle();
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
