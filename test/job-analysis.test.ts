import test from "node:test";
import assert from "node:assert/strict";
import { publicAddress, postingText, loadPosting, analyzePosting } from "../server/job-postings.ts";

test("job links cannot reach loopback, NetBird, private, mapped or special-use addresses", async () => {
  for (const ip of ["127.0.0.1", "10.2.3.4", "172.20.1.1", "192.168.1.1", "100.87.56.89", "169.254.169.254", "0.0.0.0", "::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1", "2002:7f00:1::", "2001:db8::1", "224.0.0.1"])
    assert.equal(publicAddress(ip), false, ip);
  for (const ip of ["93.184.216.34", "8.8.8.8", "2606:4700:4700::1111", "2001:4860:4860::8888"])
    assert.equal(publicAddress(ip), true, ip);
  for (const url of ["file:///etc/passwd", "http://127.1/jobs", "http://2130706433/", "http://[::ffff:127.0.0.1]/", "https://user:pass@jobs.example/"])
    await assert.rejects(loadPosting(url, new AbortController().signal), /Link|Adresse/);
  await assert.rejects(loadPosting("https://internal.example/jobs", new AbortController().signal, async () => [{ address: "100.87.56.89", family: 4 }]), /Adresse/);
});

test("advertisement extraction keeps job metadata and readable text, not scripts or navigation markup", () => {
  const html = '<html><head><script type="application/ld+json">{"@type":"JobPosting","title":"Software Engineer","hiringOrganization":{"name":"Müller GmbH"}}</script><script>SECRET_SCRIPT()</script><style>.hidden{}</style></head><body><h1>Software Engineer</h1><p>M&uuml;ller GmbH sucht Verst&auml;rkung &amp; bietet Homeoffice.</p></body></html>';
  const text = postingText(html);
  assert.match(text, /Müller GmbH/);
  assert.match(text, /Verstärkung & bietet Homeoffice/);
  assert.match(text, /JobPosting/);
  assert.doesNotMatch(text, /SECRET_SCRIPT|<h1>|\.hidden/);
});

test("manual posting fallback uses the selected analysis model and preserves the original source", async () => {
  const text = "Acme GmbH sucht einen Software Engineer. Erforderlich sind TypeScript und Erfahrung mit Datenbanken.";
  const model = { instanceId: "fixture-provider", model: "fixture-model" };
  let calls = 0;
  const result = await analyzePosting({ url: "https://jobs.example/42", text }, model, async input => {
    calls++;
    assert.equal(input.text, text);
    assert.deepEqual(input.modelSelection, model);
    return { company: "Acme GmbH", role: "Software Engineer", requirements: ["TypeScript", "Datenbanken"] };
  }, new AbortController().signal);
  assert.equal(calls, 1);
  assert.equal(result.url, "https://jobs.example/42");
  assert.equal(result.text, text);
  assert.equal(result.company, "Acme GmbH");
  assert.ok(result.capturedAt);
  const uncertain = await analyzePosting({ url: "https://jobs.example/42", text }, null, async () => ({ company: "", role: "", requirements: [] }), new AbortController().signal);
  assert.equal(uncertain.company, "");
  assert.equal(uncertain.role, "");
  assert.equal(uncertain.text, text);
});
