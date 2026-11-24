import { expect, it } from "vite-plus/test";
import { confirmNavigation, registerNavigationGuard } from "./navigation";

it("closing an inline profile editor does not remove the document editor's unsaved-input protection", () => {
  let documentAllows = false;
  let profileAllows = true;
  const removeDocument = registerNavigationGuard(() => documentAllows);
  const removeProfile = registerNavigationGuard(() => profileAllows);
  try {
    expect(confirmNavigation()).toBe(false);
    documentAllows = true;
    profileAllows = false;
    expect(confirmNavigation()).toBe(false);
    profileAllows = true;
    expect(confirmNavigation()).toBe(true);
    documentAllows = false;
    removeProfile();
    expect(confirmNavigation()).toBe(false);
  } finally {
    removeProfile();
    removeDocument();
  }
  expect(confirmNavigation()).toBe(true);
});
