import { thrownErrorMessage } from "@t3tools/client-runtime/errors";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { type MouseEvent } from "react";
import { msg } from "gt-react";

import {
  resolveChangeRequestLinkTarget,
  resolvePullRequestPreviewTarget,
} from "@t3tools/client-runtime/change-request-links";

import { useOpenLink } from "../browser/useOpenLink";
import { useStableCallback } from "../hooks/useStableCallback";
import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { m } from "../i18n/messages";

import { appAtomRegistry } from "../rpc/atomRegistry";
import { readProjects, useProjects } from "../state/entities";
import { environmentServerConfigsAtom, serverEnvironment } from "../state/server";

export function usePullRequestPreviewTarget(environmentId: EnvironmentId | null, url: string) {
  const projects = useProjects();
  const serverConfig = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  return resolvePullRequestPreviewTarget({
    environmentId,
    projects,
    pullRequestsEnabled: serverConfig !== null,
    url,
  });
}

/** Where a click on this link opens the in-app panel, read at call time as the click reads it. */
export function pullRequestLinkPanelTarget(input: {
  readonly url: string;
  readonly environmentId: EnvironmentId | undefined;
  readonly primaryEnvironmentId: EnvironmentId | null;
  readonly lendHostProject: boolean;
}) {
  // Read at click time: every provider status push replaces the config map, and
  // subscribing would hand every rendered link a new handler. Projects likewise, so a
  // link can resolve against a snapshot that arrived after this handler was built.
  const serverConfigs = appAtomRegistry.get(environmentServerConfigsAtom);
  return resolveChangeRequestLinkTarget({
    url: input.url,
    projects: readProjects(),
    configLoaded: (environmentId) => serverConfigs.has(environmentId),
    environmentId: input.environmentId,
    primaryEnvironmentId: input.primaryEnvironmentId,
    lendHostProject: input.lendHostProject,
  });
}

function shouldOpenPullRequestExternally(
  event: Pick<MouseEvent<HTMLElement>, "metaKey" | "ctrlKey"> &
    Partial<Pick<MouseEvent<HTMLElement>, "button">>,
): boolean {
  return event.metaKey || event.ctrlKey || event.button === 1;
}

export function useOpenChangeRequestLink(
  _threadRef?: ScopedThreadRef,
  _panelRef?: ScopedThreadRef,
): (
  event: Pick<
    MouseEvent<HTMLElement>,
    "preventDefault" | "stopPropagation" | "metaKey" | "ctrlKey"
  > &
    Partial<Pick<MouseEvent<HTMLElement>, "button" | "shiftKey" | "altKey">>,
  targetUrl: string,
  targetThreadRef?: ScopedThreadRef,
  targetEnvironmentId?: EnvironmentId,
  onCommitUnavailable?: () => void,
) => boolean {
  return useStableCallback(() => false);
}

export function useOpenPrLink(threadRef?: ScopedThreadRef) {
  const openChangeRequest = useOpenChangeRequestLink(threadRef);
  const openLink = useOpenLink(threadRef);
  return (event: MouseEvent<HTMLElement>, prUrl: string, targetThreadRef?: ScopedThreadRef) => {
    if (event.button > 1) return false;
    event.stopPropagation();
    const openInBrowser = shouldOpenPullRequestExternally(event);
    const isAnchor =
      event.currentTarget instanceof HTMLAnchorElement && event.currentTarget.href.length > 0;
    // Native links handle modified clicks; buttons still need openExternal.
    if (openInBrowser && isAnchor) return false;

    event.preventDefault();
    if (!openInBrowser && openChangeRequest(event, prUrl, targetThreadRef)) return true;

    void openLink(prUrl, { event, threadRef: targetThreadRef }).catch((error: unknown) => {
      console.error(error);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: m(msg("Unable to open pull request link")),
          description: thrownErrorMessage(error, m) ?? m(msg("An error occurred.")),
        }),
      );
    });
    return false;
  };
}
