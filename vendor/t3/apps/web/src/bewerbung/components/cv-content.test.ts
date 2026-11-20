import { expect, it } from "vite-plus/test";
import type { CvBlock } from "../shared/api";
import { cvContentBlocks, cvContentDocument } from "./cv-content";

it("keeps text, IDs and mixed ordering through the shared content editor", () => {
  const blocks: CvBlock[] = [
    { id: "p-before", type: "paragraph", text: "Before 50% & Rust_2026.\nSecond line" },
    {
      id: "list",
      type: "bulletList",
      items: [
        { id: "a", text: "First" },
        { id: "b", text: "Second" },
      ],
    },
    { id: "p-after", type: "paragraph", text: "After" },
  ];
  const doc = cvContentDocument(blocks);
  expect(doc.content?.map((node) => node.type)).toEqual(["paragraph", "bulletList", "paragraph"]);
  expect(doc.content?.[1]?.content?.map((item) => item.attrs?.cvId)).toEqual(["a", "b"]);
  expect(cvContentBlocks(doc)).toEqual(blocks);
});
it("serializes paragraph and list edits independently of the input converter", () => {
  expect(
    cvContentBlocks({
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { cvId: "p" },
          content: [
            { type: "text", text: "Changed" },
            { type: "hardBreak" },
            { type: "text", text: "Line" },
          ],
        },
        {
          type: "bulletList",
          attrs: { cvId: "list" },
          content: [
            {
              type: "listItem",
              attrs: { cvId: "item" },
              content: [{ type: "paragraph", content: [{ type: "text", text: "Bullet" }] }],
            },
          ],
        },
      ],
    }),
  ).toEqual([
    { id: "p", type: "paragraph", text: "Changed\nLine" },
    { id: "list", type: "bulletList", items: [{ id: "item", text: "Bullet" }] },
  ]);
  expect(
    cvContentDocument([{ id: "empty", type: "bulletList", items: [] }]).content?.map(
      (node) => node.type,
    ),
  ).toEqual(["paragraph"]);
});
