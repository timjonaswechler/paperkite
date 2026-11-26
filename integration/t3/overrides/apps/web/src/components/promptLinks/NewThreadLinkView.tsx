import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  findPromptLinkProjects,
  resolvePromptLinkModelSelection,
} from "@t3tools/client-runtime/prompt-links";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";

import { type NewThreadLink } from "@t3tools/shared/promptLinks";
import { useAtomValue } from "@effect/atom-react";
import { useLocation, useNavigate } from "@tanstack/react-router";

import { T, useGT } from "gt-react";
import { type ReactNode, useEffect, useEffectEvent, useRef, useState } from "react";

import { useComposerDraftStore } from "~/composerDraftStore";
import { isElectron } from "~/env";
import { useNewThreadHandler } from "~/hooks/useHandleNewThread";
import { useScratchProject } from "~/hooks/useScratchProject";
import { useProjects, useThreadShells } from "~/state/entities";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { usePrimaryEnvironmentId } from "~/state/environments";
import { environmentPresentations } from "~/state/presentation";
import { allReachableShellsLiveAtom } from "~/state/shell";

import { sortScopedProjectsForSidebar } from "../Sidebar.logic";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { SidebarInset } from "../ui/sidebar";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { placeLinkedPrompt } from "./linkedPrompt";

type LinkState =
  | { readonly status: "opening" }
  | { readonly status: "opened" }
  | { readonly status: "failed"; readonly message: string; readonly title?: string }
  | {
      readonly status: "pull-request-checkout";
      readonly project: EnvironmentProject;
    };

type LinkLaunch =
  | {
      readonly kind: "thread";
      readonly thread: Pick<ReturnType<typeof useThreadShells>[number], "environmentId" | "id">;
    }
  | { readonly kind: "draft"; readonly project: EnvironmentProject }
  | { readonly kind: "scratch" }
  | { readonly kind: "settled" };

const openedLinkKeys = new Set<string>();

export function NewThreadLinkView({ link }: { readonly link: NewThreadLink }) {
  const gt = useGT();
  return link.kind === "pull-request" ? (
    <LinkPage title={gt("Pull requests unavailable")} />
  ) : (
    <NewPromptThreadLinkView link={link} />
  );
}

