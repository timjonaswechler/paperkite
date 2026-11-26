import type { EnvironmentId } from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { pipe } from "effect/Function";
import type {
  ThreadLinkedPullRequest,
  ThreadPullRequestLink,
  VcsStatusResult,
} from "@t3tools/contracts";
import { msg, T, useMessages } from "gt-react";
import { m, type MessageResolver } from "../i18n/messages";
import {
  pullRequestListLines,
  resolveThreadPullRequestChains,
  type ThreadPullRequestBadge,
  threadPullRequestKeysEqual,
  visibleThreadPullRequests,
} from "@t3tools/client-runtime/thread-pull-requests";
import { useRender } from "@base-ui/react/use-render";
import type { ReactNode, MouseEvent, ReactElement } from "react";
import { cn } from "../lib/utils";
import { sourceControlClients } from "@t3tools/client-runtime/source-control-clients";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import { changeRequestTermKind, type ChangeRequestTermKind } from "./pullRequest/changeRequestTerm";
import {
  PULL_REQUEST_STATE_PRESENTATION,
  PullRequestGlyph,
  type PullRequestGlyphIcon,
} from "./pullRequest/pullRequestIcons";
import { resolvePullRequestState } from "./pullRequest/pullRequestPresentation";

export interface PrStatusIndicator {
  label: string;
  colorClass: string;
  Icon: PullRequestGlyphIcon;
  tooltip: string;
  tooltipLead: string;
  tooltipTitle: string;
  url: string;
}

export type ThreadPr = VcsStatusResult["pr"];

export interface LinkedThreadPullRequestStatus {
  readonly pr: NonNullable<ThreadPr>;
  readonly sourceControlProvider: NonNullable<VcsStatusResult["sourceControlProvider"]>;
}

function changeRequestTerminologyForUrl(url: string | undefined) {
  const host = url === undefined ? null : sourceControlClients.findByChangeRequestUrl(url);
  return (host ?? sourceControlClients.get(undefined)).changeRequest;
}

export function linkedPullRequestSnapshotStatus(
  link: ThreadPullRequestLink,
): LinkedThreadPullRequestStatus | null {
  const snapshot = link.snapshot;
  if (snapshot === null) return null;
  const kind = (
    sourceControlClients.findByChangeRequestUrl(link.url) ?? sourceControlClients.get(undefined)
  ).kind;
  return {
    pr: {
      number: link.number,
      url: link.url,
      title: snapshot.title,
      state: snapshot.state,
      isDraft: snapshot.isDraft,
      headRef: snapshot.headBranch,
      baseRef: snapshot.baseBranch,
      ...(snapshot.updatedAt === null ? {} : { updatedAt: snapshot.updatedAt }),
    },
    sourceControlProvider: { kind, name: kind, baseUrl: "" },
  };
}

export {
  resolveThreadPullRequestBadge,
  type ThreadPullRequestBadge,
} from "@t3tools/client-runtime/thread-pull-requests";

export interface ThreadPullRequestBadgePresentation {
  readonly Icon: PullRequestGlyphIcon;
  readonly toneClassName: string;
  readonly label: string;
  readonly text: string | number;
}

type PullRequestBadgeState = ThreadPullRequestBadge["state"];

