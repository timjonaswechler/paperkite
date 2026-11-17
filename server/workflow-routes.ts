import type express from "express";
import fs from "node:fs";
import { Store } from "./store.ts";
import { PdfJobs } from "./pdf-jobs.ts";
import { fileMap } from "./files.ts";
export function workflowRoutes(api: express.Router, store: Store, pdfs: PdfJobs, editable: (id: string) => void, available: (id: string) => void) {
  api.patch("/templates/:id", (req, res) => res.json(store.templateLibrary.rename(req.params.id, req.body.label)));
  api.post("/templates/:id/default", (req, res) => res.json(store.templateLibrary.setDefault(req.params.id)));
  api.post("/templates/:id/copy", (req, res) => res.status(201).json(store.templateLibrary.copy(req.params.id, req.body.label)));
  api.delete("/templates/:id", (req, res) => res.json(store.templateLibrary.remove(req.params.id, req.body.digest)));
  api.get("/templates/:id/export", (req, res) => {
    const template = store.templateLibrary.get(req.params.id);
    res.type("application/json").attachment(template.label.replace(/[/\\\x00-\x1f\x7f]/g, "_") + "-vorlage.json").send(JSON.stringify(store.templateLibrary.export(template.id)));
  });
  api.post("/templates/from-application", (req, res) => {
    editable(req.body.source);
    const source = store.app(req.body.source);
    res.status(201).json(store.templateLibrary.fromFiles(fileMap(store.workspace(source.id)), req.body.label, source.profile));
  });
  api.post("/pdf-jobs", (req, res) => {
    if (req.body.appId !== undefined) available(req.body.appId);
    res.status(202).json(pdfs.start(req.body));
  });
  api.get("/pdf-jobs", (_req, res) => res.json(pdfs.list()));
  api.get("/pdf-jobs/:id", (req, res) => res.json(pdfs.get(req.params.id)));
  api.get("/pdf-jobs/:id/file", (req, res) => {
    const job = pdfs.get(req.params.id);
    if (req.query.download === "1") res.attachment(job.label.replace(/[/\\\x00-\x1f\x7f]/g, "_") + ".pdf");
    res.type("application/pdf").send(fs.readFileSync(pdfs.artifact(job.id)));
  });
  api.post("/pdf-jobs/:id/save", (req, res) => res.status(201).json(pdfs.save(req.params.id, req.body)));
  api.get("/applications/:id/pdf-jobs", (req, res) => res.json(pdfs.list(req.params.id)));
  api.get("/applications/:id/pdf-plan", (req, res) => res.json(pdfs.plan(req.params.id)));
  api.put("/applications/:id/pdf-plan", (req, res) => res.json(pdfs.savePlan(req.params.id, req.body)));
}
