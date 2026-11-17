import express from "express";
import fs from "node:fs";
import { zipSync } from "fflate";
import { Store } from "./store.ts";
import { Builds } from "./builds.ts";
import { DOCUMENT_LIMIT } from "./documents.ts";
import { check, HttpError } from "./files.ts";

export function organizationRoutes(
  api: express.Router,
  store: Store,
  builds: Builds,
) {
  api.get("/settings", (_req, res) => res.json(store.preferences.settings()));
  api.put("/settings", (req, res) =>
    res.json(store.preferences.update(req.body)),
  );
  api.get("/ui-state", (_req, res) => res.json(store.preferences.ui()));
  api.post("/applications/:id/open", (req, res) => {
    store.app(req.params.id);
    res.json(store.preferences.open(req.params.id));
  });
  api.post("/applications/:id/close", (req, res) => {
    store.app(req.params.id);
    res.json(store.preferences.close(req.params.id));
  });
  api.get("/applications/:id/draft", (req, res) => {
    store.app(req.params.id);
    res.json(store.preferences.draft(req.params.id));
  });
  api.put("/applications/:id/draft", (req, res) => {
    store.app(req.params.id);
    res.json(store.preferences.saveDraft(req.params.id, req.body.text));
  });
  api.get("/search", (req, res) =>
    res.json(store.search(req.query.q ?? "", req.query.status)),
  );
  api.get("/documents", (req, res) => res.json(store.documents.list(req.query.tag)));
  api.post(
    "/documents",
    express.raw({ type: "application/octet-stream", limit: DOCUMENT_LIMIT }),
    (req, res) => {
      check(
        req.is("application/octet-stream"),
        "Datei als application/octet-stream hochladen",
        415,
      );
      let name: string;
      try {
        name = decodeURIComponent(req.get("X-Bewerbung-Filename") || "");
      } catch {
        throw new HttpError(400, "Ungültiger Dateiname");
      }
      res.status(201).json(store.documents.upload(name, req.body));
    },
  );
  api.patch("/documents/:id", (req, res) =>
    res.json(store.documents.update(req.params.id, req.body)),
  );
  api.delete("/documents/:id", (req, res) =>
    res.json(store.documents.remove(req.params.id)),
  );
  api.get("/documents/:id/file", (req, res) => {
    const document = store.documents.get(req.params.id);
    if (req.query.download === "1") res.attachment(document.name);
    res.type(document.mime).send(store.documents.bytes(document.id));
  });
  api.get("/applications/:id/package", (req, res) => {
    const id = req.params.id;
    store.app(id);
    const files = store.documents.files(id);
    const history = store.builds(id);
    for (const [kind, name] of [
      ["cv", "Lebenslauf.pdf"],
      ["cover", "Anschreiben.pdf"],
    ] as const) {
      const build = history.find(
        (entry) => entry.kind === kind && entry.status === "success",
      );
      if (build)
        files[name] = fs.readFileSync(builds.artifact(id, String(build.id)));
    }
    check(
      Object.keys(files).length,
      "Noch keine Unterlagen vorhanden. PDFs bauen oder Anlagen auswählen.",
      409,
    );
    res
      .type("application/zip")
      .attachment("bewerbungsunterlagen.zip")
      .send(Buffer.from(zipSync(files, { level: 1 })));
  });
}
