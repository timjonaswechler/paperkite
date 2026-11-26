import { expect, it } from "vite-plus/test";
import { filterAvailableSettingsSearchItems } from "../components/settings/settingsSearch";

it("omits Git routes and composer shortcuts even when every native capability is available", () => {
  const items = filterAvailableSettingsSearchItems({
    hasCloudPublicConfig: true,
    hasEnvironment: true,
    hasProviderSettingsEnvironment: true,
    canManageLocalBackend: true,
    isWslSettingsRowVisible: true,
    hasThreadAutoSettlement: true,
    managedTunnelActive: true,
    hasPeerLinkHost: true,
    hasFastWorktreeCheckoutEnvironment: true,
    hasAgentFeedbackEnvironment: true,
    hasTextGeneratorsEnvironment: true,
    hasPrimaryEnvironment: true,
    hasSecretProvidersEnvironment: true,
  });
  const ids = new Set(items.map((item) => item.id));
  for (const id of [
    "linked-environments-beta",
    "linked-environments",
    "remote-environments",
    "load-balancing",
    "network-access",
    "connect-device-approval",
    "git-fetch-interval",
    "ghq-clone-layout",
    "keybinding-pullRequest.copyNumber",
    "keybinding-diff.toggle",
    "worktree-fast-checkout",
    "project-repositories",
    "auto-settle-merged-threads",
    "storage-worktrees",
    "storage-worktrees-location",
    "worktree-branch-naming",
    "keybinding-composer.branch",
    "keybinding-composer.previousWorktree",
    "keybinding-composer.workspace",
  ])
    expect(ids.has(id)).toBe(false);
  expect(ids.has("keybinding-modelPicker.toggle")).toBe(true);
  const copyThread = items.find((item) => item.id === "keybinding-thread.copyReference");
  expect(copyThread?.title).toBe("Copy thread");
  expect(ids.has("auto-settle-inactive-threads")).toBe(true);
  expect(ids.has("issue-trackers")).toBe(false);
  expect(items.some((item) => item.to === "/settings/source-control")).toBe(false);
  expect(ids.has("connections-environment")).toBe(true);
  expect(items.some((item) => String(item.to) === "/settings/worktrees")).toBe(false);
});
