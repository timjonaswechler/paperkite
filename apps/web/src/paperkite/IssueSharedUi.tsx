// Native generic issue UI is separated from the PR queries that share its upstream modules.
// Native generic issue UI is separated from the PR queries that share its upstream modules.
import type {
  EnvironmentId,
  ProjectId,
  PullRequestReaction,
  PullRequestReactionContent,
} from "@t3tools/contracts";
import { msg, useGT, useLocale, useMessages } from "gt-react";
import { ChevronRightIcon, SearchIcon, SmilePlusIcon } from "lucide-react";
import { useRef, useState, type ElementType, type ReactNode } from "react";
import { m } from "~/i18n/messages";
import { cn } from "~/lib/utils";
import { sectionCollapseAnchorScrollTop } from "~/components/pullRequest/pullRequestSummaryScroll.logic";
import { ProjectFavicon, type ProjectFaviconProject } from "~/components/ProjectFavicon";
import { Spinner } from "~/components/ui/spinner";
import { InputGroup, InputGroupAddon, InputGroupInput } from "~/components/ui/input-group";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "~/components/ui/collapsible";
import {
  MenuGroupLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRadioItemIndicator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
} from "~/components/ui/menu";
import { Popover, PopoverPopup, PopoverTrigger } from "~/components/ui/popover";
import { toastManager } from "~/components/ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import {
  applyPendingPullRequestReactions,
  type PendingPullRequestReaction,
  PULL_REQUEST_REACTION_ORDER,
  pullRequestReactionEmoji,
  pullRequestReactionName,
  pullRequestReactionTooltip,
  pullRequestReactionsSignature,
} from "@t3tools/client-runtime/pull-request-reactions";

export function PullRequestMetaRow({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="grid min-h-7 min-w-0 grid-cols-[6rem_minmax(0,1fr)] items-center gap-2 text-xs sm:min-h-6">
      <span className="flex items-center gap-1.5 text-muted-foreground">
        {icon}
        {label}
      </span>
      <span className="min-w-0 text-foreground">{children}</span>
    </div>
  );
}

export function PullRequestSection({
  title,
  name,
  defaultOpen = true,
  keepMounted = false,
  revealCount = 0,
  actions,
  children,
}: {
  title: string;
  /** Stable key for links that reveal this section, since the title is translated. */
  name?: string;
  defaultOpen?: boolean;
  keepMounted?: boolean;
  /** Reopens the section each time a link reveals it. */
  revealCount?: number;
  actions?: ReactNode;
  children: ReactNode;
}) {
  // A reveal opens at once: the opening animation would move what was just scrolled to.
  const [open, setOpen] = useState<boolean | "revealed">(
    revealCount > 0 ? "revealed" : defaultOpen,
  );
  const [seenRevealCount, setSeenRevealCount] = useState(revealCount);
  if (revealCount !== seenRevealCount) {
    setSeenRevealCount(revealCount);
    setOpen("revealed");
  }
  const headingRef = useRef<HTMLDivElement>(null);
  const setOpenWithScrollAnchor = (nextOpen: boolean) => {
    if (!nextOpen) {
      const heading = headingRef.current;
      const section = heading?.closest<HTMLElement>("[data-pull-request-summary-section]");
      const scroller = heading?.closest<HTMLElement>("[data-pull-request-summary-scroll]");
      if (heading && section && scroller) {
        const target = sectionCollapseAnchorScrollTop({
          scrollTop: scroller.scrollTop,
          viewportTop: scroller.getBoundingClientRect().top,
          sectionTop: section.getBoundingClientRect().top,
          headingTop: heading.getBoundingClientRect().top,
        });
        // Adjust before paint to keep the collapsed heading in place.
        if (target !== null) scroller.scrollTop = target;
      }
    }
    setOpen(nextOpen);
  };
  return (
    <Collapsible
      open={open !== false}
      onOpenChange={setOpenWithScrollAnchor}
      render={<section aria-label={title} />}
      data-pull-request-summary-section={name ?? ""}
    >
      <div
        ref={headingRef}
        className="sticky top-0 z-10 flex w-full items-center bg-background pr-4"
      >
        <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-1.5 px-4 py-3 text-left text-xs font-medium text-muted-foreground hover:text-foreground">
          <span>{title}</span>
          <ChevronRightIcon
            aria-hidden
            className={cn(
              "size-3.5 text-muted-foreground/60 transition-transform",
              open && "rotate-90",
            )}
          />
        </CollapsibleTrigger>
        {actions}
      </div>
      <CollapsiblePanel keepMounted={keepMounted} animate={open !== "revealed"}>
        <div className="px-4 pb-4">{children}</div>
      </CollapsiblePanel>
    </Collapsible>
  );
}

