import type { JSONContent } from "@tiptap/core";
import type { CvBlock } from "../shared/api";
import { randomUUID } from "~/lib/utils";

function inline(text: string): JSONContent[] {
  return text
    .split("\n")
    .flatMap((line, index) => [
      ...(index ? [{ type: "hardBreak" }] : []),
      ...(line ? [{ type: "text", text: line }] : []),
    ]);
}
export function cvContentDocument(blocks: CvBlock[]): JSONContent {
  const content: JSONContent[] = blocks.flatMap((block) =>
    block.type === "paragraph"
      ? [{ type: "paragraph", attrs: { cvId: block.id }, content: inline(block.text) }]
      : block.items.length
        ? [
            {
              type: "bulletList",
              attrs: { cvId: block.id },
              content: block.items.map((item) => ({
                type: "listItem",
                attrs: { cvId: item.id },
                content: [{ type: "paragraph", content: inline(item.text) }],
              })),
            },
          ]
        : [],
  );
  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}
function text(node: JSONContent): string {
  if (node.type === "text") return node.text || "";
  if (node.type === "hardBreak") return "\n";
  return (node.content || []).map(text).join("");
}
export function cvContentBlocks(doc: JSONContent): CvBlock[] {
  return (doc.content || []).flatMap((node): CvBlock[] => {
    const id = typeof node.attrs?.cvId === "string" ? node.attrs.cvId : randomUUID();
    if (node.type === "paragraph") return [{ id, type: "paragraph", text: text(node) }];
    if (node.type === "bulletList") {
      const items = (node.content || []).map((item) => ({
        id: typeof item.attrs?.cvId === "string" ? item.attrs.cvId : randomUUID(),
        text: text(item),
      }));
      return [{ id, type: "bulletList", items }];
    }
    return [];
  });
}
