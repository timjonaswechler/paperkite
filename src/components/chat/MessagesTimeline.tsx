// T3 MessagesTimeline lane, TimelineUserMessageRow bubble and TimelineAssistantRows presentation.
import { useEffect, useRef, useState } from "react";
import { ArrowDown, Check, Copy, Wrench } from "lucide-react";
import remarkGfm from "remark-gfm";
import type { ChatEvent } from "../../../shared/api";
import { createMarkdownRenderer } from "./markdownRenderer";
import { Button } from "../ui/button";
import { IconButton } from "../Controls";
const renderMarkdown = createMarkdownRenderer({
  remarkPlugins: [remarkGfm],
  rehypePlugins: [],
  components: {
    a: ({ children, href }) => (
      <a href={href} target="_blank" rel="noreferrer">
        {children}
      </a>
    ),
    img: () => null,
  },
  urlTransform: (url) => (/^https?:\/\//i.test(url) ? url : ""),
});
function MessageCopy({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);
  return (
    <>
      <IconButton
        label={copied ? "Kopiert" : "Nachricht kopieren"}
        size="icon-xs"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setError(false);
          } catch {
            setError(true);
          }
        }}
      >
        {copied ? <Check /> : <Copy />}
      </IconButton>
      {error && (
        <span role="status" className="text-xs text-destructive-foreground">
          Kopieren nicht verfügbar.
        </span>
      )}
    </>
  );
}
function Message({ event }: { event: ChatEvent }) {
  const text = event.payload.text || event.payload.error || "";
  if (event.type === "user")
    return (
      <div className="group @container flex flex-col items-end gap-1">
        <div className="relative min-w-0 max-w-[80%] rounded-2xl bg-message p-3 text-message-foreground">
          <h3 className="sr-only">Du</h3>
          <div className="chat-markdown user-message-markdown" dir="auto">
            {renderMarkdown(text, true)}
          </div>
        </div>
        <div className="flex w-full max-w-[80%] items-center justify-end pe-1 text-xs opacity-0 pointer-coarse:opacity-100 focus-within:opacity-100 group-hover:opacity-100">
          <MessageCopy text={text} />
        </div>
      </div>
    );
  if (event.type === "assistant")
    return (
      <div className="group/assistant relative min-w-0 px-1 py-0.5">
        <h3 className="sr-only">
          {event.payload.provider === "codex" ? "Codex" : "Pi"}
        </h3>
        <div className="chat-markdown" dir="auto">
          {renderMarkdown(text, true)}
        </div>
        <div className="mt-1.5 flex items-center gap-2 text-xs opacity-0 pointer-coarse:opacity-100 focus-within:opacity-100 group-hover/assistant:opacity-100">
          <MessageCopy text={text} />
          <span className="text-muted-foreground">
            {event.payload.provider === "codex" ? "Codex" : "Pi"}
          </span>
        </div>
      </div>
    );
  if (event.type === "tool")
    return (
      <details className="group/timeline-row rounded-md px-1 py-1 text-xs text-muted-foreground">
        <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md py-1 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
          <Wrench className="size-3.5" />
          <span>{event.payload.name || "Dokumentwerkzeug"}</span>
          <span className="ml-auto text-2xs">
            {/start|request/.test(event.payload.phase ?? "")
              ? "angefragt"
              : "beendet"}
          </span>
        </summary>
        <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border/60 bg-muted/30 p-3 font-mono text-xs">
          {JSON.stringify(event.payload, null, 2)}
        </pre>
      </details>
    );
  if (event.type === "error" || event.type === "notice")
    return (
      <div
        role={event.type === "error" ? "alert" : undefined}
        className={
          event.type === "error"
            ? "rounded-lg border border-destructive/20 bg-error-surface p-3 text-sm text-destructive-foreground"
            : "px-1 text-xs leading-relaxed text-muted-foreground"
        }
      >
        {text}
      </div>
    );
  if (event.type === "settled")
    return (
      <div className="flex items-center gap-3 px-1 py-1 text-2xs text-muted-foreground">
        <span className="h-px flex-1 bg-border/50" />
        Durchlauf beendet
        <span className="h-px flex-1 bg-border/50" />
      </div>
    );
  return null;
}
export function MessagesTimeline({
  events,
  streaming,
  loading,
}: {
  events: ChatEvent[];
  streaming: string;
  loading: boolean;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  useEffect(() => {
    if (stick.current && scroll.current)
      scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [events, streaming]);
  const visible = events.filter((event) =>
    ["user", "assistant", "tool", "notice", "error", "settled"].includes(
      event.type,
    ),
  );
  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scroll}
        className="h-full overflow-y-auto px-3 sm:px-5"
        aria-label="Chatverlauf"
        onScroll={(e) => {
          const el = e.currentTarget;
          const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          stick.current = bottom;
          setAtBottom(bottom);
        }}
      >
        {!visible.length && !streaming ? (
          <div className="flex h-full items-center justify-center">
            <p
              role="status"
              className="max-w-sm text-center text-sm leading-relaxed text-muted-foreground"
            >
              {loading
                ? "Verlauf wird geladen…"
                : "Hier beginnt dein Gespräch. Stelle eine Frage oder beschreibe, was du an dieser Bewerbung ändern möchtest."}
            </p>
          </div>
        ) : (
          <div className="mx-auto flex w-full max-w-(--chat-content-max-width) flex-col gap-4 py-4 sm:gap-5 sm:py-6">
            {visible.map((event) => (
              <div className="messages-timeline-row-frame" key={event.id}>
                <div className="chat-content-lane">
                  <Message event={event} />
                </div>
              </div>
            ))}
            {streaming && (
              <div className="chat-content-lane relative min-w-0 px-1 py-0.5">
                <h3 className="sr-only">Antwort wird geschrieben</h3>
                <div className="chat-markdown">
                  {renderMarkdown(streaming, false)}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      {!atBottom && (
        <div className="absolute inset-x-0 bottom-2 flex justify-center">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (scroll.current)
                scroll.current.scrollTop = scroll.current.scrollHeight;
              stick.current = true;
              setAtBottom(true);
            }}
          >
            <ArrowDown />
            Zur letzten Nachricht
          </Button>
        </div>
      )}
    </div>
  );
}
