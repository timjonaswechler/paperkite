// Extracted plain/literal mode of T3 ComposerPromptEditorTiptap.tsx (MIT).
// Workspace mentions, citations, skills and rich-Markdown node views are not supported here.
import {
  Extension,
  type JSONContent,
  type TiptapEditorHTMLElement,
} from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { splitBlockKeepMarks } from "@tiptap/pm/commands";
import {
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type RefObject,
} from "react";
import { ComposerTextDirectionExtension } from "../composer-text-direction";
import {
  COMPOSER_UNDO_GROUP_DELAY,
  groupUndoByChangeKind,
  markAsClipboardEdit,
  type ComposerChangeKind,
} from "../composer-undo-grouping";

const ComposerUndoGroupingExtension = Extension.create<
  Record<string, never>,
  { previous: ComposerChangeKind | null }
>({
  name: "composer-undo-grouping",
  addStorage() {
    return { previous: null };
  },
  dispatchTransaction({ transaction, next }) {
    this.storage.previous = groupUndoByChangeKind(
      transaction,
      this.storage.previous,
    );
    next(transaction);
  },
});
const PLAIN_TEXT_EXTENSIONS = [
  StarterKit.configure({
    blockquote: false,
    bulletList: false,
    codeBlock: false,
    heading: false,
    horizontalRule: false,
    listItem: false,
    link: false,
    orderedList: false,
    underline: false,
    dropcursor: false,
    gapcursor: false,
    trailingNode: false,
    code: false,
    listKeymap: false,
    undoRedo: { newGroupDelay: COMPOSER_UNDO_GROUP_DELAY },
    italic: false,
    bold: false,
    strike: false,
  }),
  ComposerUndoGroupingExtension,
  ComposerTextDirectionExtension,
];
function buildDocJson(value: string): JSONContent {
  return {
    type: "doc",
    content: value.split("\n").map((line) => ({
      type: "paragraph",
      ...(line ? { content: [{ type: "text", text: line }] } : {}),
    })),
  };
}
export type ComposerPromptEditorHandle = {
  focus: () => void;
  readSnapshot: () => { value: string };
};
export function ComposerPromptEditorTiptap({
  value,
  disabled,
  placeholder,
  onChange,
  onCommandKeyDown,
  editorRef,
}: {
  value: string;
  disabled: boolean;
  placeholder: string;
  onChange: (value: string) => void;
  onCommandKeyDown: (key: string, event: KeyboardEvent) => boolean;
  editorRef: RefObject<ComposerPromptEditorHandle | null>;
}) {
  const callbacks = useRef({ onChange, onCommandKeyDown });
  useLayoutEffect(() => {
    callbacks.current = { onChange, onCommandKeyDown };
  }, [onChange, onCommandKeyDown]);
  const editor = useEditor(
    {
      extensions: PLAIN_TEXT_EXTENSIONS,
      content: buildDocJson(value),
      editable: !disabled,
      editorProps: {
        attributes: {
          class:
            "composer-tiptap -m-1 block max-h-52 min-h-[calc(2lh+--spacing(2))] overflow-y-auto p-1 whitespace-pre-wrap wrap-break-word bg-transparent leading-relaxed text-foreground focus:outline-none",
          "data-testid": "composer-editor",
          "data-composer-rich-text": "false",
          role: "textbox",
          "aria-multiline": "true",
          "aria-label": "Nachricht an Assistent",
          "aria-placeholder": placeholder,
        },
        handleKeyDown: (view, event) => {
          if (
            event.key === "Enter" &&
            (event.isComposing || event.keyCode === 229)
          ) {
            event.stopPropagation();
            return true;
          }
          const handled = callbacks.current.onCommandKeyDown(event.key, event);
          if (handled) {
            event.preventDefault();
            event.stopPropagation();
            return true;
          }
          if (event.key === "Enter") {
            event.preventDefault();
            return splitBlockKeepMarks(view.state, (tr) =>
              view.dispatch(tr.scrollIntoView()),
            );
          }
          return false;
        },
        handlePaste: (view, event) => {
          const text = event.clipboardData?.getData("text/plain");
          const instance = (view.dom as TiptapEditorHTMLElement).editor;
          if (!text || !instance) return false;
          event.preventDefault();
          const content =
            buildDocJson(text.replace(/\r\n?/g, "\n")).content ?? [];
          instance
            .chain()
            .command(({ tr }) => {
              markAsClipboardEdit(tr, "paste");
              return true;
            })
            .insertContent(
              content.length === 1 ? (content[0]?.content ?? []) : content,
            )
            .run();
          view.dispatch(view.state.tr.scrollIntoView());
          return true;
        },
      },
      onUpdate: ({ editor: updated }) =>
        callbacks.current.onChange(updated.getText({ blockSeparator: "\n" })),
    },
    [],
  );
  // Controlled updates touch the document only for draft loads and successful sends, never each keystroke.
  useLayoutEffect(() => {
    if (editor && editor.getText({ blockSeparator: "\n" }) !== value)
      editor.commands.setContent(buildDocJson(value), { emitUpdate: false });
  }, [editor, value]);
  useEffect(() => {
    editor?.setEditable(!disabled, false);
  }, [editor, disabled]);
  useImperativeHandle(
    editorRef,
    () => ({
      focus: () => editor?.commands.focus(),
      readSnapshot: () => ({
        value: editor?.getText({ blockSeparator: "\n" }) ?? value,
      }),
    }),
    [editor, value],
  );
  return (
    <div className="relative flow-root font-(family-name:--font-composer,var(--font-sans)) text-(length:--font-size-prompt,var(--text-sm)) max-sm:pointer-coarse:text-(length:--font-size-prompt-touch)">
      <EditorContent editor={editor} />
      {!value && (
        <div className="pointer-events-none absolute inset-0 leading-relaxed text-placeholder">
          {placeholder}
        </div>
      )}
    </div>
  );
}
