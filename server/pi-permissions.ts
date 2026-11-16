// Adapted from T3 provider-pi/mcpExtensionSource.ts tool_call approval gate (MIT).
// No MCP bridge, orchestration commands, shell, extensions or resources are exposed.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import fs from "node:fs";
import path from "node:path";
import { safeFile, writeDocument } from "./files.ts";

export default function permissions(pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    const { createEditToolDefinition, createWriteToolDefinition } =
      await import("@earendil-works/pi-coding-agent");
    const writeFile = async (absolute: string, content: string) => {
      writeDocument(ctx.cwd, absolute, content);
    };
    // Keep Pi's edit/write behavior and schemas, but check the resulting workspace
    // at the actual mutation boundary, after approval and any sibling tool writes.
    pi.registerTool({
      ...createEditToolDefinition(ctx.cwd, {
        operations: {
          readFile: (absolute) =>
            fs.promises.readFile(
              safeFile(ctx.cwd, path.relative(ctx.cwd, absolute)),
            ),
          access: (absolute) =>
            fs.promises.access(
              safeFile(ctx.cwd, path.relative(ctx.cwd, absolute)),
              fs.constants.R_OK | fs.constants.W_OK,
            ),
          writeFile,
        },
      }),
      executionMode: "sequential",
    });
    pi.registerTool({
      ...createWriteToolDefinition(ctx.cwd, {
        operations: {
          mkdir: async () => {}, // atomicFile creates directories only after quota validation.
          writeFile,
        },
      }),
      executionMode: "sequential",
    });
    ctx.ui.notify("BEWERBUNG_DOCUMENT_POLICY_V1", "info");
  });
  pi.on("tool_call", async (event, ctx) => {
    if (!["read", "edit", "write"].includes(event.toolName))
      return {
        block: true,
        reason: "Nur read/edit/write innerhalb dieser Bewerbung erlaubt.",
      };
    const raw = event.input.path;
    if (typeof raw !== "string")
      return { block: true, reason: "Dateipfad fehlt" };
    const absolute = path.resolve(ctx.cwd, raw.replace(/^@/, ""));
    const relative = path.relative(ctx.cwd, absolute);
    const allowed =
      /^(?:cv\/Lebenslauf\.tex|cv\/(?:lua|profile|profiles)\/[a-zA-Z0-9_-]+\.lua|cv\/preamble\/[a-zA-Z0-9_-]+\.tex|cv\/assets\/[a-zA-Z0-9_-]+\.(?:jpg|jpeg|png)|anschreiben\/[a-zA-Z0-9_-]+\.tex|anschreiben\/assets\/[a-zA-Z0-9_-]+\.(?:jpg|jpeg|png)|application\.json)$/;
    if (
      !allowed.test(relative) ||
      (relative === "application.json" && event.toolName !== "read")
    )
      return {
        block: true,
        reason: "Pfad außerhalb des freigegebenen Dokumentbereichs",
      };
    let current = ctx.cwd;
    for (const part of relative.split("/")) {
      current = path.join(current, part);
      if (fs.lstatSync(current, { throwIfNoEntry: false })?.isSymbolicLink())
        return { block: true, reason: "Symlinks sind gesperrt" };
    }
    if (event.toolName === "read") return;
    if (!/\.(lua|tex)$/.test(relative))
      return {
        block: true,
        reason: "Nur Textdokumente dürfen geändert werden",
      };
    if (Buffer.byteLength(JSON.stringify(event.input)) > 4 * 1024 * 1024)
      return { block: true, reason: "Änderung zu groß" };
    const approved = await ctx.ui.confirm(
      `Erlauben: ${event.toolName} ${relative}?`,
      JSON.stringify(event.input, null, 2),
      { signal: ctx.signal },
    );
    if (!approved)
      return { block: true, reason: "In der Bewerbungs-App abgelehnt" };
  });
  pi.on("user_bash", () => ({
    result: {
      output: "Shell ist gesperrt.",
      exitCode: 1,
      cancelled: false,
      truncated: false,
    },
  }));
}
