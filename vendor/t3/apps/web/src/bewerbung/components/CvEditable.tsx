import { useLayoutEffect, useRef } from "react";
import styles from "./cv-editor.module.css";

export function CvEditable({
  value,
  label,
  onChange,
  readonly = false,
  focus = false,
  showLabel = true,
  hint = "",
  required = false,
}: {
  value: string;
  label: string;
  onChange: (value: string) => void;
  readonly?: boolean;
  focus?: boolean;
  showLabel?: boolean;
  hint?: string;
  required?: boolean;
}) {
  const ref = useRef<HTMLSpanElement>(null),
    before = useRef(value);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- synchronizes external document values without replacing the focused contenteditable DOM or moving its caret
  useLayoutEffect(() => {
    if (ref.current && document.activeElement !== ref.current) ref.current.textContent = value;
  }, [value]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- focuses a newly inserted document field after React commits it
  useLayoutEffect(() => {
    if (focus && !readonly) ref.current?.focus();
  }, [focus, readonly]);
  return (
    <span className={styles["cv-field"]}>
      {showLabel && (
        <span className={styles["cv-field-label"]} aria-hidden>
          {label}
          {required ? " *" : ""}
          {hint}
        </span>
      )}
      <span
        ref={ref}
        className={styles["cv-editable"]}
        contentEditable={!readonly}
        suppressContentEditableWarning
        role="textbox"
        aria-label={label}
        aria-readonly={readonly}
        aria-required={required || undefined}
        data-placeholder={label}
        onFocus={() => {
          before.current = ref.current?.innerText || "";
        }}
        onInput={(e) => onChange(e.currentTarget.innerText)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.currentTarget.textContent = before.current;
            onChange(before.current);
            e.currentTarget.blur();
          }
        }}
        onPaste={(e) => {
          e.preventDefault();
          const selection = window.getSelection();
          if (!selection?.rangeCount) return;
          const range = selection.getRangeAt(0);
          if (!e.currentTarget.contains(range.commonAncestorContainer)) return;
          range.deleteContents();
          const node = document.createTextNode(e.clipboardData.getData("text/plain"));
          range.insertNode(node);
          range.setStartAfter(node);
          range.collapse(true);
          selection.removeAllRanges();
          selection.addRange(range);
          onChange(e.currentTarget.innerText);
        }}
      />
    </span>
  );
}
