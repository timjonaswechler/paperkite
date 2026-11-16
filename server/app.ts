import express from "express";
import fs from "node:fs";
import path from "node:path";
import { zipSync } from "fflate";
import { Store } from "./store.ts";
import { Builds, type Runner } from "./builds.ts";
import { Harness } from "./harness.ts";
import { check, fileMap, HttpError, JSON_LIMIT } from "./files.ts";
import { organizationRoutes } from "./organization-routes.ts";

export function createApp(root: string, runner: Runner, port = 3119) {
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
  const editable = (id: string) => {
    store.app(id);
    check(
      !harness.busy(id),
      "Agent arbeitet. Erst stoppen oder abwarten.",
      409,
    );
  };
  const allowedHosts = new Set([
    `127.0.0.1:${port}`,
    `localhost:${port}`,
    "srv.devices.teejayslab.de",
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
      req.headers.host === "srv.devices.teejayslab.de"
        ? "https://srv.devices.teejayslab.de"
        : `http://${req.headers.host}`;
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
  web.use("/bewerbung/api", api);
  organizationRoutes(api, store, builds);
  api.get("/health", (_req, res) =>
    res.json({
      ok: true,
      storage: "SQLite + lokale Dateien",
      templateImported: store.templates().length > 0,
      harnesses: [
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
  api.get("/applications", (_req, res) => res.json(store.list()));
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
    harness.setProvider(
      application.id,
      store.preferences.settings().defaultProvider,
    );
    res.status(201).json(application);
  });
  api.get("/applications/:id", (req, res) =>
    res.json({
      ...store.app(req.params.id),
      files: store.files(req.params.id),
      documents: store.documents.selected(req.params.id),
      builds: store.builds(req.params.id),
      harness: harness.status(req.params.id),
    }),
  );
  api.patch("/applications/:id", (req, res) => {
    editable(req.params.id);
    res.json(store.update(req.params.id, req.body));
  });
  api.get("/applications/:id/file", (req, res) => {
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
    const files = fileMap(path.join(dir, "input"));
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
      `data: ${JSON.stringify({ type: "connected", harness: harness.status(req.params.id) })}\n\n`,
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
    close: async () => {
      for (const set of streams.values()) for (const res of set) res.end();
      await harness.close();
      await builds.idle();
      store.close();
    },
  };
}
