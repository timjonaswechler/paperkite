const retiredSettings = new Set([
  "/settings/diffs",
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

export function isRetiredShortcut(command: string) {
  return /^(?:diff\.|pullRequest\.|composer\.(?:dictation|workspace|previousWorktree|branch)$|thread\.settle$|chat\.newWithoutProject$|snapShot\.)/.test(
    command,
  );
}
