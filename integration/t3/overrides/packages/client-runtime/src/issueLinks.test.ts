import {
  EnvironmentId,
  IssueTrackerKind,
  ProjectId,
  SourceControlProviderKind,
} from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";
import {
  isStandaloneIssueLink,
  mayContainStandaloneIssueLink,
  resolveIssueLinkTarget,
} from "./issueLinks.ts";

const projectId = ProjectId.make("legacy-project");
const projects = [
  {
    id: projectId,
    environmentId: EnvironmentId.make("fixture"),
    repositoryIdentity: {
      canonicalKey: "github.com/acme/web",
      provider: SourceControlProviderKind.make("github"),
      displayName: "acme/web",
      locator: {
        source: "git-remote" as const,
        remoteName: "origin",
        remoteUrl: "git@github.com:acme/web.git",
      },
    },
  },
];
const trackers = {
  trackers: [
    {
      tracker: IssueTrackerKind.make("linear"),
      displayName: "Linear",
      host: "linear.app",
      scopeNoun: "team",
      credential: { label: "Personal API key", helpUrl: null },
      connected: true,
      account: "fixture",
      detail: null,
      workspace: "acme",
      scopes: [],
    },
  ],
  bindings: { [projectId]: { tracker: IssueTrackerKind.make("linear"), scope: "WEB" } },
};

it.each([
  "https://linear.app/acme/issue/WEB-7/title",
  "https://github.com/acme/web/issues/7",
  "https://gitlab.com/acme/web/-/issues/7",
  "https://codeberg.org/acme/web/issues/7",
  "https://dev.azure.com/acme/Project/_workitems/edit/7",
])("never intercepts %s, even with retained project/account bindings", (url) => {
  const original = structuredClone({ projects, trackers });
  expect(isStandaloneIssueLink(url)).toBe(false);
  expect(mayContainStandaloneIssueLink(`Read ${url} for context.`)).toBe(false);
  expect(
    resolveIssueLinkTarget({ url, projects, trackers, preferredProjectId: projectId }),
  ).toBeNull();
  expect({ projects, trackers }).toEqual(original);
});
