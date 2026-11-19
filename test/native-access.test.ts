import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import express from "express";
import { createT3Gateway } from "../server/t3-gateway.ts";

async function listen(server: http.Server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
async function close(server: http.Server) {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
// Node fetch rewrites Host; use the real HTTP wire contract for origin checks.
function get(url: string, headers: Record<string, string>) {
  return new Promise<Response>((resolve, reject) => {
    http
      .get(url, { headers }, (incoming) => {
        const chunks: Buffer[] = [];
        incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
        incoming.on("error", reject);
        incoming.on("end", () => {
          const responseHeaders = new Headers();
          for (let i = 0; i < incoming.rawHeaders.length; i += 2)
            responseHeaders.append(
              incoming.rawHeaders[i]!,
              incoming.rawHeaders[i + 1]!,
            );
          resolve(
            new Response(Buffer.concat(chunks), {
              status: incoming.statusCode,
              headers: responseHeaders,
            }),
          );
        });
      })
      .on("error", reject);
  });
}

test("network credential failure refuses HTTP and WS instead of forwarding unauthenticated traffic", async () => {
  let reached = 0;
  const peer = http.createServer((_req, res) => {
    reached++;
    res.end("unexpected");
  });
  const upstream = await listen(peer);
  const gateway = createT3Gateway(express(), upstream, {
    publicOrigin: "https://bewerbung.teejayslab.de",
    cookieName: "t3_session_synthetic",
    token: async () => {
      throw new Error("private-detail-must-not-leak");
    },
  });
  const address = await listen(gateway);
  try {
    const response = await get(address + "/api/auth/session", {
      Host: "bewerbung.teejayslab.de",
    });
    assert.equal(response.status, 503);
    assert.equal((await response.text()).includes("private-detail"), false);
    await new Promise<void>((resolve, reject) => {
      const request = http.request(address + "/ws", {
        headers: {
          Host: "bewerbung.teejayslab.de",
          Connection: "Upgrade",
          Upgrade: "websocket",
        },
      });
      request.on("response", (response) => {
        assert.equal(response.statusCode, 503);
        response.resume();
        resolve();
      });
      request.on("upgrade", (_response, socket) => {
        socket.destroy();
        reject(new Error("Unauthenticated WS accepted"));
      });
      request.on("error", reject);
      request.end();
    });
    assert.equal(reached, 0);
  } finally {
    await close(gateway);
    await close(peer);
  }
});

// Contract: NetBird replaces interactive pairing, including business API and WS.
// A fresh browser must work; stale cookies must not bring the pairing gate back.
// Host/Origin checks must run before granting this network-trusted authority.
test("network access opens applications without pairing and authenticates HTTP/business/WS without exposing the credential", async () => {
  const requests: http.IncomingHttpHeaders[] = [];
  const peer = http.createServer((req, res) => {
    requests.push(req.headers);
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ authenticated: true }));
  });
  peer.on("upgrade", (req, socket) => {
    requests.push(req.headers);
    socket.end(
      "HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n",
    );
  });
  const upstream = await listen(peer);
  const business = express();
  business.get("/bewerbung/api/applications", (req, res) => {
    requests.push(req.headers);
    res.json([{ company: "Synthetic application" }]);
  });
  let tokensRequested = 0;
  const gateway = createT3Gateway(business, upstream, {
    publicOrigin: "https://bewerbung.teejayslab.de",
    cookieName: "t3_session_synthetic",
    token: async () => {
      tokensRequested++;
      return "synthetic-private-gateway-credential";
    },
  });
  const address = await listen(gateway);
  const headers = { Host: "bewerbung.teejayslab.de" };
  try {
    for (const route of [
      "/",
      "/?from=bookmark",
      "/pair",
      "/pair?token=do-not-forward",
    ]) {
      const response = await get(address + route, headers);
      assert.equal(response.status, 302);
      assert.equal(response.headers.get("location"), "/bewerbungen");
      assert.equal(response.headers.get("cache-control"), "no-store");
    }
    assert.equal(requests.length, 0);
    for (const route of ["/api/auth/session", "/bewerbung/api/applications"]) {
      const response = await get(address + route, {
        ...headers,
        Cookie: "other=keep; t3_session_synthetic=expired",
        Origin: "https://bewerbung.teejayslab.de",
      });
      assert.equal(response.status, 200);
      assert.equal(response.headers.getSetCookie().length, 0);
      assert.equal(
        (await response.text()).includes(
          "synthetic-private-gateway-credential",
        ),
        false,
      );
      assert.equal(
        requests.at(-1)!.cookie,
        "other=keep; t3_session_synthetic=synthetic-private-gateway-credential",
      );
      assert.equal(requests.at(-1)!.host, "bewerbung.teejayslab.de");
    }
    // Explicit remote/API credentials retain their scopes; do not silently elevate them.
    await get(address + "/api/auth/session", {
      ...headers,
      Authorization: "Bearer synthetic-readonly",
      Cookie: "t3_session_synthetic=expired; other=keep",
    });
    assert.equal(requests.at(-1)!.authorization, "Bearer synthetic-readonly");
    assert.equal(requests.at(-1)!.cookie, "other=keep");
    await new Promise<void>((resolve, reject) => {
      const request = http.request(address + "/ws", {
        headers: {
          ...headers,
          Connection: "Upgrade",
          Upgrade: "websocket",
          Origin: "https://bewerbung.teejayslab.de",
        },
      });
      request.on("upgrade", (response, socket) => {
        assert.equal(response.statusCode, 101);
        assert.equal(
          requests.at(-1)!.cookie,
          "t3_session_synthetic=synthetic-private-gateway-credential",
        );
        socket.destroy();
        resolve();
      });
      request.on("response", (response) =>
        reject(new Error(`WS rejected: ${response.statusCode}`)),
      );
      request.on("error", reject);
      request.end();
    });
    assert.equal(tokensRequested, 3);
  } finally {
    await close(gateway);
    await close(peer);
  }
});

