import { expect, it } from "@effect/vitest";
import * as PaperkiteSourceControlDrivers from "../paperkite/integration/SourceControlDrivers.ts";
import {
  changeRequestsClosedBy,
  isChangeRequestCloseCommand,
  sourceControlDefinitions,
} from "./sourceControlDefinitions.ts";

it("registers no forge drivers, metadata, credentials or fallback provider", () => {
  expect(PaperkiteSourceControlDrivers.drivers).toEqual([]);
  expect(sourceControlDefinitions.definitions).toEqual([]);
  expect(sourceControlDefinitions.get(undefined).kind).toBe("unknown");
  expect(sourceControlDefinitions.get(null).kind).toBe("unknown");
});

it.each([
  "C:/repos/project",
  "C:\\repos\\project",
  "/srv/git/repo.git",
  "./team:group/repo",
  "file:///srv/git/repo.git",
  "hg::team/repo",
  "codecommit::us-east-1://repo",
])("finds no remote host in a local or unsupported path: %s", (remote) => {
  expect(sourceControlDefinitions.recognizeRemote(remote)).toBeNull();
});

it.each([
  "gh pr merge 19",
  "glab mr merge 19 --squash",
  "cafe pr merge 26271",
  "az repos pr update --id 19 --status completed",
  "tea pulls close 4",
])("does not attach forge semantics to ordinary shell text: %s", (command) => {
  expect(isChangeRequestCloseCommand(command)).toBe(false);
  expect(changeRequestsClosedBy(command)).toBe("any");
});