function stackBadgeLabel(
  state: PullRequestBadgeState,
  count: number,
  term: ChangeRequestTermKind,
  resolve: MessageResolver,
): string {
  switch (state) {
    case "open":
      return resolve(
        msg(
          "{count, plural, one {Stack of {count} {term, select, mr {merge requests} cr {change requests} other {pull requests}}, open} other {Stack of {count} {term, select, mr {merge requests} cr {change requests} other {pull requests}}, open}}",
          { count, term },
        ),
      );
    case "draft":
      return resolve(
        msg(
          "{count, plural, one {Stack of {count} {term, select, mr {merge requests} cr {change requests} other {pull requests}}, draft} other {Stack of {count} {term, select, mr {merge requests} cr {change requests} other {pull requests}}, draft}}",
          { count, term },
        ),
      );
    case "closed":
      return resolve(
        msg(
          "{count, plural, one {Stack of {count} {term, select, mr {merge requests} cr {change requests} other {pull requests}}, closed} other {Stack of {count} {term, select, mr {merge requests} cr {change requests} other {pull requests}}, closed}}",
          { count, term },
        ),
      );
    case "merged":
      return resolve(
        msg(
          "{count, plural, one {Stack of {count} {term, select, mr {merge requests} cr {change requests} other {pull requests}}, merged} other {Stack of {count} {term, select, mr {merge requests} cr {change requests} other {pull requests}}, merged}}",
          { count, term },
        ),
      );
  }
}

function moreLinkedBadgeLabel(
  state: PullRequestBadgeState,
  tooltip: string,
  others: number,
  resolve: MessageResolver,
): string {
  switch (state) {
    case "open":
      return resolve(
        msg(
          "{others, plural, one {{tooltip}, and {others} more linked; overall open} other {{tooltip}, and {others} more linked; overall open}}",
          { tooltip, others },
        ),
      );
    case "draft":
      return resolve(
        msg(
          "{others, plural, one {{tooltip}, and {others} more linked; overall draft} other {{tooltip}, and {others} more linked; overall draft}}",
          { tooltip, others },
        ),
      );
    case "closed":
      return resolve(
        msg(
          "{others, plural, one {{tooltip}, and {others} more linked; overall closed} other {{tooltip}, and {others} more linked; overall closed}}",
          { tooltip, others },
        ),
      );
    case "merged":
      return resolve(
        msg(
          "{others, plural, one {{tooltip}, and {others} more linked; overall merged} other {{tooltip}, and {others} more linked; overall merged}}",
          { tooltip, others },
        ),
      );
  }
}

function prStatusLabels(
  state: PullRequestBadgeState,
  term: ChangeRequestTermKind,
  number: number,
  resolve: MessageResolver,
): { readonly label: string; readonly tooltipLead: string } {
  switch (state) {
    case "open":
      return {
        label: resolve(
          msg("{term, select, mr {MR} cr {change request} other {PR}} open", { term }),
        ),
        tooltipLead: resolve(
          msg("{term, select, mr {MR} cr {change request} other {PR}} #{number} - Open", {
            term,
            number,
          }),
        ),
      };
    case "draft":
      return {
        label: resolve(
          msg("{term, select, mr {MR} cr {change request} other {PR}} draft", { term }),
        ),
        tooltipLead: resolve(
          msg("{term, select, mr {MR} cr {change request} other {PR}} #{number} - Draft", {
            term,
            number,
          }),
        ),
      };
    case "closed":
      return {
        label: resolve(
          msg("{term, select, mr {MR} cr {change request} other {PR}} closed", { term }),
        ),
        tooltipLead: resolve(
          msg("{term, select, mr {MR} cr {change request} other {PR}} #{number} - Closed", {
            term,
            number,
          }),
        ),
      };
    case "merged":
      return {
        label: resolve(
          msg("{term, select, mr {MR} cr {change request} other {PR}} merged", { term }),
        ),
        tooltipLead: resolve(
          msg("{term, select, mr {MR} cr {change request} other {PR}} #{number} - Merged", {
            term,
            number,
          }),
        ),
      };
  }
}

