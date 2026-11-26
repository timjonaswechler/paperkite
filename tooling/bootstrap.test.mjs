import * as NodeAssert from "node:assert/strict";
import * as NodeFS from "node:fs";
import * as NodeCrypto from "node:crypto";
import * as NodeChildProcess from "node:child_process";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeTest from "node:test";

import {
  applyOverlay,
  isolatedEnvironment,
  planOverlay,
  planUpstreamUpdate,
  safePath,
} from "./bootstrap.mjs";

NodeTest.test(
  "runtime launch drops inherited T3 connection and Vite configuration without redirecting HOME",
  () => {
    NodeAssert.deepEqual(
      isolatedEnvironment({
        T3CODE_HOME: "/existing/data",
        T3_BOOT_SERVICE_UNIT: "existing.service",
        T3_API_TOKEN: "ambient-test-token",
        VITE_DEV_SERVER_URL: "http://existing.invalid",
        HOME: "/user",
        PATH: "/bin",
        PAPERKITE_ROOT: "/checkout",
      }),
      { HOME: "/user", PATH: "/bin", PAPERKITE_ROOT: "/checkout" },
    );
  },
);

function fixture(t) {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "paperkite-composition-"));
  t.after(() => NodeFS.rmSync(root, { recursive: true, force: true }));
  const project = NodePath.join(root, "project");
  const upstream = NodePath.join(root, "upstream");
  const output = NodePath.join(root, "output");
  for (const dir of [project, upstream, output]) NodeFS.mkdirSync(dir);
  const write = (base, file, text) => {
    const target = NodePath.join(base, file);
    NodeFS.mkdirSync(NodePath.dirname(target), { recursive: true });
    NodeFS.writeFileSync(target, text);
  };
  return { root, project, upstream, output, write };
}

const empty = () => ({ additions: [], overrides: [] });

