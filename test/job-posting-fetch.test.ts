import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import dns from "node:dns/promises";
import http, { type ClientRequest, type IncomingMessage } from "node:http";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { readFileSync } from "node:fs";
import { analyzePosting, loadPosting } from "../server/job-postings.ts";

const fixture = (name: string) =>
  readFileSync(
    new URL(`./fixtures/job-postings/${name}`, import.meta.url),
    "utf8",
  );
const capture = JSON.parse(fixture("tu-darmstadt-58396.capture.json"));
const pageUrl: string = capture.page.url;
const detailsUrl: string = capture.details.url;
const shell = fixture("tu-darmstadt-58396.html");
const details = fixture("tu-darmstadt-58396.json");
const signal = () => new AbortController().signal;

type Reply = {
  body?: string | Buffer;
  status?: number;
  type?: string;
  location?: string;
  hold?: boolean;
};

// Replace only DNS and the socket transport. The production loader still checks
// addresses/redirects, pins lookup, decodes bytes, enforces limits and extracts text.
function transport(
  t: TestContext,
  replies: Record<string, Reply>,
  addresses: Record<string, string[]> = {},
) {
  const requests: string[] = [];
  const pins: unknown[] = [];
  const dnsMock = t.mock.method(dns, "lookup", (async (host: string) =>
    (addresses[host] ?? ["93.184.216.34"]).map((address) => ({
      address,
      family: 4,
    }))) as unknown as typeof dns.lookup);
  syncBuiltinESMExports();
  t.after(() => {
    dnsMock.mock.restore();
    syncBuiltinESMExports();
  });
  const request = ((
    url: URL,
    options: https.RequestOptions,
    respond: (response: IncomingMessage) => void,
  ) => {
    const client = new EventEmitter() as ClientRequest;
    const body = new PassThrough();
    const incoming = body as unknown as IncomingMessage;
    let stopped = false;
    const abort = () =>
      client.destroy(
        Object.assign(new Error("The operation was aborted"), {
          name: "AbortError",
        }),
      );
    const cleanup = () => options.signal?.removeEventListener("abort", abort);
    client.destroy = ((error?: Error) => {
      if (!stopped) {
        stopped = true;
        cleanup();
        incoming.destroy();
        if (error) client.emit("error", error);
      }
      return client;
    }) as ClientRequest["destroy"];
    client.end = (() => {
      queueMicrotask(() => {
        try {
          requests.push(url.href);
          if (options.signal?.aborted) return void abort();
          options.signal?.addEventListener("abort", abort, { once: true });
          const lookup = options.lookup as (
            host: string,
            options: { all: true },
            callback: (error: Error | null, result: unknown) => void,
          ) => void;
          lookup(url.hostname, { all: true }, (error, result) => {
            assert.ifError(error);
            pins.push(result);
          });
          const reply = replies[url.href];
          assert.ok(reply, `Unexpected request: ${url.href}`);
          if (reply.hold) return;
          incoming.statusCode = reply.status ?? 200;
          incoming.headers = {
            "content-type": reply.type ?? "text/html; charset=utf-8",
            ...(reply.location ? { location: reply.location } : {}),
          };
          incoming.once("end", cleanup);
          respond(incoming);
          body.end(reply.body ?? "");
        } catch (error) {
          client.destroy(error as Error);
        }
      });
      return client;
    }) as ClientRequest["end"];
    return client;
  }) as typeof https.request;
  t.mock.method(https, "request", request);
  t.mock.method(http, "request", request);
  return { requests, pins, dnsMock };
}

const portalReplies = () => ({
  [pageUrl]: { body: shell },
  [detailsUrl]: { body: details, type: "application/json; charset=utf-8" },
});

