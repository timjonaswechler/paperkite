import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

// Prevent native Git/worktree operations from discovering the enclosing app source repository.
// No commit, remote, model or permission override is created.
export function prepareNativeWorkspace(workspace: string) {
  if (fs.lstatSync(path.join(workspace, ".git"), { throwIfNoEntry: false }))
    return;
  const env = { ...process.env };
  for (const key of [
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_COMMON_DIR",
    "GIT_INDEX_FILE",
    "GIT_OBJECT_DIRECTORY",
  ])
    delete env[key];
  execFileSync("git", ["init", "--quiet", "--template=", workspace], {
    env,
    timeout: 10000,
    stdio: "pipe",
  });
}