function updateFixture(t, next) {
  const f = fixture(t);
  const git = (...args) =>
    NodeChildProcess.execFileSync("git", ["-C", f.upstream, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  const commit = () => {
    git("add", ".");
    git(
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "--quiet",
      "-m",
      "fixture",
    );
    return git("rev-parse", "HEAD");
  };
  const base = "first\nsecond\nthird\nfourth\nfifth\n";
  git("init", "--quiet");
  f.write(f.upstream, "entry.ts", base);
  f.write(f.upstream, "native.ts", "native-v1\n");
  const from = commit();
  for (const [file, text] of Object.entries(next)) {
    if (text === null) NodeFS.rmSync(NodePath.join(f.upstream, file));
    else f.write(f.upstream, file, text);
  }
  const to = commit();
  f.write(f.project, "replacement.ts", "first\npaperkite\nthird\nfourth\nfifth\n");
  f.write(f.project, "added.ts", "own addition\n");
  const composition = {
    additions: [{ source: "added.ts", target: "new.ts" }],
    overrides: [
      {
        source: "replacement.ts",
        target: "entry.ts",
        reason: "Fixture integration",
        upstreamCommit: from,
        upstreamSha256: NodeCrypto.createHash("sha256").update(base).digest("hex"),
      },
    ],
  };
  return { ...f, from, to, composition, git };
}

NodeTest.test("a two-pin proposal merges independent edits without applying them", (t) => {
  const f = updateFixture(t, {
    "entry.ts": "first\nsecond\nthird\nupstream\nfifth\n",
    "native.ts": "native-v2\n",
  });
  const plan = planUpstreamUpdate(f.project, f.upstream, f.composition, f.from, f.to);
  NodeAssert.deepEqual(plan.collisions, []);
  NodeAssert.equal(plan.overrides[0].status, "merge-proposal");
  NodeAssert.equal(plan.overrides[0].proposal, "first\npaperkite\nthird\nupstream\nfifth\n");
  NodeAssert.equal(
    NodeFS.readFileSync(NodePath.join(f.project, "replacement.ts"), "utf8"),
    "first\npaperkite\nthird\nfourth\nfifth\n",
  );
  NodeAssert.equal(f.git("status", "--porcelain"), "");
  NodeAssert.throws(
    () => applyOverlay(f.project, f.upstream, f.output, f.composition),
    /override drift/,
  );
  const reviewed = {
    ...f.composition,
    overrides: [
      {
        ...f.composition.overrides[0],
        upstreamCommit: f.to,
        upstreamSha256: plan.overrides[0].upstreamSha256,
      },
    ],
  };
  f.write(f.project, "replacement.ts", plan.overrides[0].proposal);
  f.write(f.output, "native.ts", "native-v2\n");
  applyOverlay(f.project, f.upstream, f.output, reviewed);
  NodeAssert.equal(
    NodeFS.readFileSync(NodePath.join(f.output, "entry.ts"), "utf8"),
    "first\npaperkite\nthird\nupstream\nfifth\n",
  );
  NodeAssert.equal(
    NodeFS.readFileSync(NodePath.join(f.output, "native.ts"), "utf8"),
    "native-v2\n",
  );
});

NodeTest.test("update proposals expose conflicting edits and new upstream collisions", (t) => {
  const f = updateFixture(t, {
    "entry.ts": "first\nupstream\nthird\nfourth\nfifth\n",
    "new.ts": "upstream addition\n",
  });
  const plan = planUpstreamUpdate(f.project, f.upstream, f.composition, f.from, f.to);
  NodeAssert.deepEqual(plan.collisions, ["new.ts"]);
  NodeAssert.equal(plan.overrides[0].status, "conflict");
  NodeAssert.match(plan.overrides[0].proposal, /<<<<<<< Paperkite/);
  NodeAssert.match(plan.overrides[0].proposal, /paperkite/);
  NodeAssert.match(plan.overrides[0].proposal, /upstream/);
  NodeAssert.equal(f.git("status", "--porcelain"), "");
});

NodeTest.test("removed upstream files and unreviewed base pins cannot be silently adopted", (t) => {
  const f = updateFixture(t, { "entry.ts": null });
  const plan = planUpstreamUpdate(f.project, f.upstream, f.composition, f.from, f.to);
  NodeAssert.equal(plan.overrides[0].status, "removed-upstream");
  NodeAssert.equal(plan.overrides[0].proposal, null);
  const wrongBase = {
    ...f.composition,
    overrides: [{ ...f.composition.overrides[0], upstreamSha256: "0".repeat(64) }],
  };
  NodeAssert.throws(
    () => planUpstreamUpdate(f.project, f.upstream, wrongBase, f.from, f.to),
    /base pin/,
  );
  NodeAssert.throws(
    () => planUpstreamUpdate(f.project, f.upstream, f.composition, f.from, "main"),
    /full commit SHAs/,
  );
});

NodeTest.test(
  "adding product sources preserves upstream bytes and removes retired product sources",
  (t) => {
    const { project, upstream, output, write } = fixture(t);
    write(upstream, "apps/web/native.ts", "native");
    write(output, "apps/web/native.ts", "native");
    write(project, "apps/web/page.ts", "product");
    const composition = { additions: [{ source: "apps/web", target: "apps/web" }], overrides: [] };
    const previous = applyOverlay(project, upstream, output, composition);
    NodeAssert.equal(
      NodeFS.readFileSync(NodePath.join(output, "apps/web/page.ts"), "utf8"),
      "product",
    );
    applyOverlay(project, upstream, output, empty(), previous);
    NodeAssert.equal(NodeFS.existsSync(NodePath.join(output, "apps/web/page.ts")), false);
    NodeAssert.equal(
      NodeFS.readFileSync(NodePath.join(output, "apps/web/native.ts"), "utf8"),
      "native",
    );
    NodeAssert.deepEqual(NodeFS.readdirSync(NodePath.join(upstream, "apps/web")), ["native.ts"]);
  },
);

NodeTest.test("recomposition leaves unchanged additions and overrides untouched", (t) => {
  const { project, upstream, output, write } = fixture(t);
  write(project, "package.json", '{"name":"fixture"}');
  write(project, "replacement.ts", "replacement");
  write(upstream, "entry.ts", "abc");
  const composition = {
    additions: [{ source: "package.json", target: "package.json" }],
    overrides: [
      {
        source: "replacement.ts",
        target: "entry.ts",
        reason: "Fixture integration boundary",
        upstreamSha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
      },
    ],
  };
  const previous = applyOverlay(project, upstream, output, composition);
  const baseline = 946684800;
  for (const target of previous)
    NodeFS.utimesSync(NodePath.join(output, target), baseline, baseline);
  applyOverlay(project, upstream, output, composition, previous);
  for (const target of previous) {
    NodeAssert.equal(NodeFS.statSync(NodePath.join(output, target)).mtimeMs, baseline * 1000);
  }
  write(project, "replacement.ts", "changed integration");
  applyOverlay(project, upstream, output, composition, previous);
  NodeAssert.equal(
    NodeFS.readFileSync(NodePath.join(output, "entry.ts"), "utf8"),
    "changed integration",
  );
  NodeAssert.equal(NodeFS.statSync(NodePath.join(output, "package.json")).mtimeMs, baseline * 1000);
});

NodeTest.test("an unapproved collision fails before deleting the previous product source", (t) => {
  const { project, upstream, output, write } = fixture(t);
  write(upstream, "entry.ts", "native");
  write(project, "replacement.ts", "replacement");
  write(output, "old.ts", "keep on failure");
  const composition = {
    additions: [{ source: "replacement.ts", target: "entry.ts" }],
    overrides: [],
  };
  NodeAssert.throws(
    () => applyOverlay(project, upstream, output, composition, ["old.ts"]),
    /overwrite upstream/,
  );
  NodeAssert.equal(NodeFS.readFileSync(NodePath.join(output, "old.ts"), "utf8"), "keep on failure");
});

NodeTest.test(
  "explicit overrides require the reviewed upstream bytes and restore them when retired",
  (t) => {
    const { project, upstream, output, write } = fixture(t);
    write(upstream, "entry.ts", "abc");
    write(output, "entry.ts", "abc");
    write(project, "replacement.ts", "replacement");
    const composition = {
      additions: [],
      overrides: [
        {
          source: "replacement.ts",
          target: "entry.ts",
          reason: "Fixture integration boundary",
          upstreamSha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
        },
      ],
    };
    const previous = applyOverlay(project, upstream, output, composition);
    NodeAssert.equal(NodeFS.readFileSync(NodePath.join(output, "entry.ts"), "utf8"), "replacement");
    applyOverlay(project, upstream, output, empty(), previous);
    NodeAssert.equal(NodeFS.readFileSync(NodePath.join(output, "entry.ts"), "utf8"), "abc");
    write(upstream, "entry.ts", "new upstream");
    NodeAssert.throws(() => planOverlay(project, upstream, composition), /override drift/);
    NodeAssert.equal(
      NodeFS.readFileSync(NodePath.join(upstream, "entry.ts"), "utf8"),
      "new upstream",
    );
  },
);

NodeTest.test("duplicate destinations and undocumented overrides are rejected", (t) => {
  const { project, upstream, write } = fixture(t);
  write(project, "one.ts", "one");
  write(project, "two.ts", "two");
  NodeAssert.throws(
    () =>
      planOverlay(project, upstream, {
        additions: [
          { source: "one.ts", target: "page.ts" },
          { source: "two.ts", target: "page.ts" },
        ],
        overrides: [],
      }),
    /Duplicate or overlapping target/,
  );
  NodeAssert.throws(
    () =>
      planOverlay(project, upstream, {
        additions: [
          { source: "one.ts", target: "nested" },
          { source: "two.ts", target: "nested/file.ts" },
        ],
        overrides: [],
      }),
    /Duplicate or overlapping target/,
  );
  NodeAssert.throws(
    () =>
      planOverlay(project, upstream, {
        additions: [],
        overrides: [{ source: "one.ts", target: "entry.ts" }],
      }),
    /reason and upstream SHA-256/,
  );
});

NodeTest.test("composition cannot reach Git metadata, secrets or paths outside its root", (t) => {
  const { root } = fixture(t);
  for (const relative of [
    "../outside",
    "/tmp/outside",
    "C:/outside",
    "apps/../../outside",
    "apps\\outside",
    ".git/config",
    ".env",
    ".env.local",
    "node_modules/entry",
  ]) {
    NodeAssert.throws(() => safePath(root, relative), /Unsafe composition path/, relative);
  }
});

NodeTest.test(
  "source and destination symlinks cannot redirect composition outside the build tree",
  (t) => {
    const { root, project, upstream, output, write } = fixture(t);
    write(root, "outside/file.ts", "untouched");
    NodeFS.symlinkSync(NodePath.join(root, "outside"), NodePath.join(project, "linked"), "dir");
    NodeAssert.throws(
      () =>
        planOverlay(project, upstream, {
          additions: [{ source: "linked", target: "page" }],
          overrides: [],
        }),
      /symlinks/,
    );
    write(project, "page.ts", "product");
    NodeFS.symlinkSync(NodePath.join(root, "outside"), NodePath.join(output, "linked"), "dir");
    NodeAssert.throws(
      () =>
        applyOverlay(project, upstream, output, {
          additions: [{ source: "page.ts", target: "linked/file.ts" }],
          overrides: [],
        }),
      /symlinks/,
    );
    NodeAssert.equal(
      NodeFS.readFileSync(NodePath.join(root, "outside/file.ts"), "utf8"),
      "untouched",
    );
  },
);