test("TU Darmstadt URL supplies the real employer, role and requirements to the analysis runner", async (t) => {
  const net = transport(t, portalReplies());
  const model = { instanceId: "fixture", model: "fixture-model" };
  let calls = 0;
  const result = await analyzePosting(
    { url: pageUrl },
    model,
    async (input, receivedSignal) => {
      calls++;
      assert.equal(receivedSignal.aborted, false);
      assert.equal(input.sourceUrl, pageUrl);
      assert.deepEqual(input.modelSelection, model);
      assert.match(input.text, /Technische Universität Darmstadt/);
      assert.ok(input.text.includes(capture.expected.role));
      for (const requirement of capture.expected.requirements)
        assert.ok(input.text.includes(requirement), requirement);
      assert.doesNotMatch(input.text, /<[^>]+>|app\.8dcfd7c4|contactEmail/);
      return {
        company: capture.expected.company,
        role: capture.expected.role,
        requirements: capture.expected.requirements,
      };
    },
    signal(),
  );
  assert.equal(calls, 1);
  assert.equal(result.url, pageUrl);
  assert.equal(result.company, capture.expected.company);
  assert.equal(result.role, capture.expected.role);
  assert.deepEqual(result.requirements, capture.expected.requirements);
  assert.deepEqual(net.requests, [pageUrl, detailsUrl]);
  assert.deepEqual(net.pins, [
    [{ address: "93.184.216.34", family: 4 }],
    [{ address: "93.184.216.34", family: 4 }],
  ]);
});

test("normal HTML, JSON-LD and manual text do not trigger the portal fallback", async (t) => {
  const text =
    "Acme GmbH sucht Software Engineers mit TypeScript und Datenbankkenntnissen für nachhaltige Softwareentwicklung.";
  const net = transport(t, {
    [pageUrl]: { body: `<h1>${text}</h1>` },
    "https://jobs.example/42": {
      body: `<script type="application/ld+json">${JSON.stringify({ "@type": "JobPosting", title: "Software Engineer", description: text })}</script>`,
    },
  });
  assert.equal((await loadPosting(pageUrl, signal())).text, text);
  assert.match(
    (await loadPosting("https://jobs.example/42", signal())).text,
    /Software Engineer/,
  );
  await analyzePosting(
    { url: pageUrl, text },
    null,
    async (input) => {
      assert.equal(input.text, text);
      return {
        company: "Acme GmbH",
        role: "Software Engineer",
        requirements: [],
      };
    },
    signal(),
  );
  assert.deepEqual(net.requests, [pageUrl, "https://jobs.example/42"]);
});

test("empty pages on other hosts, routes and token-only previews do not trigger a guessed API request", async (t) => {
  const urls = [
    "https://jobs.example/tu-darmstadt/job/58396",
    "https://www.career.tu-darmstadt.de.evil.example/tu-darmstadt/job/58396",
    "https://www.career.tu-darmstadt.de/tu-darmstadt/job/preview/58396/token",
    "https://www.career.tu-darmstadt.de/tu-darmstadt/job/58396/internal-token",
    "https://www.career.tu-darmstadt.de/other-company/job/58396",
  ];
  const net = transport(
    t,
    Object.fromEntries(urls.map((url) => [url, { body: shell }])),
  );
  for (const url of urls)
    await assert.rejects(
      analyzePosting(
        { url },
        null,
        async () => assert.fail("empty page must not reach model"),
        signal(),
      ),
      /Zu wenig lesbarer Inhalt/,
    );
  assert.deepEqual(net.requests, urls);
});

test("portal errors, invalid metadata and empty descriptions never reach the model", async (t) => {
  const net = transport(t, portalReplies());
  const data = JSON.parse(details);
  for (const body of [
    "",
    "not JSON",
    JSON.stringify({
      error: "A real error response is not an advertisement. ".repeat(10),
    }),
    JSON.stringify({ google4JobsData: "{}" }),
    JSON.stringify({
      google4JobsData: JSON.stringify({
        "@type": "JobPosting",
        title: "Research Software Engineer",
        hiringOrganization: { name: "TU Darmstadt" },
        description: "",
      }),
    }),
    JSON.stringify({
      google4JobsData: JSON.stringify({
        "@type": "Error",
        title: "Not a posting",
        description: "Error ".repeat(100),
      }),
    }),
    JSON.stringify({
      google4JobsData: data.google4JobsData.replace('"JobPosting"', '"Error"'),
    }),
  ]) {
    const replies = portalReplies();
    replies[detailsUrl].body = body;
    // Each subtest gets an independent transport and automatic mock cleanup.
    await t.test(
      `rejects unusable details (${body.slice(0, 50)})`,
      async (child) => {
        transport(child, replies);
        await assert.rejects(
          analyzePosting(
            { url: pageUrl },
            null,
            async () => assert.fail("unusable details must not reach model"),
            signal(),
          ),
          /Ausschreibungstext|lesbarer Inhalt/,
        );
      },
    );
  }
  assert.equal(net.requests.length, 0);
});

