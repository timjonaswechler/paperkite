import { expect, it } from "vitest";

import { supportsThreadSettlement } from "./Capabilities";

it("does not offer settlement before configuration loads or when explicitly disabled", () => {
  expect(supportsThreadSettlement(undefined)).toBe(false);
  expect(supportsThreadSettlement({ threadSettlement: false })).toBe(false);
});

it("keeps enabled and older native servers supported", () => {
  expect(supportsThreadSettlement({ threadSettlement: true })).toBe(true);
  expect(supportsThreadSettlement({})).toBe(true);
});
