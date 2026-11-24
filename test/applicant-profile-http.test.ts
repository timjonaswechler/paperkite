import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { once } from "node:events";
import { createApp } from "../server/app.ts";
import { emptyApplicantProfile } from "../shared/applicant-profile.ts";
import type {
  Settings,
  SignatureInfo,
  ApplicationDetail,
  ApplicationApplicantProfile,
} from "../shared/api.ts";

test("profile/signature API preserves request guards, validates assets and adopts only explicitly", async () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "paperkite-profile-http-"),
  );
  const app = createApp(
    root,
    async () => {
      throw Error("No builds in this test");
    },
    0,
    undefined,
    { extraHosts: ["profile.test"] },
  );
  const server = app.web.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as { port: number }).port;
  const request = <T = unknown>(
    route: string,
    method = "GET",
    data?: Buffer | object,
    headers: Record<string, string> = {},
  ) =>
    new Promise<{
      status: number;
      headers: http.IncomingHttpHeaders;
      bytes: Buffer;
      json: () => T;
    }>((resolve, reject) => {
      const body =
        data === undefined
          ? undefined
          : Buffer.isBuffer(data)
            ? data
            : Buffer.from(JSON.stringify(data));
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port,
          path: "/bewerbung/api" + route,
          method,
          headers: {
            Host: "profile.test",
            Origin: "https://profile.test",
            "X-Bewerbung-Request": "1",
            ...(body
              ? {
                  "Content-Type": Buffer.isBuffer(data)
                    ? "image/png"
                    : "application/json",
                  "Content-Length": String(body.length),
                }
              : {}),
            ...headers,
          },
        },
        (res) => {
          const parts: Buffer[] = [];
          res.on("data", (b) => parts.push(b));
          res.on("end", () => {
            const bytes = Buffer.concat(parts);
            resolve({
              status: res.statusCode!,
              headers: res.headers,
              bytes,
              json: () => JSON.parse(bytes.toString()),
            });
          });
          res.on("error", reject);
        },
      );
      req.on("error", reject);
      req.end(body);
    });
  try {
    const image = fs.readFileSync(
      new URL(
        "./fixtures/applicant-signatures/rgba-filter-0.png",
        import.meta.url,
      ),
    );
    assert.equal(
      (
        await request("/applicant-signatures", "POST", image, {
          "X-Bewerbung-Request": "",
        })
      ).status,
      415,
    );
    assert.equal(
      (
        await request("/applicant-signatures", "POST", image, {
          Origin: "https://foreign.test",
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await request(
          "/applicant-signatures",
          "POST",
          Buffer.from("<svg></svg>"),
        )
      ).status,
      400,
    );
    assert.equal(
      app.store.db
        .prepare("SELECT count(*) AS n FROM applicant_signatures")
        .get()!.n,
      0,
    );
    const uploaded = await request<SignatureInfo>(
      "/applicant-signatures",
      "POST",
      image,
    );
    assert.equal(uploaded.status, 201);
    const asset = uploaded.json();
    const download = await request("/applicant-signatures/" + asset.id);
    assert.equal(download.status, 200);
    assert.match(String(download.headers["content-type"]), /^image\/png/);
    assert.equal(download.headers["cache-control"], "no-store");
    assert.equal(download.headers["x-content-type-options"], "nosniff");
    assert.equal(
      download.bytes.includes(Buffer.from("synthetic metadata")),
      false,
    );
    assert.equal(
      (
        await request("/applicant-signatures/" + asset.id, "GET", undefined, {
          "Sec-Fetch-Site": "cross-site",
        })
      ).status,
      403,
    );
    assert.equal(
      (await request("/applicant-signatures/" + "0".repeat(64))).status,
      404,
    );
    assert.equal(
      (await request("/applicant-signatures/%2e%2e%2fsecret")).status,
      404,
    );
    const before = (await request<Settings>("/settings")).json();
    const profile = {
      ...emptyApplicantProfile(),
      firstName: "API",
      lastName: "Applicant",
      street: "Example 17",
      postalCode: "00123",
      city: "Bonn",
      signatureId: asset.id,
    };
    const saved = await request<Settings>("/settings", "PUT", {
      revision: before.revision,
      applicantProfile: profile,
    });
    assert.equal(saved.status, 200);
    assert.equal(saved.json().applicantName, "API Applicant");
    const created = await request<ApplicationDetail>("/applications", "POST", {
      company: "SYNTHETIC Company",
      role: "SYNTHETIC Role",
    });
    assert.equal(created.status, 201);
    const application = created.json();
    assert.deepEqual(
      (
        await request<ApplicationApplicantProfile>(
          `/applications/${application.id}/applicant-profile`,
        )
      ).json().profile,
      profile,
    );
    const changed = { ...profile, city: "Köln", signatureId: null };
    assert.equal(
      (
        await request("/settings", "PUT", {
          revision: saved.json().revision,
          applicantProfile: changed,
        })
      ).status,
      200,
    );
    assert.deepEqual(
      (
        await request<ApplicationApplicantProfile>(
          `/applications/${application.id}/applicant-profile`,
        )
      ).json().profile,
      profile,
    );
    assert.equal(
      (
        await request(
          `/applications/${application.id}/applicant-profile`,
          "POST",
          { revision: 0 },
        )
      ).status,
      409,
    );
    for (const invalid of [
      [],
      { revision: application.revision, profile: changed },
      { revision: application.revision, signatureOnly: "yes" },
    ]) {
      assert.equal(
        (
          await request(
            `/applications/${application.id}/applicant-profile`,
            "POST",
            invalid,
          )
        ).status,
        400,
      );
    }
    const applied = await request<ApplicationApplicantProfile>(
      `/applications/${application.id}/applicant-profile`,
      "POST",
      { revision: application.revision },
    );
    assert.equal(applied.status, 200);
    assert.deepEqual(applied.json().profile, changed);
    app.store.update(application.id, {
      revision: applied.json().revision,
      status: "Gesendet",
    });
    assert.equal(
      (
        await request(
          `/applications/${application.id}/applicant-profile`,
          "POST",
          { revision: app.store.app(application.id).revision },
        )
      ).status,
      409,
    );
    assert.deepEqual(
      app.store.applicantProfiles.snapshot(application.id),
      changed,
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await app.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
