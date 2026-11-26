import type { IssueRef, IssueTrackerConnectionList } from "@t3tools/contracts";
import type { EnvironmentProject } from "./state/shell.ts";

type LinkProject = Pick<EnvironmentProject, "id" | "environmentId" | "repositoryIdentity">;

// With no trackers installed, these compatibility readers never turn ordinary URLs into issue actions.
export function isStandaloneIssueLink(_url: string): boolean {
  return false;
}

export function mayContainStandaloneIssueLink(_text: string): boolean {
  return false;
}

export function resolveIssueLinkTarget<Project extends LinkProject>(_input: {
  readonly url: string;
  readonly projects: ReadonlyArray<Project>;
  readonly preferredProjectId?: string | undefined;
  readonly trackers?: IssueTrackerConnectionList | undefined;
}): { readonly project: Project; readonly ref: IssueRef } | null {
  return null;
}