function resolveThreadPullRequestBadgePresentation(
  {
    badge,
    number,
    url,
    status,
  }: {
    readonly badge: ThreadPullRequestBadge | null;
    readonly number?: number | undefined;
    readonly url?: string | undefined;
    readonly status: PrStatusIndicator | null;
  },
  resolve: MessageResolver = m,
): ThreadPullRequestBadgePresentation | null {
  const terminology = changeRequestTerminologyForUrl(url);
  if (badge?.kind === "stack") {
    const aggregate = PULL_REQUEST_STATE_PRESENTATION[badge.state];
    return {
      Icon: PullRequestGlyph.stack,
      toneClassName: aggregate.toneClassName,
      label: stackBadgeLabel(
        badge.state,
        badge.layers,
        changeRequestTermKind(terminology),
        resolve,
      ),
      text: badge.layers,
    };
  }
  if (number === undefined || url === undefined) return null;

  const tooltip =
    status?.tooltip ??
    resolve(
      msg("{term, select, mr {MR} cr {change request} other {PR}} #{number}, status pending", {
        term: changeRequestTermKind(terminology),
        number,
      }),
    );
  if (badge?.kind === "pull-request" && badge.others > 0) {
    const aggregate = PULL_REQUEST_STATE_PRESENTATION[badge.state];
    return {
      Icon: aggregate.Icon,
      toneClassName: aggregate.toneClassName,
      label: moreLinkedBadgeLabel(badge.state, tooltip, badge.others, resolve),
      text: `+${badge.others + 1}`,
    };
  }
  return {
    Icon: status?.Icon ?? PullRequestGlyph.pullRequest,
    toneClassName: status?.colorClass ?? "text-muted-foreground",
    label: tooltip,
    text: number,
  };
}

export function ThreadPullRequestBadgeControl({
  render,
  badge,
  pullRequests,
  number,
  url,
  status,
  onOpenList,
  onOpenPullRequest,
}: {
  render: ReactElement<{ render?: useRender.RenderProp }>;
  badge: ThreadPullRequestBadge | null;
  pullRequests: ReadonlyArray<ThreadPullRequestLink>;
  number?: number | undefined;
  url?: string | undefined;
  status: PrStatusIndicator | null;
  onOpenList: () => void;
  onOpenPullRequest: (event: MouseEvent<HTMLElement>, url?: string) => void;
}) {
  const m = useMessages();
  const presentation = resolveThreadPullRequestBadgePresentation({ badge, number, url, status }, m);
  if (presentation === null) return null;
  return (
    <PullRequestBadge
      render={render}
      presentation={presentation}
      opensList={badge !== null && (badge.kind === "stack" || badge.others > 0)}
      url={url}
      number={number}
      status={status}
      pullRequests={pullRequests}
      onOpenList={onOpenList}
      onOpenPullRequest={onOpenPullRequest}
    />
  );
}

function PullRequestBadge({
  render,
  presentation,
  opensList,
  url,
  number,
  status,
  pullRequests,
  onOpenList,
  onOpenPullRequest,
}: {
  render: ReactElement<{ render?: useRender.RenderProp }>;
  presentation: NonNullable<ReturnType<typeof resolveThreadPullRequestBadgePresentation>>;
  opensList: boolean;
  url: string | undefined;
  number: number | undefined;
  status: PrStatusIndicator | null;
  pullRequests: ReadonlyArray<ThreadPullRequestLink>;
  onOpenList: () => void;
  onOpenPullRequest: (event: MouseEvent<HTMLElement>, url?: string) => void;
}) {
  const onClick = opensList
    ? (event: MouseEvent<HTMLElement>) => {
        event.preventDefault();
        event.stopPropagation();
        onOpenList();
      }
    : onOpenPullRequest;
  const element = opensList ? (
    <button type="button" />
  ) : (
    <a href={url} target="_blank" rel="noopener noreferrer" />
  );
  const control = useRender({
    render,
    props: {
      render: element,
      "aria-label": presentation.label,
      onPointerDown: (event: MouseEvent<HTMLElement>) => event.stopPropagation(),
      onClick,
    },
  });
  return (
    <Tooltip key={opensList ? "list" : "link"}>
      <TooltipTrigger render={control}>
        <span
          className={cn("contents font-normal text-xs tabular-nums", presentation.toneClassName)}
        >
          <presentation.Icon aria-hidden className="size-3 shrink-0" />
          <span>{presentation.text}</span>
        </span>
      </TooltipTrigger>
      <TooltipPopup
        side="top"
        sideOffset={0}
        variant="glass"
        className="pointer-events-auto w-80 max-w-[calc(100vw-2rem)] text-left whitespace-normal"
      >
        <div className="-mx-1 max-h-[calc(var(--available-height)-0.5rem-2px)] overflow-y-auto overscroll-contain">
          {visibleThreadPullRequests(pullRequests).length > 0 ? (
            <ThreadPullRequestsMiniList
              pullRequests={pullRequests}
              onOpenPullRequest={onOpenPullRequest}
            />
          ) : number !== undefined && url !== undefined ? (
            <ul className="flex flex-col gap-1">
              <ThreadPullRequestMiniListItem
                number={number}
                url={url}
                title={status?.tooltipTitle ?? presentation.label}
                presentation={presentation}
                onOpenPullRequest={onOpenPullRequest}
              />
            </ul>
          ) : null}
        </div>
      </TooltipPopup>
    </Tooltip>
  );
}

