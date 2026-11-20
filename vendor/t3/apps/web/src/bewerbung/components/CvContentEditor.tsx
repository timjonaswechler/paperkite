import { useEffect, useRef } from "react";
import { Extension, type JSONContent } from "@tiptap/core";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { ListItem } from "@tiptap/extension-list";
import { Plugin } from "@tiptap/pm/state";
import { List } from "lucide-react";
import { Button } from "~/components/ui/button";
import { randomUUID } from "~/lib/utils";
import type { CvBlock } from "../shared/api";
import { cvContentDocument, cvContentBlocks } from "./cv-content";
import styles from "./cv-editor.module.css";

const identities = Extension.create({
  name: "cvIdentities",
  addGlobalAttributes() {
    return [
      {
        types: ["paragraph", "bulletList", "listItem"],
        attributes: { cvId: { default: null, rendered: false, parseHTML: () => null } },
      },
    ];
  },
  addProseMirrorPlugins() {
    return [
      new Plugin({
        appendTransaction(transactions, _old, state) {
          if (!transactions.some((t) => t.docChanged)) return;
          const used = new Set<string>(),
            tr = state.tr;
          state.doc.descendants((node, pos) => {
            if (!["paragraph", "bulletList", "listItem"].includes(node.type.name)) return;
            let id = node.attrs.cvId as string | null;
            if (!id || used.has(id)) {
              id = randomUUID();
              tr.setNodeMarkup(pos, undefined, { ...node.attrs, cvId: id });
            }
            used.add(id);
          });
          return tr.docChanged ? tr : null;
        },
      }),
    ];
  },
});
const extensions = [
  StarterKit.configure({
    blockquote: false,
    bold: false,
    code: false,
    codeBlock: false,
    heading: false,
    horizontalRule: false,
    italic: false,
    link: false,
    orderedList: false,
    strike: false,
    underline: false,
    listItem: false,
    trailingNode: false,
  }),
  ListItem.extend({ content: "paragraph" }),
  identities,
];

export function CvContentEditor({
  value,
  onChange,
  readonly,
  inlineList = false,
}: {
  value: CvBlock[];
  onChange: (value: CvBlock[]) => void;
  readonly: boolean;
  inlineList?: boolean;
}) {
  const last = useRef(JSON.stringify(value)),
    before = useRef<JSONContent | null>(null);
  const editor = useEditor(
    {
      extensions,
      content: cvContentDocument(value),
      editable: !readonly,
      shouldRerenderOnTransaction: false,
      editorProps: {
        attributes: { role: "textbox", "aria-label": "Inhalt", "aria-multiline": "true" },
        handleKeyDown(view, event) {
          if (event.key !== "Escape" || !before.current) return false;
          event.preventDefault();
          const document = view.state.schema.nodeFromJSON(before.current);
          view.dispatch(
            view.state.tr.replaceWith(0, view.state.doc.content.size, document.content),
          );
          view.dom.blur();
          return true;
        },
      },
      onFocus({ editor }) {
        before.current = editor.getJSON();
      },
      onUpdate({ editor }) {
        const blocks = cvContentBlocks(editor.getJSON());
        last.current = JSON.stringify(blocks);
        onChange(blocks);
      },
    },
    [],
  );
  const active = useEditorState({
    editor,
    selector: ({ editor }) => editor?.isActive("bulletList") || false,
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- synchronizes read mode with the external ProseMirror editor
  useEffect(() => {
    editor?.setEditable(!readonly, false);
  }, [editor, readonly]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- applies an explicitly reloaded CV without resetting the caret after local typing
  useEffect(() => {
    const next = JSON.stringify(value);
    if (editor && next !== last.current) {
      last.current = next;
      editor.commands.setContent(cvContentDocument(value), { emitUpdate: false });
    }
  }, [editor, value]);
  return (
    <div className={styles["cv-content"]} data-inline-list={inlineList}>
      <div className={styles["cv-field-label"]} aria-hidden>
        Inhalt
      </div>
      <EditorContent editor={editor} />
      {!readonly && (
        <div className={styles["cv-content-toolbar"]}>
          <Button
            size="xs"
            variant="ghost-muted"
            aria-label="Aufzählung umschalten"
            aria-pressed={active}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor?.chain().focus().toggleBulletList().run()}
          >
            <List />
            Aufzählung
          </Button>
        </div>
      )}
    </div>
  );
}
