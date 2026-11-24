import path from "node:path";
import type { Router, Request } from "express";
import type { NetworkT3Access } from "../t3-access.ts";
import { check } from "../files.ts";
import type { Settings } from "../../shared/api.ts";
import { CvModImports } from "./imports.ts";

export function cvModRoutes(
  api: Router,
  imports: CvModImports,
  access: NetworkT3Access,
  options: {
    prefix?: string;
    prototypeUi?: boolean;
    settings?: () => Settings;
  } = {},
) {
  const prefix = options.prefix || "/cv-mods";
  // Never turn a restricted API token into a broader local CLI identity.
  api.use(prefix, async (req, _res, next) => {
    try {
      const cookies = Object.fromEntries(
        (req.headers.cookie || "").split(";").map((p) => {
          const at = p.indexOf("=");
          return at < 0
            ? ["", ""]
            : [p.slice(0, at).trim(), p.slice(at + 1).trim()];
        }),
      );
      check(
        !req.headers.authorization &&
          cookies[access.cookieName] === (await access.token()),
        "Vorlagen-KI nur über die native Bewerbungs-Websitzung verfügbar",
        403,
      );
      next();
    } catch (e) {
      next(e);
    }
  });
  if (options.prototypeUi) {
    const ui = path.resolve("prototypes/cv-mod-import");
    api.get(prefix, (_req, res) => res.sendFile("index.html", { root: ui }));
    api.get(prefix + "/ui.js", (_req, res) =>
      res.type("text/javascript").sendFile("ui.js", { root: ui }),
    );
    api.get(prefix + "/ui.css", (_req, res) =>
      res.type("text/css").sendFile("ui.css", { root: ui }),
    );
  }
  api.get(prefix + "/library", (_req, res) => {
    const settings = options.settings?.();
    res.json({
      layouts: imports.catalogue(),
      defaults: {
        cv: settings?.defaultCvModId ?? null,
        cover: settings?.defaultCoverModId ?? null,
      },
    });
  });
  api.post(prefix + "/jobs/:id/label", (req, res) =>
    res.json(
      imports.rename(String(req.params.id), req.body.label, req.body.updated),
    ),
  );
  api.get(prefix + "/jobs", (_req, res) => res.json(imports.list()));
  function uploadBytes(req: Request) {
    check(
      typeof req.body.zipBase64 === "string" &&
        req.body.zipBase64.length <= 12 * 1024 * 1024 &&
        /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
          req.body.zipBase64,
        ),
      "Kanonische ZIP-Base64-Daten erwartet",
    );
    const bytes = Buffer.from(req.body.zipBase64, "base64");
    check(
      bytes.toString("base64") === req.body.zipBase64,
      "Nicht kanonische Base64-Daten",
    );
    return bytes;
  }
  api.post(prefix + "/inspect", (req, res) => {
    res.json(imports.inspect(req.body.name, uploadBytes(req)));
  });
  api.post(prefix + "/jobs", (req, res) => {
    const bytes = uploadBytes(req);
    res
      .status(201)
      .json(
        imports.upload(
          req.body.name,
          bytes,
          req.body.documentType,
          req.body.targetFormat ??
            (options.prototypeUi ? "bewerbung-cv-mod-prototype-v1" : undefined),
          { requestId: req.body.requestId, entrypoint: req.body.entrypoint },
        ),
      );
  });
  api.delete(prefix + "/jobs/:id", async (req, res) => {
    await imports.remove(String(req.params.id), req.body.updated);
    res.json({ ok: true });
  });
  api.get(prefix + "/jobs/:id", (req, res) =>
    res.json(imports.get(String(req.params.id))),
  );
  api.get(prefix + "/jobs/:id/original", (req, res) => {
    const original = imports.originalUpload(String(req.params.id));
    res
      .set("Cache-Control", "private, no-store")
      .attachment(path.basename(original.name))
      .send(original.bytes);
  });
  api.get(prefix + "/jobs/:id/source", (req, res) => {
    check(typeof req.query.path === "string", "Dateipfad erwartet");
    res
      .set("Cache-Control", "private, no-store")
      .attachment(path.basename(req.query.path))
      .send(imports.sourceFile(String(req.params.id), req.query.path));
  });
  api.get(prefix + "/jobs/:id/provenance", (req, res) => {
    check(
      req.query.version === undefined || typeof req.query.version === "string",
      "Version erwartet",
    );
    res
      .set("Cache-Control", "private, no-store")
      .json(imports.provenance(String(req.params.id), req.query.version));
  });
  api.get(prefix + "/jobs/:id/diff", (req, res) => {
    check(
      typeof req.query.path === "string" &&
        (req.query.version === undefined ||
          typeof req.query.version === "string"),
      "Dateipfad und Version erwartet",
    );
    res
      .set("Cache-Control", "private, no-store")
      .json(
        imports.difference(
          String(req.params.id),
          req.query.path,
          req.query.version,
        ),
      );
  });
  api.post(prefix + "/jobs/:id/source", (req, res) =>
    res.json(
      imports.selectSource(
        String(req.params.id),
        req.body.entrypoint,
        req.body.updated,
      ),
    ),
  );
  api.post(prefix + "/jobs/:id/approve", (req, res) =>
    res.json(
      imports.approve(
        String(req.params.id),
        req.body.versionId,
        req.body.updated,
      ),
    ),
  );
  api.post(prefix + "/jobs/:id/start", (req, res) =>
    res.status(202).json(imports.start(String(req.params.id))),
  );
  api.post(prefix + "/jobs/:id/check", (req, res) =>
    res.status(202).json(imports.recheck(String(req.params.id))),
  );
  api.get(prefix + "/jobs/:id/pdf/:case", (req, res) =>
    res
      .type("application/pdf")
      .sendFile(
        imports.artifact(String(req.params.id), String(req.params.case)),
        {
          dotfiles: "allow",
        },
      ),
  );
}
export function cvModPrototypeRoutes(
  api: Router,
  imports: CvModImports,
  access: NetworkT3Access,
) {
  cvModRoutes(api, imports, access, {
    prefix: "/prototype/cv-mods",
    prototypeUi: true,
  });
}
