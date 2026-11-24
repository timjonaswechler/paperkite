import * as NodeAssert from "node:assert/strict";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeTest from "node:test";

import { applyOverlay, isolatedEnvironment, planOverlay, safePath } from "./bootstrap.mjs";

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
