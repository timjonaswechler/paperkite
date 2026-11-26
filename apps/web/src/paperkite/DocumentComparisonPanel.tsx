import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { turnItemDetailRevision } from "@t3tools/client-runtime/work-log/item-detail";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useGT, useMessages } from "gt-react";
import type { DraftId } from "../composerDraftStore";
import { useQuietThreadShell, useQuietThreadVisibleTurnItems, useProject } from "../state/entities";
import { useTurnItemDetail } from "../state/queries";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { toolCallDiff } from "../lib/toolCallDiff";
import {
  buildFileDiffEntries,
  getRenderablePatch,
  resolveDiffThemeName,
} from "../lib/diffRendering";
import { useRenderedAppearance } from "../hooks/useTheme";
import { useClientSettings } from "../hooks/useSettings";
import { AnnotatableCodeView } from "../components/diffs/AnnotatableCodeView";
import { DiffPanelLoadingState } from "../components/DiffPanelShell";
import { useDocumentComparisonStore } from "./DocumentComparisonStore";

export default function DocumentComparisonPanel(props: {
  threadRef: ScopedThreadRef;
  composerDraftTarget: ScopedThreadRef | DraftId;
}) {
  const gt = useGT();
  const messages = useMessages();
  const theme = useRenderedAppearance();
  const layout = useClientSettings((settings) => settings.diffLayout);
  const target = useDocumentComparisonStore(
    (state) => state.byThreadKey[scopedThreadKey(props.threadRef)],
  );
  const items = useQuietThreadVisibleTurnItems(target ? props.threadRef : null);
  const row = target
    ? items.find(
        (row) => row.sourceThreadId === target.threadId && row.sourceItemId === target.itemId,
      )
    : undefined;
  const revision =
    row?.item.type === "file_change" ? turnItemDetailRevision(row.item) : target?.revision;
  const detail = useTurnItemDetail(
    target && revision
      ? {
          ...target,
          revision,
          environmentId: props.threadRef.environmentId,
        }
      : null,
  );
  const shell = useQuietThreadShell(props.threadRef);
  const project = useProject(
    shell ? scopeProjectRef(props.threadRef.environmentId, shell.projectId) : null,
  );
  const preview =
    detail.data?.item?.type === "file_change"
      ? toolCallDiff(detail.data.item, project?.workspaceRoot, messages)
      : null;
  const patch = getRenderablePatch(preview?.patch);
  const files =
    patch?.kind === "files"
      ? buildFileDiffEntries(patch.files).map((entry) => ({
          ...entry,
          filePath: entry.fileDiff.name,
          collapsed: false,
        }))
      : [];
  if (detail.isPending) return <DiffPanelLoadingState label={gt("Loading comparison")} />;
  if (detail.error) return <p role="alert">{gt("Unable to load comparison")}</p>;
  return (
    <section className="flex h-full min-h-0 flex-col" aria-label={gt("Document comparison")}>
      {preview?.truncated ? <p>{gt("Recorded content is truncated.")}</p> : null}
      {files.length > 0 ? (
        <AnnotatableCodeView
          environmentId={props.threadRef.environmentId}
          projectId={shell?.projectId}
          codeViewKey={target ? target.itemId + ":" + revision : "empty"}
          className="h-full min-h-0 overflow-auto"
          files={files}
          pendingFiles={[]}
          sectionId={target?.itemId ?? "document-comparison"}
          sectionTitle={gt("Document comparison")}
          composerDraftTarget={props.composerDraftTarget}
          renderHeaderFilenameSuffix={() => null}
          renderHeaderPrefix={() => null}
          onFileCollapsedChange={() => {}}
          options={{
            diffStyle: layout === "split" ? "split" : "unified",
            theme: resolveDiffThemeName(theme),
            themeType: theme,
          }}
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-auto p-3">
          {patch?.kind === "raw" ? <pre>{patch.text}</pre> : null}
          {preview?.content.map((entry) => (
            <section key={entry.label}>
              <h3>{entry.label}</h3>
              <pre>{entry.text}</pre>
            </section>
          ))}
          {!preview ? <p>{gt("Select a recorded file change to compare documents.")}</p> : null}
        </div>
      )}
    </section>
  );
}
