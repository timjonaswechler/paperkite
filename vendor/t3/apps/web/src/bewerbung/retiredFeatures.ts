const retiredSettings = new Set([
  "/settings/diffs",
  "/settings/browser",
  "/settings/diagnostics",
  "/settings/voice",
  "/settings/snap-shot",
  "/settings/devices",
  "/settings/source-control",
  "/settings/worktrees",
  "/settings/connections",
  "/settings/access",
  "/settings/labs",
]);

export function isRetiredSettingsPath(path: string) {
  return retiredSettings.has(path);
}

export function isRetiredSettingsItem(id: string) {
  return (
    id === "mobile-app" ||
    id === "diagnostics" ||
    id === "new-threads" ||
    id.startsWith("snooze-") ||
    id.includes("auto-settle") ||
    id === "keep-threads-with-pull-requests" ||
    id === "storage-artifacts" ||
    id.startsWith("browser-") ||
    id === "agent-browser-access"
  );
}

export function isRetiredShortcut(command: string) {
  return /^(?:diff\.|pullRequest\.|preview\.|browser\.|recording\.|composer\.(?:dictation|host|workspace|previousWorktree|branch)$|thread\.settle$|chat\.newWithoutProject$|snapShot\.)/.test(
    command,
  );
}
