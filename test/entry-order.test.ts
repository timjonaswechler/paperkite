import test from "node:test";
import assert from "node:assert/strict";
import {
  moveEntry,
  prependEntry,
  restoreEntryOrder,
} from "../vendor/t3/apps/web/src/bewerbung/components/entry-order.ts";

const ids = (entries: { id: string }[]) => entries.map((entry) => entry.id);
test("entry ordering supports all positions without changing IDs, contents, flags or the input array", () => {
  const source = [
    { id: "a", title: "Alpha", included: false },
    { id: "b", title: "Beta", included: true },
    { id: "c", title: "Gamma", included: true },
    { id: "d", title: "Delta", included: false },
  ];
  assert.deepEqual(
    ids(prependEntry(source, { id: "new", title: "New", included: true })),
    ["new", "a", "b", "c", "d"],
  );
  for (const [id, index, expected] of [
    ["c", 0, ["c", "a", "b", "d"]],
    ["c", 1, ["a", "c", "b", "d"]],
    ["b", 2, ["a", "c", "b", "d"]],
    ["b", 3, ["a", "c", "d", "b"]],
    ["d", -5, ["d", "a", "b", "c"]],
    ["a", 50, ["b", "c", "d", "a"]],
  ] as const) {
    const result = moveEntry(source, id, index);
    assert.deepEqual(ids(result), expected);
    for (const entry of result)
      assert.equal(
        entry,
        source.find((original) => original.id === entry.id),
      );
  }
  assert.deepEqual(ids(source), ["a", "b", "c", "d"]);
  assert.equal(moveEntry(source, "missing", 0), source);
  assert.equal(moveEntry(source, "a", 0), source);
  assert.equal(moveEntry(source, "a", NaN), source);
});

test("undo restores only order: newer content and additions survive and removed entries stay removed", () => {
  const previous = ["a", "b", "c"];
  const current = [
    { id: "new", text: "New draft" },
    {
      id: "c",
      text: "Edited after moving",
      included: false,
      extra: "Preserved",
    },
    { id: "a", text: "Alpha" },
  ];
  const restored = restoreEntryOrder(current, previous);
  assert.deepEqual(ids(restored), ["new", "a", "c"]);
  assert.equal(restored[0], current[0]);
  assert.equal(restored[2], current[1]);
  assert.equal(
    restored.some((entry) => entry.id === "b"),
    false,
  );
  assert.deepEqual(ids(current), ["new", "c", "a"]);
});