const PILL_CLASS =
  "inline-flex h-6 shrink-0 items-center gap-1 rounded-full border px-2 text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

const EMPTY_PENDING: ReadonlyMap<PullRequestReactionContent, PendingPullRequestReaction> =
  new Map();

/** Reaction pills with a picker. `onReact` resolves to whether the host saved the change. */
export function ReactionBar({
  reactions,
  canReact,
  onReact,
  className,
}: {
  readonly reactions: ReadonlyArray<PullRequestReaction>;
  readonly canReact: boolean;
  readonly onReact: (content: PullRequestReactionContent, reacted: boolean) => Promise<boolean>;
  readonly className?: string | undefined;
}) {
  const gt = useGT();
  const messages = useMessages();
  const locale = useLocale();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pending, setPending] = useState<{
    readonly signature: string;
    readonly values: ReadonlyMap<PullRequestReactionContent, PendingPullRequestReaction>;
  }>({ signature: "", values: EMPTY_PENDING });

  const signature = pullRequestReactionsSignature(reactions);
  const values = pending.signature === signature ? pending.values : EMPTY_PENDING;
  const shown = applyPendingPullRequestReactions(reactions, values);

  const toggle = async (content: PullRequestReactionContent, reacted: boolean) => {
    const entry: PendingPullRequestReaction = { reacted };
    setPending({ signature, values: new Map([...values, [content, entry]]) });
    if (await onReact(content, reacted)) return;
    setPending((current) => {
      if (current.values.get(content) !== entry) return current;
      const next = new Map(current.values);
      next.delete(content);
      return { signature: current.signature, values: next };
    });
    toastManager.add({ type: "error", title: m(msg("The reaction could not be saved")) });
  };

  if (shown.length === 0 && !canReact) return null;

  return (
    <div className={cn("flex min-w-0 max-w-full flex-wrap items-center gap-1", className)}>
      {shown.map((reaction) => (
        <Tooltip key={reaction.content}>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-pressed={reaction.viewerHasReacted}
                aria-label={gt("{reaction}, {count}", {
                  reaction: pullRequestReactionName(reaction.content, messages),
                  count: reaction.count,
                  $context: "reaction button: reaction name and how many people used it",
                })}
                disabled={!canReact}
                className={cn(
                  PILL_CLASS,
                  reaction.viewerHasReacted
                    ? "border-primary/60 bg-primary/10 text-foreground"
                    : "border-border/70 bg-muted/40 text-muted-foreground",
                  canReact ? "hover:border-primary/60" : "cursor-default",
                )}
                onClick={() => void toggle(reaction.content, !reaction.viewerHasReacted)}
              />
            }
          >
            <span aria-hidden>{pullRequestReactionEmoji(reaction.content)}</span>
            <span className="tabular-nums">{reaction.count}</span>
          </TooltipTrigger>
          <TooltipPopup side="top">
            {pullRequestReactionTooltip(reaction, messages, locale)}
          </TooltipPopup>
        </Tooltip>
      ))}

      {canReact ? (
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger
            render={
              <button
                type="button"
                aria-label={gt("Add a reaction")}
                className={cn(
                  PILL_CLASS,
                  "border-border/70 px-1.5 text-muted-foreground hover:border-primary/60 hover:text-foreground",
                )}
              />
            }
          >
            <SmilePlusIcon aria-hidden className="size-3.5" />
          </PopoverTrigger>
          <PopoverPopup align="start" side="top" padding="compact">
            <div className="flex items-center gap-0.5">
              {PULL_REQUEST_REACTION_ORDER.map((content) => {
                const reacted =
                  shown.find((reaction) => reaction.content === content)?.viewerHasReacted ?? false;
                return (
                  <button
                    key={content}
                    type="button"
                    aria-pressed={reacted}
                    aria-label={pullRequestReactionName(content, messages)}
                    className={cn(
                      "flex size-7 items-center justify-center rounded-md text-base outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                      reacted && "bg-primary/10",
                    )}
                    onClick={() => {
                      setPickerOpen(false);
                      void toggle(content, !reacted);
                    }}
                  >
                    <span aria-hidden>{pullRequestReactionEmoji(content)}</span>
                  </button>
                );
              })}
            </div>
          </PopoverPopup>
        </Popover>
      ) : null}
    </div>
  );
}

