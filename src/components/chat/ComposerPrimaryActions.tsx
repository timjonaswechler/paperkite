// Send/interrupt branches extracted from T3 ComposerPrimaryActions.tsx (MIT).
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { Spinner } from "../ui/spinner";
export function ComposerPrimaryActions({
  running,
  sending,
  disabled,
  onInterrupt,
}: {
  running: boolean;
  sending: boolean;
  disabled: boolean;
  onInterrupt: () => void;
}) {
  return running ? (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full bg-destructive/90 text-white shadow-xs shadow-destructive/24 inset-shadow-control-highlight transition-colors duration-150 hover:bg-destructive active:inset-shadow-control-pressed active:shadow-none [&_svg]:pointer-events-none"
            onClick={onInterrupt}
            aria-label="Stoppen"
            disabled={sending}
          />
        }
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="currentColor"
          aria-hidden="true"
        >
          <rect x="2" y="2" width="8" height="8" rx="1.5" />
        </svg>
      </TooltipTrigger>
      <TooltipPopup>Durchlauf unterbrechen</TooltipPopup>
    </Tooltip>
  ) : (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex" />}>
        <button
          type="submit"
          className="relative isolate flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-message-action text-message-action-foreground shadow-xs enabled:cursor-pointer enabled:inset-shadow-control-highlight enabled:shadow-message-action/24 hover:bg-message-action-hover active:inset-shadow-control-pressed active:shadow-none disabled:pointer-events-none disabled:bg-foreground/12 disabled:text-muted-foreground disabled:shadow-none sm:h-8 sm:w-8 [&_svg]:pointer-events-none"
          disabled={disabled || sending}
          aria-label="Nachricht senden"
        >
          {sending ? (
            <Spinner size="sm" aria-hidden="true" />
          ) : (
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M7 11.5V2.5M7 2.5L3 6.5M7 2.5L11 6.5"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </button>
      </TooltipTrigger>
      <TooltipPopup>Nachricht senden</TooltipPopup>
    </Tooltip>
  );
}
