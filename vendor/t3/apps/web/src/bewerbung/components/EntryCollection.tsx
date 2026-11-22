import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowUp,
  ArrowDown,
  ArrowUpToLine,
  ArrowDownToLine,
  GripVertical,
  Trash2,
  Undo2,
  Plus,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { moveEntry, prependEntry, restoreEntryOrder, type OrderedEntry } from "./entry-order";
import documentStyles from "./cv-editor.module.css";
import styles from "./entry-order.module.css";

const dragType = "application/x-bewerbung-entry";
export function EntryCollection<T extends OrderedEntry>({
  entries,
  onChange,
  children,
  label,
  reading = false,
  disabled = false,
  createEntry,
}: {
  entries: T[];
  onChange: (entries: T[]) => void;
  children: (entry: T) => ReactNode;
  label: string;
  reading?: boolean;
  disabled?: boolean;
  createEntry?: () => T;
}) {
  const scope = useId(),
    editable = !reading && !disabled;
  const [previousOrder, setPreviousOrder] = useState<string[] | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const nodes = useRef(new Map<string, HTMLElement>());
  const pendingFocus = useRef<string | null>(null);
  const dragSource = useRef<string | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- returns focus to the moved document entry after the controlled parent reorders its DOM
  useLayoutEffect(() => {
    const id = pendingFocus.current;
    if (!id) return;
    pendingFocus.current = null;
    if (!entries.some((entry) => entry.id === id)) return;
    nodes.current.get(id)?.focus({ preventScroll: true });
    nodes.current.get(id)?.scrollIntoView({ block: "nearest" });
  }, [entries]);
  const undoAvailable =
    previousOrder &&
    restoreEntryOrder(entries, previousOrder).some((entry, i) => entry.id !== entries[i]?.id);
  function move(id: string, to: number) {
    if (!editable) return;
    const next = moveEntry(entries, id, to);
    if (next === entries) return;
    setPreviousOrder(entries.map((entry) => entry.id));
    pendingFocus.current = id;
    onChange(next);
  }
  return (
    <div className={styles.collection} data-entry-collection={label}>
      {!reading && previousOrder && (
        <div className={styles.undo}>
          <Button
            size="xs"
            variant="ghost-muted"
            disabled={!editable || !undoAvailable}
            aria-label="Verschiebung rückgängig"
            onClick={() => {
              if (previousOrder) {
                onChange(restoreEntryOrder(entries, previousOrder));
                setPreviousOrder(null);
              }
            }}
          >
            <Undo2 />
            Verschiebung rückgängig
          </Button>
        </div>
      )}
      {entries
        .filter((entry) => !reading || entry.included !== false)
        .map((entry) => {
          const at = entries.findIndex((item) => item.id === entry.id);
          return (
            <article
              key={entry.id}
              ref={(element) => {
                if (element) nodes.current.set(entry.id, element);
                else nodes.current.delete(entry.id);
              }}
              className={`${documentStyles["cv-entry"]} ${styles.entry} space-y-1`}
              data-entry={entry.id}
              data-cv-entry={entry.id}
              data-included={entry.included !== false}
              data-dragging={dragging === entry.id}
              tabIndex={-1}
              onKeyDown={(event) => {
                if (
                  !editable ||
                  !event.altKey ||
                  (event.target as HTMLElement).closest("[contenteditable], input, textarea")
                )
                  return;
                const targets: Record<string, number> = {
                  ArrowUp: at - 1,
                  ArrowDown: at + 1,
                  Home: 0,
                  End: entries.length - 1,
                };
                const to = targets[event.key];
                if (to === undefined) return;
                event.preventDefault();
                move(entry.id, to);
              }}
              onDragOver={(event) => {
                if (editable && dragSource.current && dragSource.current !== entry.id) {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                }
              }}
              onDrop={(event) => {
                if (!event.dataTransfer.types.includes(dragType)) return;
                event.preventDefault();
                event.stopPropagation();
                const sourceId = dragSource.current;
                if (!editable || !sourceId || sourceId === entry.id) return;
                let source: { scope?: string; id?: string };
                try {
                  source = JSON.parse(event.dataTransfer.getData(dragType));
                } catch {
                  return;
                }
                if (source?.scope !== scope || source?.id !== sourceId) return;
                const rest = entries.filter((item) => item.id !== sourceId);
                const bounds = event.currentTarget.getBoundingClientRect();
                const to =
                  rest.findIndex((item) => item.id === entry.id) +
                  (event.clientY > bounds.top + bounds.height / 2 ? 1 : 0);
                move(sourceId, to);
                dragSource.current = null;
                setDragging(null);
              }}
            >
              {!reading && (
                <div className={styles.actions}>
                  <label
                    className="flex items-center gap-2 text-xs text-muted-foreground"
                    htmlFor={scope + entry.id}
                  >
                    <Checkbox
                      id={scope + entry.id}
                      aria-label="Im PDF"
                      checked={entry.included !== false}
                      disabled={disabled}
                      onCheckedChange={(included) =>
                        onChange(
                          entries.map((item) =>
                            item.id === entry.id ? { ...item, included } : item,
                          ),
                        )
                      }
                    />
                    {entry.included === false ? "Nicht im PDF" : "Im PDF"}
                  </label>
                  <Button
                    size="icon-xs"
                    variant="ghost-muted"
                    disabled={!editable || entries.length < 2}
                    aria-label="Eintrag ziehen"
                    title="Ziehen oder Alt + Pfeiltaste verwenden"
                    draggable={editable && entries.length > 1}
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData(dragType, JSON.stringify({ scope, id: entry.id }));
                      dragSource.current = entry.id;
                      const row = nodes.current.get(entry.id);
                      if (row) event.dataTransfer.setDragImage(row, 12, 12);
                      setDragging(entry.id);
                    }}
                    onDragEnd={() => {
                      dragSource.current = null;
                      setDragging(null);
                    }}
                  >
                    <GripVertical />
                  </Button>
                  <Button
                    size="icon-xs"
                    variant="ghost-muted"
                    disabled={!editable || at === 0}
                    aria-label="Ganz nach oben"
                    title="Ganz nach oben"
                    onClick={() => move(entry.id, 0)}
                  >
                    <ArrowUpToLine />
                  </Button>
                  <Button
                    size="icon-xs"
                    variant="ghost-muted"
                    disabled={!editable || at === 0}
                    aria-label="Nach oben"
                    title="Eine Position nach oben"
                    onClick={() => move(entry.id, at - 1)}
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    size="icon-xs"
                    variant="ghost-muted"
                    disabled={!editable || at === entries.length - 1}
                    aria-label="Nach unten"
                    title="Eine Position nach unten"
                    onClick={() => move(entry.id, at + 1)}
                  >
                    <ArrowDown />
                  </Button>
                  <Button
                    size="icon-xs"
                    variant="ghost-muted"
                    disabled={!editable || at === entries.length - 1}
                    aria-label="Ganz nach unten"
                    title="Ganz nach unten"
                    onClick={() => move(entry.id, entries.length - 1)}
                  >
                    <ArrowDownToLine />
                  </Button>
                  <Button
                    size="icon-xs"
                    variant="ghost-muted"
                    disabled={!editable}
                    aria-label="Eintrag löschen"
                    title="Eintrag löschen"
                    onClick={() => {
                      if (confirm("Diesen Eintrag dauerhaft aus dem Lebenslauf entfernen?"))
                        onChange(entries.filter((item) => item.id !== entry.id));
                    }}
                  >
                    <Trash2 />
                  </Button>
                </div>
              )}
              {children(entry)}
            </article>
          );
        })}
      {!reading && createEntry && (
        <div>
          <Button
            size="sm"
            variant="ghost"
            disabled={!editable}
            onClick={() => onChange(prependEntry(entries, createEntry()))}
          >
            <Plus />
            Eintrag hinzufügen
          </Button>
        </div>
      )}
    </div>
  );
}
