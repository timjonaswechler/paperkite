import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../server/store.ts";
import {
  parseLiteralLua,
  parseProfile,
  serializeProfile,
} from "../server/lua-profile.ts";
const source = String.raw`-- Original source formatting must remain byte-identical.
return {
 experience = {
  {date='2021', title='Alpha', org='One', bullets={[[TeX \textbf{A}]], 'A second bullet'}},
  {date='2023', title='Beta', org='Two', bullets={'B'}},
  {date='2025', title='Gamma', org='Three', bullets={'C'}},
 },
 engagement = {{date='2020',title='Volunteer',org='Club',bullets={'Help'}}},
 skills = {{label='Languages',items={'German','English'}},{label='Tools',items={'Lua','TeX'}}},
}`;
const destination = `return {experience={{date='1999',title='Existing',org='Destination',bullets={'Keep'}}}, engagement={{date='2010',title='Other',org='Local',bullets={}}},skills={{label='Old',items={'One'}}},custom={enabled=true,weight=2.5}}`;
test("literal Lua roundtrip preserves TeX and strings; rejects executable, ambiguous or oversized grammar", () => {
  const p = parseProfile(source);
  assert.deepEqual(p.experience[0].bullets, [
    String.raw`TeX \textbf{A}`,
    "A second bullet",
  ]);
  assert.deepEqual(parseProfile(serializeProfile(p)), p);
  const escaped = parseLiteralLua(
    `return {s='quote\\\' and \\" and \\092TeX',x=[=[\nLong\ntext]=]}`,
  ) as Record<string, unknown>;
  assert.equal(escaped.s, `quote' and " and \\TeX`);
  assert.equal(escaped.x, "Long\ntext");
  for (const malicious of [
    `return os.execute('touch /tmp/NO')`,
    `return {experience=(function() return {} end)()}`,
    `local x={}; return x`,
    `return {}; os.execute('echo nope')`,
    `return {x=require('os')}`,
    `return {x='a' .. 'b'}`,
    `return {x=1+2}`,
    `return {x=nil}`,
    `return {x=1,x=2}`,
    `return {x=1,2}`,
    `return {[1]='a'}`,
    `return {__proto__={}}`,
    `return {x='\\q'}`,
    `return {x=9007199254740993}`,
    "return " + "{".repeat(35) + "}".repeat(35),
  ])
    assert.throws(() => parseProfile(malicious), Error, malicious);
  assert.throws(
    () => parseProfile('return {skills={{label="X",items={3}}}}'),
    /Zeichenketten/,
  );
});
test("entry reuse append/replace: independent values, source order, unchanged originals and restart persistence", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bewerbung-entry-test-"));
  let s = new Store(root);
  try {
    const a = s.create({ company: "Source entries" }),
      b = s.create({ company: "Destination entries" });
    s.save(a.id, "cv/profiles/source.lua", source, a.revision);
    s.save(b.id, "cv/profiles/target.lua", destination, b.revision);
    const request = {
      source: a.id,
      sourceProfile: "cv/profiles/source.lua",
      sourceRevision: s.app(a.id).revision,
      destinationProfile: "cv/profiles/target.lua",
      revision: s.app(b.id).revision,
      selection: [
        { section: "skills", index: 1 },
        { section: "experience", index: 2 },
        { section: "experience", index: 0 },
      ],
      mode: "append",
    };
    s.reuseEntries(b.id, request);
    let result = s.profile(b.id, request.destinationProfile).entries;
    assert.deepEqual(
      result.experience.map((x) => x.title),
      ["Existing", "Alpha", "Gamma"],
    );
    assert.deepEqual(
      result.skills.map((x) => x.label),
      ["Old", "Tools"],
    );
    assert.deepEqual(
      result.engagement.map((x) => x.title),
      ["Other"],
    );
    assert.equal(
      JSON.stringify(result.custom),
      JSON.stringify({ enabled: true, weight: 2.5 }),
    );
    assert.equal(s.read(a.id, request.sourceProfile).toString(), source);
    assert.throws(() => s.reuseEntries(b.id, request), /Inzwischen geändert/);
    const before = s.read(b.id, request.destinationProfile).toString();
    for (const patch of [
      { mode: "silent" },
      { selection: [] },
      { sourceRevision: 1 },
      { selection: [{ section: "experience", index: 999 }] },
      { source: b.id },
      {
        selection: [
          { section: "skills", index: 1 },
          { section: "skills", index: 1 },
        ],
      },
    ]) {
      assert.throws(() =>
        s.reuseEntries(b.id, {
          ...request,
          revision: s.app(b.id).revision,
          ...patch,
        }),
      );
      assert.equal(s.read(b.id, request.destinationProfile).toString(), before);
    }
    s.reuseEntries(b.id, {
      ...request,
      revision: s.app(b.id).revision,
      mode: "replace",
      selection: [{ section: "skills", index: 0 }],
    });
    s.close();
    s = new Store(root);
    result = s.profile(b.id, request.destinationProfile).entries;
    assert.deepEqual(
      result.skills.map((x) => x.label),
      ["Languages"],
    );
    assert.deepEqual(
      result.experience.map((x) => x.title),
      ["Existing", "Alpha", "Gamma"],
    );
    assert.equal(s.read(a.id, request.sourceProfile).toString(), source);
    s.save(
      a.id,
      request.sourceProfile,
      'return {skills=os.execute("no")}',
      s.app(a.id).revision,
    );
    const unchanged = s.read(b.id, request.destinationProfile).toString();
    assert.throws(() =>
      s.reuseEntries(b.id, {
        ...request,
        revision: s.app(b.id).revision,
        sourceRevision: s.app(a.id).revision,
      }),
    );
    assert.equal(
      s.read(b.id, request.destinationProfile).toString(),
      unchanged,
    );
  } finally {
    s.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
