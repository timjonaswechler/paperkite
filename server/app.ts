import express from "express";
import fs from "node:fs";
import path from "node:path";
import { zipSync } from "fflate";
import { Store } from "./store.ts";
import { Builds, type Runner } from "./builds.ts";
import { Harness } from "./harness.ts";
import { check, fileMap, HttpError, JSON_LIMIT } from "./files.ts";
import { parseProfile, serializeProfile, type Profile } from "./lua-profile.ts";
import { organizationRoutes } from "./organization-routes.ts";
import { workflowRoutes } from "./workflow-routes.ts";
import { PdfJobs } from "./pdf-jobs.ts";
import { Deliveries } from "./deliveries.ts";
import type { PdfRunner } from "./pdf-runner.ts";
import type { ApplicationChatProjects } from "./t3-projects.ts";
import { analyzePosting, type AnalysisRunner } from "./job-postings.ts";

type AppOptions = {
  extraHosts?: string[];
  nativeChat?: (store: Store) => ApplicationChatProjects;
  analysisRunner?: AnalysisRunner;
  configureApi?: (api: express.Router) => void;
};

export function createApp(
  root: string,
  runner: Runner,
  port = 3119,
  pdfRunner?: PdfRunner,
  options: AppOptions = {},
) {
  const store = new Store(root),
    web = express();
  const streams = new Map<string, Set<express.Response>>();
  const publish = (app: string, event: unknown) => {
    for (const res of streams.get(app) || [])
      res.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  const builds = new Builds(store, runner, (app) =>
    publish(app, { type: "build" }),
  );
  const harness = new Harness(store, publish);
  const pdfs = new PdfJobs(store, builds, pdfRunner, (app) =>
    publish(app, { type: "pdf" }),
  );
  const deliveries = new Deliveries(store, builds, pdfs, (app) =>
    publish(app, { type: "delivery" }),
  );
  const nativeChat = options.nativeChat?.(store);
  const deleting = new Set<string>(),
    openingNative = new Map<string, number>();
  const harnessStatus = (id: string) => ({
    ...harness.status(id),
    busy: harness.busy(id) || Boolean(nativeChat?.busy(id)),
  });
  const available = (id: string) => {
    check(
      typeof id === "string" && /^[a-f0-9-]{36}$/.test(id),
      "Ungültige Bewerbungs-ID",
    );
    store.app(id);
    check(!deleting.has(id), "Bewerbung wird gerade gelöscht", 409);
  };
  const editable = (id: string) => {
    available(id);
    check(
      !harness.busy(id) && !nativeChat?.busy(id),
      "Agent arbeitet. Erst stoppen oder abwarten.",
      409,
    );
  };
  const allowedHosts = new Set([
    `127.0.0.1:${port}`,
    `localhost:${port}`,
    "srv.devices.teejayslab.de",
    ...(options.extraHosts || []),
  ]);
  web.disable("x-powered-by");
  web.enable("strict routing");
  web.use((req, res, next) => {
    if (!allowedHosts.has(req.headers.host || ""))
      return res.status(403).json({ error: "Host nicht erlaubt" });
    res.set({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "same-origin",
      "Cache-Control": "no-store",
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'self'; frame-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'",
    });
    const origin = req.headers.origin;
    const expected =
      req.headers.host?.startsWith("127.0.0.1:") ||
      req.headers.host?.startsWith("localhost:")
        ? `http://${req.headers.host}`
        : `https://${req.headers.host}`;
    if (origin && origin !== expected)
      return res.status(403).json({ error: "Origin nicht erlaubt" });
    if (req.headers["sec-fetch-site"] === "cross-site")
      return res.status(403).json({ error: "Cross-Site gesperrt" });
    if (!["GET", "HEAD"].includes(req.method)) {
      const contentType = req.headers["content-type"]?.split(";")[0];
      const documentUpload =
        req.method === "POST" &&
        req.path === "/bewerbung/api/documents" &&
        contentType === "application/octet-stream";
      if (
        (!documentUpload && contentType !== "application/json") ||
        req.headers["x-bewerbung-request"] !== "1"
      )
        return res.status(415).json({
          error:
            "Passender Content-Type und X-Bewerbung-Request: 1 erforderlich",
        });
    }
    next();
  });
  web.use(express.json({ limit: JSON_LIMIT, strict: true }));
  const api = express.Router();
  api.use((req, _res, next) => {
    if (!["GET", "HEAD"].includes(req.method) && req.is("application/json"))
      check(
        req.body && typeof req.body === "object" && !Array.isArray(req.body),
        "JSON-Objekt erwartet",
      );
    next();
  });
  api.use("/applications/:id", (req, _res, next) => {
    check(!deleting.has(req.params.id), "Bewerbung wird gerade gelöscht", 409);
    next();
  });
  web.use("/bewerbung/api", api);
  if (nativeChat)
    api.use("/applications/:id", (req, res, next) => {
      if (
        req.method === "POST" &&
        /^\/(?:models|prompt|interrupt|approvals(?:\/|$))/.test(req.path)
      )
        return res.status(410).json({
          error:
            "Der frühere Chat wurde durch den vollständigen T3-Chat ersetzt. Bitte die neue Oberfläche öffnen.",
        });
      next();
    });
  if (nativeChat)
    api.use((req, _res, next) => {
      if (["GET", "HEAD"].includes(req.method) && req.path === "/health")
        return next();
      const read =
        ["GET", "HEAD"].includes(req.method) ||
        (req.method === "POST" &&
          /^\/applications\/[^/]+\/t3-project$/.test(req.path));
      void nativeChat
        .authorize({ headers: req.headers }, read ? "read" : "write")
        .then(() => next(), next);
    });
  const analyses = new Set<AbortController>();
  api.post("/job-analysis", async (req, res) => {
    check(
      analyses.size < 2,
      "Es laufen bereits zwei Stellenanalysen. Bitte kurz warten.",
      429,
    );
    const nativeAnalyze = nativeChat?.analyze;
    check(
      options.analysisRunner || nativeAnalyze,
      "Stellenanalyse ist noch nicht verfügbar. Bitte Angaben manuell ergänzen.",
      503,
    );
    const controller = new AbortController();
    analyses.add(controller);
    const cancel = () => controller.abort();
    res.once("close", cancel);
    try {
      const run: AnalysisRunner =
        options.analysisRunner ??
        ((input, signal) =>
          nativeChat!.analyze!(input, { headers: req.headers }, signal));
      const result = await analyzePosting(
        req.body,
        store.preferences.settings().analysisModel,
        run,
        AbortSignal.any([controller.signal, AbortSignal.timeout(120_000)]),
      );
      if (!controller.signal.aborted) res.json(result);
    } finally {
      analyses.delete(controller);
      res.off("close", cancel);
    }
  });
  organizationRoutes(api, store, builds);
  workflowRoutes(api, store, pdfs, editable, available, deliveries);
  api.get("/cv-form-mods", (_req, res) => res.json(store.cv.forms.list()));
  api.get("/applications/:id/cv-data", (req, res) =>
    res.json(store.cv.read(req.params.id)),
  );
  api.put("/applications/:id/cv-data", (req, res) => {
    editable(req.params.id);
    res.json(store.cv.save(req.params.id, req.body));
  });
  api.put("/applications/:id/cv-mod", (req, res) => {
    editable(req.params.id);
    res.json(store.cv.bind(req.params.id, req.body.revision, req.body.modId));
  });
  api.get("/health", (_req, res) =>
    res.json({
      ok: true,
      activeAnalyses: analyses.size,
      pdfProcessing: pdfs.available,
      ...(nativeChat ? { nativeChat: true } : {}),
      storage: "SQLite + lokale Dateien",
      templateImported: store.templates().length > 0,
      harnesses: nativeChat
        ? []
        : [
            {
              id: "pi",
              available: true,
              auth: "Erst mit Modellanfrage geprüft",
              policy: "Dokumentwerkzeuge mit Einzelfreigabe",
            },
            {
              id: "codex",
              available: true,
              auth: "Native Anmeldung; Modellanfrage erforderlich",
              policy:
                "Nur Dokumentwerkzeuge, Schreiben mit Einzelfreigabe; keine Sandbox-Erweiterung",
            },
          ],
    }),
  );
  api.get("/templates", (_req, res) => res.json(store.templates()));
  api.post("/templates/import", (req, res) =>
    res.status(201).json(store.import(req.body)),
  );
  if (nativeChat)
    api.get("/navigation", async (req, res) =>
      res.json(await nativeChat.navigation({ headers: req.headers })),
    );
  api.get("/applications", (_req, res) => {
    if (nativeChat) for (const app of store.list()) nativeChat.busy(app.id);
    res.json(store.list());
  });
  api.post("/applications", (req, res) => {
    check(
      typeof req.body.company === "string" &&
        req.body.company.trim().length > 0 &&
        typeof req.body.role === "string" &&
        req.body.role.trim().length > 0,
      "Unternehmen und Rolle sind erforderlich",
    );
    for (const key of ["source", "cvSource", "coverSource"] as const) {
      if (req.body[key]) {
        check(typeof req.body[key] === "string", "Ungültige Quelle: " + key);
        editable(req.body[key]);
      }
    }
    const application = store.create(req.body);
    store.preferences.open(application.id);
    res.status(201).json(application);
  });
  api.get("/applications/:id", (req, res) => {
    const status = harnessStatus(req.params.id);
    res.json({
      ...store.app(req.params.id),
      files: store.files(req.params.id),
      documents: store.documents.selected(req.params.id),
      builds: builds.history(req.params.id),
      documentStatus: builds.documentStatus(req.params.id),
      harness: status,
    });
  });
  if (nativeChat)
    api.post("/applications/:id/t3-project", async (req, res) => {
      available(req.params.id);
      openingNative.set(
        req.params.id,
        (openingNative.get(req.params.id) || 0) + 1,
      );
      try {
        res.json(
          await nativeChat.ensure(req.params.id, { headers: req.headers }),
        );
      } finally {
        const remaining = (openingNative.get(req.params.id) || 1) - 1;
        if (remaining) openingNative.set(req.params.id, remaining);
        else openingNative.delete(req.params.id);
      }
    });
  api.delete("/applications/:id", async (req, res) => {
    editable(req.params.id);
    check(!openingNative.has(req.params.id), "Chat wird gerade geöffnet", 409);
    check(
      harness.status(req.params.id).pending.length === 0,
      "Offene Freigabe zuerst beantworten",
      409,
    );
    check(
      store.app(req.params.id).revision === req.body.revision,
      "Inzwischen geändert. Neu laden.",
      409,
    );
    check(
      !store
        .builds(req.params.id)
        .some(
          (build) => build.status === "queued" || build.status === "running",
        ) && !pdfs.busy(req.params.id),
      "PDF-Auftrag läuft noch. Bitte abwarten.",
      409,
    );
    deleting.add(req.params.id);
    try {
      await harness.closeApp(req.params.id);
      await nativeChat?.remove(req.params.id, { headers: req.headers });
      store.remove(req.params.id, req.body.revision);
      for (const stream of streams.get(req.params.id) || []) stream.end();
      streams.delete(req.params.id);
      res.json({ ok: true, ui: store.preferences.ui() });
    } finally {
      deleting.delete(req.params.id);
    }
  });
  api.patch("/applications/:id", (req, res) => {
    editable(req.params.id);
    res.json(store.update(req.params.id, req.body));
  });
  api.get("/applications/:id/file", (req, res) => {
    nativeChat?.busy(req.params.id);
    res.setHeader(
      "X-Bewerbung-Revision",
      String(store.app(req.params.id).revision),
    );
    const name = String(req.query.path || "");
    const bytes = store.read(req.params.id, name);
    res.type("text/plain; charset=utf-8");
    if (req.query.download === "1") res.attachment(path.basename(name));
    res.send(bytes);
  });
  api.put("/applications/:id/file", (req, res) => {
    editable(req.params.id);
    res.json(
      store.save(
        req.params.id,
        req.body.path,
        req.body.content,
        req.body.revision,
      ),
    );
  });
  api.post("/applications/:id/reuse", (req, res) => {
    editable(req.params.id);
    editable(req.body.source);
    res.json(
      store.reuse(
        req.params.id,
        req.body.source,
        req.body.files,
        req.body.revision,
      ),
    );
  });
  api.get("/applications/:id/cover-letter", (req, res) =>
    res.json(store.cover.read(req.params.id)),
  );
  api.put("/applications/:id/cover-letter", (req, res) => {
    editable(req.params.id);
    res.json(store.cover.save(req.params.id, req.body));
  });
  api.put("/applications/:id/cover-mod", (req, res) => {
    editable(req.params.id);
    res.json(store.cover.bind(req.params.id, req.body));
  });
  api.put("/applications/:id/profile", (req, res) => {
    editable(req.params.id);
    const target = store.profile(req.params.id, req.body.path);
    let nodes = 0;
    const valid = (value: unknown, depth: number): boolean =>
      ++nodes <= 10_000 &&
      depth <= 16 &&
      (typeof value === "string" ||
        typeof value === "boolean" ||
        (typeof value === "number" && Number.isFinite(value)) ||
        (value !== null &&
          typeof value === "object" &&
          Object.values(value).every((child) => valid(child, depth + 1))));
    check(
      valid(req.body.entries, 0) &&
        req.body.entries &&
        typeof req.body.entries === "object" &&
        !Array.isArray(req.body.entries),
      "Ungültige Lebenslaufdaten",
    );
    const content = serializeProfile(req.body.entries as Profile);
    parseProfile(content);
    res.json(
      store.save(req.params.id, target.path, content, req.body.revision),
    );
  });
  api.get("/applications/:id/profile", (req, res) => {
    editable(req.params.id);
    res.json(store.profile(req.params.id, req.query.path));
  });
  api.post("/applications/:id/reuse-entries", (req, res) => {
    editable(req.params.id);
    editable(req.body.source);
    res.json(store.reuseEntries(req.params.id, req.body));
  });
  api.get("/applications/:id/download", (req, res) => {
    res
      .type("application/zip")
      .attachment("bewerbung-quellen.zip")
      .send(Buffer.from(zipSync(fileMap(store.workspace(req.params.id)))));
  });
  api.post("/applications/:id/builds", (req, res) => {
    editable(req.params.id);
    res.status(202).json(builds.request(req.params.id, req.body.kind));
  });
  api.get("/applications/:id/builds/:build/log", (req, res) =>
    res
      .type("text/plain")
      .send(store.build(req.params.id, req.params.build).log),
  );
  api.get("/applications/:id/builds/:build/pdf", (req, res) => {
    res.type("application/pdf");
    res.set(
      "Content-Disposition",
      `${req.query.download === "1" ? "attachment" : "inline"}; filename="${store.build(req.params.id, req.params.build).kind}.pdf"`,
    );
    res.sendFile(builds.artifact(req.params.id, req.params.build));
  });
  api.get("/applications/:id/builds/:build/zip", (req, res) => {
    builds.artifact(req.params.id, req.params.build);
    const dir = path.join(store.root, "builds", req.params.build);
    const files = builds.inputFiles(req.params.id, req.params.build);
    res
      .type("application/zip")
      .attachment("bewerbung-build.zip")
      .send(
        Buffer.from(
          zipSync({
            ...files,
            ...store.documents.snapshotFiles(req.params.build),
            "document.pdf": fs.readFileSync(
              builds.artifact(req.params.id, req.params.build),
            ),
            "build.log": Buffer.from(
              String(store.build(req.params.id, req.params.build).log),
            ),
          }),
        ),
      );
  });
  api.delete("/applications/:id/builds/:build", (req, res) => {
    editable(req.params.id);
    res.json(builds.remove(req.params.id, req.params.build));
  });
  api.post("/applications/:id/builds/:build/finalize", (req, res) =>
    res.json(builds.finalize(req.params.id, req.params.build)),
  );
  api.get("/applications/:id/events", (req, res) =>
    res.json(store.events(req.params.id, Number(req.query.after) || 0)),
  );
  api.get("/applications/:id/stream", (req, res) => {
    store.app(req.params.id);
    res.set({
      "Content-Type": "text/event-stream",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    const set = streams.get(req.params.id) || new Set();
    set.add(res);
    streams.set(req.params.id, set);
    res.write(
      `data: ${JSON.stringify({ type: "connected", harness: harnessStatus(req.params.id) })}\n\n`,
    );
    const heartbeat = setInterval(() => res.write(": keepalive\n\n"), 20000);
    req.on("close", () => {
      clearInterval(heartbeat);
      set.delete(res);
      if (!set.size) streams.delete(req.params.id);
    });
  });
  api.post("/applications/:id/models", async (req, res) =>
    res.json(await harness.models(req.params.id, req.body.provider)),
  );
  api.post("/applications/:id/prompt", async (req, res) => {
    const result = await harness.prompt(
      req.params.id,
      req.body.text,
      req.body.model,
      req.body.provider,
    );
    store.preferences.saveDraft(req.params.id, "");
    res.status(202).json(result);
  });
  api.post("/applications/:id/interrupt", async (req, res) =>
    res.json(await harness.interrupt(req.params.id)),
  );
  api.post("/applications/:id/approvals/:approval", async (req, res) => {
    await harness.approve(req.params.id, req.params.approval, req.body.allow);
    res.json({ ok: true });
  });
  options.configureApi?.(api);
  api.use((_req, res) => res.status(404).json({ error: "API nicht gefunden" }));
  web.get("/bewerbung", (_req, res) => res.redirect(308, "/bewerbung/"));
  web.use("/bewerbung", express.static(path.resolve("dist"), { index: false }));
  web.get(
    [
      "/bewerbung/",
      "/bewerbung/applications/:id",
      "/bewerbung/settings",
      "/bewerbung/settings/:section",
      "/bewerbung/documents",
    ],
    (_req, res) => res.sendFile("index.html", { root: path.resolve("dist") }),
  );
  web.use((_req, res) => res.status(404).json({ error: "Nicht gefunden" }));
  web.use(
    (
      e: Error & { status?: number },
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      res
        .status(e instanceof HttpError ? e.status : e.status || 500)
        .json({ error: e.message });
    },
  );
  return {
    web,
    store,
    builds,
    harness,
    pdfs,
    deliveries,
    close: async () => {
      for (const set of streams.values()) for (const res of set) res.end();
      for (const controller of analyses) controller.abort();
      await deliveries.idle();
      await harness.close();
      await builds.idle();
      await pdfs.idle();
      store.close();
    },
  };
}
