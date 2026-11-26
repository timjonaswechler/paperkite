import { SourceControlProviderKind } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";
import {
  appSignInTargetForRemote,
  capitalizeTerm,
  sourceControlClients,
} from "./sourceControlClients.ts";

const urls = [
  ["github", "https://github.com/Acme/Web/pull/42", "https://github.com/acme/web/issues/7"],
  [
    "gitlab",
    "https://gitlab.acme.test/group/web/-/merge_requests/42",
    "https://gitlab.acme.test/group/web/-/issues/7",
  ],
  ["gitcafe", "https://git.cafe/acme/web/pulls/42", "https://git.cafe/acme/web/issues/7"],
  [
    "tanstack-source",
    "https://source.tanstack.com/@acme/web/pull/42",
    "https://source.tanstack.com/@acme/web/issues/7",
  ],
  [
    "cursor-origin",
    "https://git.cursor.com/acme/web/pull/42",
    "https://git.cursor.com/acme/web/issues/7",
  ],
  ["forgejo", "https://codeberg.org/acme/web/pulls/42", "https://codeberg.org/acme/web/issues/7"],
  [
    "forgejo",
    "https://gitea.acme.test/acme/web/pulls/42",
    "https://gitea.acme.test/acme/web/issues/7",
  ],
  [
    "bitbucket",
    "https://bitbucket.org/acme/web/pull-requests/42",
    "https://bitbucket.org/acme/web/issues/7",
  ],
  [
    "azure-devops",
    "https://dev.azure.com/acme/Project/_git/web/pullrequest/42",
    "https://dev.azure.com/acme/Project/_workitems/edit/7",
  ],
  [
    "linear",
    "https://linear.app/acme/issue/WEB-42/title",
    "https://linear.app/acme/issue/WEB-7/title",
  ],
] as const;

it("keeps an empty catalog and a neutral fallback rather than choosing another host", () => {
  expect(sourceControlClients.definitions).toEqual([]);
  expect(sourceControlClients.get(undefined).kind).toBe("unknown");
  expect(sourceControlClients.get(null).kind).toBe("unknown");
  expect(sourceControlClients.get("future-host").kind).toBe("unknown");
});

it.each(urls)(
  "leaves %s links ordinary and offers no account, credentials or issue binding",
  (kind, pr, issue) => {
    const remote = new URL(pr).origin + "/acme/web.git";
    expect(sourceControlClients.get(kind).kind).toBe("unknown");
    expect(sourceControlClients.find(kind)).toBeUndefined();
    expect(sourceControlClients.findByPublicHost(new URL(pr).hostname)).toBeUndefined();
    expect(sourceControlClients.parseChangeRequestUrl(pr)).toBeNull();
    expect(sourceControlClients.findByChangeRequestUrl(pr)).toBeUndefined();
    expect(sourceControlClients.parseIssueUrl(issue)).toBeNull();
    expect(
      sourceControlClients.parseIssueUrl(issue, SourceControlProviderKind.make(kind)),
    ).toBeNull();
    expect(sourceControlClients.changeRequestUrlFromReferenceAutolink(pr)).toBeNull();
    expect(sourceControlClients.repositoryUrlFromPage(pr)).toBeNull();
    expect(sourceControlClients.mediaUrl(issue)).toBeNull();
    expect(sourceControlClients.recognizeRemote(remote)?.kind).toBe("unknown");
    expect(appSignInTargetForRemote(remote)).toBeNull();
    expect(
      sourceControlClients.issueBindings({
        canonicalKey: "fixture.test/acme/web",
        provider: SourceControlProviderKind.make(kind),
        locator: { source: "git-remote", remoteName: "origin", remoteUrl: remote },
        owner: "acme",
        name: "web",
      }),
    ).toEqual([]);
    expect(sourceControlClients.isSameChangeRequest(pr, pr)).toBe(false);
  },
);

it("preserves provider-neutral remote keys and labels without requiring a forge", () => {
  expect(sourceControlClients.repositoryKeyFromRemote("git@EXAMPLE.TEST:Acme/Web.git")).toBe(
    "example.test/acme/web",
  );
  expect(sourceControlClients.repositoryKeyFromRemote("https://example.test/Acme/Web.git")).toBe(
    "example.test/acme/web",
  );
  expect(capitalizeTerm("document comparison")).toBe("Document comparison");
  expect(capitalizeTerm("")).toBe("");
});

it.each(["javascript:alert(1)", "file:///tmp/repo", "not a URL", ""])(
  "does not enrich unsupported link input: %s",
  (url) => {
    expect(sourceControlClients.parseChangeRequestUrl(url)).toBeNull();
    expect(sourceControlClients.parseIssueUrl(url)).toBeNull();
    expect(sourceControlClients.parseCommitUrl(url)).toBeNull();
    expect(sourceControlClients.mediaUrl(url)).toBeNull();
  },
);
