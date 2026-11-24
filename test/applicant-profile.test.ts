import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../server/store.ts";
import {
  applicantVariables,
  emptyApplicantProfile,
} from "../shared/applicant-profile.ts";

const temporary = () =>
  fs.mkdtempSync(path.join(os.tmpdir(), "paperkite-profile-"));
const signature = (filter = 0) =>
  fs.readFileSync(
    new URL(
      `./fixtures/applicant-signatures/rgba-filter-${filter}.png`,
      import.meta.url,
    ),
  );
const candidate = () => ({
  ...emptyApplicantProfile(),
  firstName: "Erika",
  lastName: "Muster",
  street: "Straße & Weg 7",
  addressLine2: "c/o Beispiel",
  postalCode: "01067",
  city: "Dresden",
  country: "Deutschland",
});

test("one profile drives the legacy name alias and survives reopening; old names are not guessed into surnames", () => {
  const root = temporary();
  let store = new Store(root);
  try {
    store.preferences.update({
      revision: 1,
      applicantName: "Vorhandener voller Name",
    });
    const legacy = store.preferences.settings() as unknown as Record<
      string,
      unknown
    >;
    delete legacy.applicantProfile;
    store.db
      .prepare("UPDATE preferences SET value=?")
      .run(JSON.stringify(legacy));
    store.close();
    store = new Store(root);
    assert.equal(
      store.preferences.settings().applicantProfile.firstName,
      "Vorhandener voller Name",
    );
    assert.equal(store.preferences.settings().applicantProfile.lastName, "");
    const profile = candidate();
    const saved = store.preferences.update({
      revision: store.preferences.settings().revision,
      applicantProfile: profile,
    });
    assert.equal(saved.applicantName, "Erika Muster");
    assert.deepEqual(applicantVariables(saved.applicantProfile), {
      firstName: "Erika",
      lastName: "Muster",
      street: "Straße & Weg 7",
      addressLine2: "c/o Beispiel",
      postalCode: "01067",
      city: "Dresden",
      country: "Deutschland",
      name: "Erika Muster",
      address: "Straße & Weg 7\nc/o Beispiel\n01067 Dresden\nDeutschland",
      sender:
        "Erika Muster\nStraße & Weg 7\nc/o Beispiel\n01067 Dresden\nDeutschland",
    });
    store.close();
    store = new Store(root);
    assert.deepEqual(store.preferences.settings(), saved);
    assert.throws(
      () =>
        store.preferences.update({
          revision: saved.revision,
          applicantProfile: profile,
          applicantName: "Different person",
        }),
      /Widersprüchliche/,
    );
    assert.throws(
      () =>
        store.preferences.update({
          revision: saved.revision,
          applicantProfile: { ...profile, city: "City\n\\input{secret}" },
        }),
      /Profilfeld/,
    );
    assert.throws(
      () =>
        store.preferences.update({
          revision: saved.revision,
          applicantProfile: { ...profile, signatureId: "0".repeat(64) },
        }),
      /nicht gefunden/,
    );
    assert.deepEqual(store.preferences.settings(), saved);
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("signatures are normalized, deduplicated, private to the profile store and retained for frozen applications", () => {
  const root = temporary(),
    store = new Store(root);
  try {
    const first = store.applicantProfiles.uploadSignature(signature(0));
    assert.deepEqual(
      store.applicantProfiles.uploadSignature(signature(4)),
      first,
    );
    assert.equal(
      store.db.prepare("SELECT count(*) AS n FROM applicant_signatures").get()!
        .n,
      1,
    );
    assert.equal(store.documents.list().length, 0);
    const profile = { ...candidate(), signatureId: first.id };
    store.preferences.update({
      revision: store.preferences.settings().revision,
      applicantProfile: profile,
    });
    const app = store.create({ company: "SYNTHETIC A", role: "Engineer" });
    const original = store.read(app.id, "application.json");
    assert.deepEqual(store.applicantProfiles.snapshot(app.id), profile);
    store.preferences.update({
      revision: store.preferences.settings().revision,
      applicantProfile: {
        ...profile,
        street: "Neue Straße 9",
        signatureId: null,
      },
    });
    assert.deepEqual(store.applicantProfiles.snapshot(app.id), profile);
    assert.deepEqual(store.read(app.id, "application.json"), original);
    assert.equal(store.applicantProfiles.read(app.id).outdated, true);
    assert.equal(
      store.applicantProfiles
        .signature(first.id)
        .png.includes(Buffer.from("synthetic metadata")),
      false,
    );
    const copy = store.create({ source: app.id });
    assert.deepEqual(store.applicantProfiles.snapshot(copy.id), profile);
    assert.equal(
      store.applicantProfiles.snapshot(store.create({ company: "B" }).id)!
        .street,
      "Neue Straße 9",
    );
    assert.throws(
      () => store.applicantProfiles.adopt(app.id, app.revision - 1),
      /inzwischen geändert/,
    );
    const adopted = store.applicantProfiles.adopt(app.id, app.revision);
    assert.equal(adopted.outdated, false);
    assert.equal(store.app(app.id).revision, app.revision + 1);
    assert.deepEqual(store.applicantProfiles.snapshot(copy.id), profile);
    store.applicantProfiles.adopt(app.id, store.app(app.id).revision);
    assert.equal(
      store.app(app.id).revision,
      app.revision + 1,
      "Identical adoption is a no-op",
    );
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("profile adoption rolls back the frozen profile, application revision and workspace bytes after a projection failure", () => {
  const root = temporary(),
    store = new Store(root);
  try {
    store.preferences.update({ revision: 1, applicantProfile: candidate() });
    const app = store.create({ company: "SYNTHETIC rollback" });
    const original = store.read(app.id, "application.json");
    const frozen = store.applicantProfiles.snapshot(app.id);
    store.preferences.update({
      revision: store.preferences.settings().revision,
      applicantProfile: { ...candidate(), city: "Changed city" },
    });
    let calls = 0;
    store.onWorkspaceCommit = () => {
      if (++calls === 1) throw Error("synthetic projection failure");
    };
    assert.throws(
      () => store.applicantProfiles.adopt(app.id, app.revision),
      /synthetic projection failure/,
    );
    assert.equal(calls, 2);
    assert.deepEqual(store.applicantProfiles.snapshot(app.id), frozen);
    assert.deepEqual(store.app(app.id), app);
    assert.deepEqual(store.read(app.id, "application.json"), original);
    assert.equal(
      store.preferences.settings().applicantProfile.city,
      "Changed city",
    );
    store.onWorkspaceCommit = undefined;
    assert.equal(
      store.applicantProfiles.adopt(app.id, app.revision).profile!.city,
      "Changed city",
    );
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("old applications stay unbound; explicit signature adoption preserves their frozen personal data and respects sent/read-only state", () => {
  const root = temporary(),
    store = new Store(root);
  try {
    store.preferences.update({
      revision: store.preferences.settings().revision,
      applicantProfile: candidate(),
    });
    const app = store.create({ company: "A" });
    store.db
      .prepare("DELETE FROM application_applicant_profiles WHERE app=?")
      .run(app.id);
    assert.equal(store.applicantProfiles.read(app.id).profile, null);
    store.applicantProfiles.adopt(app.id, app.revision);
    const saved = store.applicantProfiles.snapshot(app.id)!;
    const image = store.applicantProfiles.uploadSignature(signature());
    store.preferences.update({
      revision: store.preferences.settings().revision,
      applicantProfile: {
        ...candidate(),
        city: "Hamburg",
        signatureId: image.id,
      },
    });
    store.applicantProfiles.adopt(app.id, store.app(app.id).revision, true);
    assert.deepEqual(store.applicantProfiles.snapshot(app.id), {
      ...saved,
      signatureId: image.id,
    });
    store.update(app.id, {
      revision: store.app(app.id).revision,
      status: "Gesendet",
    });
    assert.throws(
      () => store.applicantProfiles.adopt(app.id, store.app(app.id).revision),
      /schreibgeschützt/,
    );
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