test("network access rejects foreign hosts/origins and cross-site fetches before granting native access", async () => {
  let reached = 0;
  const peer = http.createServer((_req, res) => {
    reached++;
    res.end("unexpected");
  });
  const upstream = await listen(peer);
  const gateway = createT3Gateway(express(), upstream, {
    publicOrigin: "https://bewerbung.teejayslab.de",
    cookieName: "t3_session_synthetic",
    token: async () => {
      reached++;
      return "must-not-be-requested";
    },
  });
  const address = await listen(gateway);
  try {
    const rejectedHeaders: Record<string, string>[] = [
      { Host: "evil.invalid" },
      { Host: "bewerbung.teejayslab.de", Origin: "https://evil.invalid" },
      { Host: "bewerbung.teejayslab.de", Origin: "null" },
      { Host: "bewerbung.teejayslab.de", "Sec-Fetch-Site": "same-site" },
      { Host: "bewerbung.teejayslab.de", "Sec-Fetch-Site": "cross-site" },
    ];
    for (const headers of rejectedHeaders) {
      const response = await get(address + "/api/auth/session", headers);
      assert.equal(response.status, 403);
    }
    await new Promise<void>((resolve, reject) => {
      const request = http.request(address + "/ws", {
        headers: {
          Host: "bewerbung.teejayslab.de",
          Connection: "Upgrade",
          Upgrade: "websocket",
          Origin: "https://evil.invalid",
        },
      });
      request.on("response", (response) => {
        assert.equal(response.statusCode, 403);
        response.resume();
        resolve();
      });
      request.on("upgrade", (_response, socket) => {
        socket.destroy();
        reject(new Error("Foreign WS accepted"));
      });
      request.on("error", reject);
      request.end();
    });
    assert.equal(reached, 0);
    const navigation = await get(address + "/", {
      Host: "bewerbung.teejayslab.de",
      "Sec-Fetch-Site": "cross-site",
      "Sec-Fetch-Mode": "navigate",
    });
    assert.equal(navigation.status, 302);
  } finally {
    await close(gateway);
    await close(peer);
  }
});
