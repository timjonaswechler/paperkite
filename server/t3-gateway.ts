import http, { type IncomingMessage, type ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import type express from "express";
import type { NetworkT3Access } from "./t3-access.ts";

export function nativeProxy(origin: string) {
  const target = new URL(origin);
  const options = (req: IncomingMessage) => ({
    hostname: target.hostname,
    port: target.port,
    path: req.url,
    method: req.method,
    headers: req.headers,
  });
  const web = (req: IncomingMessage, res: ServerResponse) => {
    const upstream = http.request(options(req), (response) => {
      res.writeHead(response.statusCode || 502, response.headers);
      response.on("error", () => res.destroy());
      response.pipe(res);
    });
    upstream.on("error", () => {
      if (res.headersSent) res.destroy();
      else {
        res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Native T3-Instanz nicht verfügbar.");
      }
    });
    req.on("aborted", () => upstream.destroy());
    res.on("close", () => {
      if (!res.writableFinished) upstream.destroy();
    });
    req.pipe(upstream);
  };
  const upgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const upstream = http.request(options(req));
    upstream.on("upgrade", (response, remote, remoteHead) => {
      const headers = response.rawHeaders;
      let handshake = `HTTP/1.1 ${response.statusCode} ${response.statusMessage}\r\n`;
      for (let i = 0; i < headers.length; i += 2)
        handshake += `${headers[i]}: ${headers[i + 1]}\r\n`;
      socket.write(handshake + "\r\n");
      if (remoteHead.length) socket.write(remoteHead);
      if (head.length) remote.write(head);
      remote.on("error", () => socket.destroy());
      socket.on("error", () => remote.destroy());
      socket.on("close", () => remote.destroy());
      remote.on("close", () => socket.destroy());
      remote.pipe(socket);
      socket.pipe(remote);
    });
    upstream.on("response", (response) => {
      socket.write(
        `HTTP/1.1 ${response.statusCode} ${response.statusMessage}\r\nConnection: close\r\n\r\n`,
      );
      response.pipe(socket);
    });
    upstream.on("error", () => socket.destroy());
    socket.on("error", () => upstream.destroy());
    upstream.end();
  };
  return { web, upgrade };
}

export function createT3Gateway(
  business: express.Express,
  origin: string,
  access?: NetworkT3Access,
) {
  const proxy = nativeProxy(origin);
  const publicHost = access && new URL(access.publicOrigin).host;
  const allowed = (req: IncomingMessage) => {
    if (!access) return true;
    const foreignSite = ["same-site", "cross-site"].includes(
      String(req.headers["sec-fetch-site"]),
    );
    const navigation =
      req.headers["sec-fetch-mode"] === "navigate" &&
      ["GET", "HEAD"].includes(req.method || "");
    return (
      req.headers.host === publicHost &&
      (!req.headers.origin || req.headers.origin === access.publicOrigin) &&
      (!foreignSite || navigation)
    );
  };
  const authenticate = async (req: IncomingMessage) => {
    if (!access) return;
    // Replace stale browser sessions at the network boundary. Explicit API tokens
    // keep their own scopes. Other cookies (including guest-share state) survive.
    const cookies = (req.headers.cookie || "")
      .split(";")
      .map((cookie) => cookie.trim())
      .filter(
        (cookie) => cookie && cookie.split("=", 1)[0] !== access.cookieName,
      );
    if (!req.headers.authorization)
      cookies.push(`${access.cookieName}=${await access.token()}`);
    if (cookies.length) req.headers.cookie = cookies.join("; ");
    else delete req.headers.cookie;
  };
  const server = http.createServer((req, res) => {
    if (!allowed(req)) {
      res.writeHead(403, { "Cache-Control": "no-store" });
      return res.end("Zugriff nur über die Bewerbungs-Origin.");
    }
    const pathname = (req.url || "/").split("?")[0];
    if (
      access &&
      ["GET", "HEAD"].includes(req.method || "") &&
      (pathname === "/" || pathname === "/pair")
    ) {
      res.writeHead(302, {
        Location: "/bewerbungen",
        "Cache-Control": "no-store",
      });
      return res.end();
    }
    void authenticate(req)
      .then(() => {
        if (
          pathname === "/bewerbung/api" ||
          pathname.startsWith("/bewerbung/api/")
        )
          business(req, res);
        else proxy.web(req, res);
      })
      .catch(() => {
        res.writeHead(503, { "Cache-Control": "no-store" });
        res.end("Native Netzwerk-Anmeldung nicht verfügbar.");
      });
  });
  server.on("upgrade", (req, socket, head) => {
    if (!allowed(req)) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    void authenticate(req)
      .then(() => proxy.upgrade(req, socket, head))
      .catch(() => {
        socket.end(
          "HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n",
        );
      });
  });
  return server;
}

export function legacyLocation(url: string, publicOrigin: string) {
  const previous = new URL(url, publicOrigin);
  const match = previous.pathname.match(
    /^\/bewerbung\/applications\/([a-f0-9-]{36})$/,
  );
  return new URL(
    match ? `/bewerbungen/${match[1]}${previous.search}` : "/bewerbungen",
    publicOrigin,
  ).toString();
}

export function createLegacyRedirect(
  business: express.Express,
  publicOrigin: string,
) {
  return http.createServer((req, res) => {
    const pathname = (req.url || "/").split("?")[0];
    if (pathname === "/bewerbung/api" || pathname.startsWith("/bewerbung/api/"))
      return business(req, res);
    res.writeHead(308, {
      Location: legacyLocation(req.url || "/", publicOrigin),
      "Cache-Control": "no-store",
    });
    res.end();
  });
}