test("redirects retain the posting source and resolve/check the API target again", async (t) => {
  const start = "https://jobs.example/start";
  const final = "https://api.career.hidden-professionals.de/job/public-details";
  const net = transport(t, {
    [start]: { status: 302, location: pageUrl },
    ...portalReplies(),
    [detailsUrl]: { status: 307, location: "/job/public-details" },
    [final]: { body: details, type: "application/json" },
  });
  const result = await loadPosting(start, signal());
  assert.equal(result.url, pageUrl);
  assert.match(result.text, /Research Software Engineer/);
  assert.deepEqual(net.requests, [start, pageUrl, detailsUrl, final]);
  assert.equal(net.dnsMock.mock.callCount(), 4);
});

test("private or mixed DNS answers and private redirect destinations are blocked on the API leg", async (t) => {
  for (const addresses of [["127.0.0.1"], ["93.184.216.34", "10.0.0.1"]]) {
    await t.test(addresses.join(","), async (child) => {
      const net = transport(child, portalReplies(), {
        "api.career.hidden-professionals.de": addresses,
      });
      await assert.rejects(loadPosting(pageUrl, signal()), /Adresse/);
      assert.deepEqual(net.requests, [pageUrl]);
    });
  }
  await t.test("API redirect to metadata service", async (child) => {
    const net = transport(child, {
      ...portalReplies(),
      [detailsUrl]: {
        status: 302,
        location: "http://169.254.169.254/latest/meta-data",
      },
    });
    await assert.rejects(loadPosting(pageUrl, signal()), /Adresse/);
    assert.deepEqual(net.requests, [pageUrl, detailsUrl]);
  });
});

test("status, media type, redirect limit, size and charset checks apply to the API leg", async (t) => {
  for (const [name, reply, error] of [
    ["HTTP error", { status: 404, body: "Not found" }, /nicht abrufbar/],
    [
      "binary response",
      { type: "application/pdf", body: "%PDF" },
      /keinen lesbaren/,
    ],
    [
      "redirect loop",
      { status: 302, location: detailsUrl },
      /Zu viele Weiterleitungen/,
    ],
    ["missing redirect target", { status: 302 }, /ungültig weiter/],
    [
      "oversize",
      {
        body: Buffer.alloc(2 * 1024 * 1024 + 1, "x"),
        type: "application/json",
      },
      /zu groß/,
    ],
    [
      "invalid charset",
      { body: details, type: "application/json; charset=unknown-encoding" },
      /Seitenformat nicht lesbar/,
    ],
  ] as const) {
    await t.test(name, async (child) => {
      transport(child, { ...portalReplies(), [detailsUrl]: reply });
      await assert.rejects(loadPosting(pageUrl, signal()), error);
    });
  }
});

test("cancellation and the existing 15-second timeout also bound the API request", async (t) => {
  await t.test("caller cancellation", async (child) => {
    const net = transport(child, {
      ...portalReplies(),
      [detailsUrl]: { hold: true },
    });
    const controller = new AbortController();
    const pending = loadPosting(pageUrl, controller.signal);
    setImmediate(() => controller.abort());
    await assert.rejects(pending, { name: "AbortError" });
    assert.deepEqual(net.requests, [pageUrl, detailsUrl]);
  });
  await t.test("timeout", async (child) => {
    const timeout = AbortSignal.timeout;
    child.mock.method(AbortSignal, "timeout", (ms: number) => {
      assert.equal(ms, 15_000);
      return timeout(10);
    });
    transport(child, { ...portalReplies(), [detailsUrl]: { hold: true } });
    // AbortSignal.timeout is unref'ed; keep the fake socket alive until it fires.
    const keepAlive = setTimeout(() => {}, 1000);
    try {
      await assert.rejects(loadPosting(pageUrl, signal()), {
        name: "AbortError",
      });
    } finally {
      clearTimeout(keepAlive);
    }
  });
});