function NewPromptThreadLinkView({
  link,
}: {
  readonly link: Extract<NewThreadLink, { kind: "new" }>;
}) {
  const locationKey = useLocation({ select: (location) => location.state.__TSR_key ?? "" });
  const gt = useGT();
  const navigate = useNavigate();
  const ready = useAtomValue(allReachableShellsLiveAtom);
  const projects = useProjects();
  const threads = useThreadShells();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const handleNewThread = useNewThreadHandler();
  const { scratchEnvironmentId, openScratchProject } = useScratchProject();
  const [state, setState] = useState<LinkState>(() =>
    openedLinkKeys.has(locationKey) ? { status: "opened" } : { status: "opening" },
  );
  const [started, setStarted] = useState(false);
  const [launch, setLaunch] = useState<LinkLaunch | null>(null);
  const launchedRef = useRef<LinkLaunch | null>(null);

  const recentProjects = () =>
    sortScopedProjectsForSidebar(
      projects.filter((project) => project.isScratch !== true),
      threads,
      "updated_at",
    );

  const lastActiveEnvironmentId = () => {
    let latest: (typeof threads)[number] | undefined;
    for (const thread of threads) {
      if (latest === undefined || thread.updatedAt > latest.updatedAt) latest = thread;
    }
    return latest?.environmentId ?? primaryEnvironmentId;
  };

  const openDraft = async (project: EnvironmentProject, extraPrompt?: string) => {
    const opened = await handleNewThread(scopeProjectRef(project.environmentId, project.id), {
      replace: true,
    }).catch(() => null);
    if (opened === null) {
      setState({ status: "failed", message: gt("T3 Code could not open a new thread.") });
      return;
    }
    setState({ status: "opened" });
    const notes: Array<string> = [];
    if (link.kind === "new" && link.provider !== null) {
      const providers =
        appAtomRegistry
          .get(environmentPresentations.providersByEnvironmentAtom)
          .get(project.environmentId) ?? [];
      const resolved = resolvePromptLinkModelSelection(providers, {
        provider: link.provider,
        model: link.model,
      });
      if (resolved !== null) {
        useComposerDraftStore.getState().setModelSelection(opened.draftId, resolved.selection, {
          explicit: true,
          replaceOptions: true,
        });
      }
      if (resolved === null || !resolved.exact) {
        notes.push(
          resolved === null
            ? gt(
                "The link asked for {provider}, which is not set up here, so your default model is used.",
                { provider: link.provider },
              )
            : gt(
                "The link asked for {model}, which {provider} does not offer here, so its default model is used.",
                { model: link.model, provider: link.provider },
              ),
        );
      }
    }
    const text = [link.prompt?.text, extraPrompt].filter(Boolean).join("\n\n");
    if (text.length === 0) return;
    placeLinkedPrompt(
      opened.draftId,
      { text, hiddenCharacters: link.prompt?.hiddenCharacters ?? 0 },
      notes,
    );
  };

  const openScratchDraft = async () => {
    const environmentId = scratchEnvironmentId(lastActiveEnvironmentId());
    const project = environmentId === null ? null : await openScratchProject(environmentId);
    if (project === null) {
      setState({
        status: "failed",
        message: gt("None of your machines can start a thread without a project right now."),
      });
      return;
    }
    await openDraft(project);
  };

  if (ready && state.status === "opening" && !started) {
    setStarted(true);
    const repository = link.repository;
    const project =
      repository === null ? undefined : findPromptLinkProjects(recentProjects(), repository)[0];
    if (repository === null) {
      setLaunch({ kind: "scratch" });
    } else if (project === undefined) {
      setLaunch({ kind: "scratch" });
    } else {
      setLaunch({ kind: "draft", project });
    }
  }

  const runLaunch = useEffectEvent((next: LinkLaunch) => {
    openedLinkKeys.add(locationKey);
    switch (next.kind) {
      case "thread": {
        const threadRef = scopeThreadRef(next.thread.environmentId, next.thread.id);
        if (link.prompt !== null) placeLinkedPrompt(threadRef, link.prompt);
        void navigate({
          to: "/$environmentId/$threadId",
          params: { environmentId: next.thread.environmentId, threadId: next.thread.id },
          replace: true,
        });
        return;
      }
      case "scratch":
        void openScratchDraft();
        return;
      case "draft":
        void openDraft(next.project);
        return;
      case "settled":
    }
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- runs each launch decision once: navigates to the thread or opens a draft
  useEffect(() => {
    if (launch === null || launchedRef.current === launch) return;
    launchedRef.current = launch;
    runLaunch(launch);
  }, [launch]);

  switch (state.status) {
    case "opening":
      return <LinkPage title={gt("Opening the link...")} />;
    case "opened":
      return (
        <LinkPage title={gt("This link is open")}>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              openedLinkKeys.delete(locationKey);
              setStarted(false);
              setState({ status: "opening" });
            }}
          >
            <T>Open it again</T>
          </Button>
        </LinkPage>
      );
    case "failed":
      return (
        <LinkPage
          title={state.title ?? gt("Could not open the link")}
          description={state.message}
        />
      );
    case "pull-request-checkout":
      return null;
  }
}

function LinkPage({
  title,
  description,
  children,
}: {
  readonly title: string;
  readonly description?: string;
  readonly children?: ReactNode;
}) {
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      {isElectron ? <WorkspacePageHeader electron /> : null}
      <Empty className="flex-1">
        <EmptyHeader className="max-w-md">
          <EmptyTitle>{title}</EmptyTitle>
          {description ? <EmptyDescription>{description}</EmptyDescription> : null}
          {children ? <div className="mt-5 flex justify-center gap-2">{children}</div> : null}
        </EmptyHeader>
      </Empty>
    </SidebarInset>
  );
}