export function ThreadPullRequestsMiniList({
  pullRequests,
  onOpenPullRequest,
}: {
  pullRequests: ReadonlyArray<ThreadPullRequestLink>;
  onOpenPullRequest?: (event: MouseEvent<HTMLAnchorElement>, url: string) => void;
}) {
  const lines = pipe(
    visibleThreadPullRequests(pullRequests),
    resolveThreadPullRequestChains,
    pullRequestListLines,
  );
  if (lines.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1">
      {lines.map((line) => {
        const snapshot = line.link.snapshot;
        const presentation =
          snapshot === null
            ? null
            : resolvePullRequestState({ state: snapshot.state, isDraft: snapshot.isDraft });
        return (
          <ThreadPullRequestMiniListItem
            key={`${line.link.host}/${line.link.repository}#${line.link.number}`}
            number={line.link.number}
            url={line.link.url}
            title={snapshot?.title ?? line.link.repository}
            presentation={presentation}
            depth={line.depth}
            onOpenPullRequest={onOpenPullRequest}
          >
            {line.stack ? (
              <span className="ml-auto shrink-0 pl-1 text-3xs">
                {line.stack.kind === "native" ? (
                  <T context="a native stack of pull requests">stack</T>
                ) : (
                  <T context="a chain of pull requests based on each other">chain</T>
                )}{" "}
                · {line.stack.size}
              </span>
            ) : null}
          </ThreadPullRequestMiniListItem>
        );
      })}
    </ul>
  );
}

function ThreadPullRequestMiniListItem({
  number,
  url,
  title,
  presentation,
  depth = 0,
  onOpenPullRequest,
  children,
}: {
  number: number;
  url: string;
  title: string;
  presentation: Pick<ThreadPullRequestBadgePresentation, "Icon" | "toneClassName"> | null;
  depth?: number;
  onOpenPullRequest?: ((event: MouseEvent<HTMLAnchorElement>, url: string) => void) | undefined;
  children?: ReactNode;
}) {
  const Icon = presentation?.Icon ?? PullRequestGlyph.pullRequest;
  const content = (
    <>
      <Icon
        aria-hidden
        className={cn("size-3 shrink-0", presentation?.toneClassName ?? "stroke-muted-foreground")}
      />
      <span className="shrink-0 font-mono tabular-nums">#{number}</span>
      <span className="min-w-0 truncate text-foreground/75">{title}</span>
      {children}
    </>
  );
  return (
    <li style={{ paddingLeft: `${Math.min(depth, 3) * 0.75}rem` }}>
      {onOpenPullRequest ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-w-0 items-center gap-2 rounded-sm px-1 py-1 hover:bg-accent focus-visible:bg-accent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => onOpenPullRequest(event, url)}
        >
          {content}
        </a>
      ) : (
        <div className="flex min-w-0 items-center gap-2">{content}</div>
      )}
    </li>
  );
}