export interface PullRequestFilterOption<Value extends string> {
  readonly value: Value;
  readonly label: string;
  readonly Icon: ElementType<{ className?: string }>;
  readonly project?: ProjectFaviconProject;
  readonly unavailable?: string | undefined;
}

export function PullRequestFilterOptionIcon<Value extends string>({
  option,
}: {
  option: PullRequestFilterOption<Value>;
}) {
  return option.project ? (
    <ProjectFavicon project={option.project} className="size-3.5" />
  ) : (
    <option.Icon aria-hidden className="size-3.5" />
  );
}

export function PullRequestSearchInput({
  value,
  busy,
  label,
  placeholder,
  onChange,
  onSubmit,
}: {
  value: string;
  busy?: boolean;
  label: string;
  placeholder: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <InputGroup className="min-w-0 flex-1 **:[input]:h-9 sm:**:[input]:h-8">
      <InputGroupAddon>
        {busy ? <Spinner aria-hidden /> : <SearchIcon aria-hidden />}
      </InputGroupAddon>
      {/* Native search inputs clear on Escape even during IME composition. */}
      <InputGroupInput
        type="text"
        role="searchbox"
        value={draft ?? value}
        onFocus={() => setDraft(value)}
        onBlur={() => setDraft(null)}
        onChange={(event) => {
          setDraft(event.currentTarget.value);
          onChange(event.currentTarget.value);
          if ((event.nativeEvent as InputEvent).inputType === "insertFromPaste") {
            onSubmit(event.currentTarget.value);
          }
        }}
        onKeyDown={(event) => {
          const composing = event.nativeEvent.isComposing || event.keyCode === 229;
          if (event.key === "Enter" && !composing) onSubmit(event.currentTarget.value);
          if (event.key !== "Escape" || event.defaultPrevented) return;
          if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
          if (!composing && !event.currentTarget.value) return;
          // The pull requests page leaves on an Escape that reaches it.
          event.stopPropagation();
          if (composing) return;
          setDraft("");
          onChange("");
        }}
        placeholder={placeholder}
        aria-label={label}
      />
    </InputGroup>
  );
}

export const pullRequestProjectKey = (project: {
  readonly id: ProjectId;
  readonly environmentId: EnvironmentId;
}) => JSON.stringify([project.environmentId, project.id]);

function PullRequestFilterRadioGroup<Value extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: Value;
  options: ReadonlyArray<PullRequestFilterOption<Value>>;
  onChange: (value: Value) => void;
}) {
  const gt = useGT();
  return (
    <MenuRadioGroup
      value={value}
      onValueChange={(next) => {
        if (next !== value) onChange(next as Value);
      }}
    >
      <MenuGroupLabel>{label}</MenuGroupLabel>
      {options.map((option) => {
        const item = (
          <MenuRadioItem
            key={option.value}
            value={option.value}
            className={option.unavailable ? "data-disabled:pointer-events-auto" : undefined}
            disabled={option.unavailable !== undefined}
          >
            <span className="flex min-w-0 items-center gap-2">
              <PullRequestFilterOptionIcon option={option} />
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
              {option.unavailable ? (
                <span className="shrink-0">
                  · {gt("Unavailable", { $context: "filter option" })}
                </span>
              ) : null}
              <MenuRadioItemIndicator />
            </span>
          </MenuRadioItem>
        );
        if (!option.unavailable) return item;
        return (
          <Tooltip key={option.value}>
            <TooltipTrigger render={item} />
            <TooltipPopup side="top">{option.unavailable}</TooltipPopup>
          </Tooltip>
        );
      })}
    </MenuRadioGroup>
  );
}

export function PullRequestFilterRadioSubmenu<Value extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: Value;
  options: ReadonlyArray<PullRequestFilterOption<Value>>;
  onChange: (value: Value) => void;
}) {
  const current = options.find((option) => option.value === value) ?? options[0];
  if (!current) return null;
  return (
    <MenuSub>
      <MenuSubTrigger>
        <PullRequestFilterOptionIcon option={current} />
        <span className="flex-1">{label}</span>
        <span className="min-w-0 max-w-32 truncate text-xs text-muted-foreground">
          {current.label}
        </span>
      </MenuSubTrigger>
      <MenuSubPopup>
        <PullRequestFilterRadioGroup
          label={label}
          value={value}
          options={options}
          onChange={onChange}
        />
      </MenuSubPopup>
    </MenuSub>
  );
}