export function prStatusIndicator(
  pr: ThreadPr,
  provider: VcsStatusResult["sourceControlProvider"] | null | undefined,
  resolve: MessageResolver = m,
): PrStatusIndicator | null {
  if (!pr) return null;
  const term = changeRequestTermKind(sourceControlClients.get(provider?.kind).changeRequest);
  const state = resolvePullRequestState({ state: pr.state, isDraft: pr.isDraft === true }, resolve);
  const { label, tooltipLead } = prStatusLabels(
    pr.state === "open" && pr.isDraft === true ? "draft" : pr.state,
    term,
    pr.number,
    resolve,
  );
  return {
    label,
    colorClass: state.toneClassName,
    Icon: state.Icon,
    tooltip: resolve(msg("{tooltipLead}: {title}", { tooltipLead, title: pr.title })),
    tooltipLead,
    tooltipTitle: pr.title,
    url: pr.url,
  };
}

export function ChangeRequestStatusIcon({
  state,
  isDraft = false,
  className,
}: Pick<NonNullable<ThreadPr>, "state"> & {
  readonly isDraft?: boolean | undefined;
  readonly className?: string | undefined;
}) {
  const presentation = resolvePullRequestState({ state, isDraft });
  return <presentation.Icon className={className} />;
}

export function resolveDisplayedThreadPr(input: {
  threadBranch: string | null;
  gitStatus: VcsStatusResult | null;
  linkedPullRequest?: ThreadLinkedPullRequest | null | undefined;
  linkedPullRequestStatus?: LinkedThreadPullRequestStatus | null | undefined;
}): ThreadPr | null {
  const { threadBranch, gitStatus, linkedPullRequest, linkedPullRequestStatus } = input;
  if (linkedPullRequest != null) {
    return linkedPullRequestStatus?.pr ?? null;
  }
  if (
    threadBranch !== null &&
    gitStatus !== null &&
    gitStatus.refName === threadBranch &&
    gitStatus.pr?.state === "open"
  ) {
    return gitStatus.pr;
  }

  return null;
}

export function resolveDisplayedThreadPrProvider(input: {
  threadBranch: string | null;
  gitStatus: VcsStatusResult | null;
  linkedPullRequest?: ThreadLinkedPullRequest | null | undefined;
  linkedPullRequestStatus?: LinkedThreadPullRequestStatus | null | undefined;
}): VcsStatusResult["sourceControlProvider"] | undefined {
  const { gitStatus, linkedPullRequest, linkedPullRequestStatus } = input;
  if (linkedPullRequest != null) {
    return linkedPullRequestStatus?.sourceControlProvider;
  }
  if (resolveDisplayedThreadPr(input) !== null) {
    return gitStatus?.sourceControlProvider;
  }

  return undefined;
}

export function resolvePullRequestTabLink(
  threads: readonly Pick<EnvironmentThreadShell, "environmentId" | "pullRequests">[],
  environmentId: EnvironmentId | null,
  host: string | null,
  reference: { repository: string; number: number },
) {
  if (environmentId === null || host === null) return undefined;
  // Keys are cached per object, so one target normalizes once instead of once per link.
  const target = { host, repository: reference.repository, number: reference.number };
  let newest: EnvironmentThreadShell["pullRequests"][number] | undefined;
  for (const thread of threads) {
    if (thread.environmentId !== environmentId) continue;
    for (const link of visibleThreadPullRequests(thread.pullRequests)) {
      if (!threadPullRequestKeysEqual(link, target)) continue;
      if (
        newest === undefined ||
        (link.snapshot?.syncedAt ?? "") > (newest.snapshot?.syncedAt ?? "")
      )
        newest = link;
    }
  }
  return newest;
}
