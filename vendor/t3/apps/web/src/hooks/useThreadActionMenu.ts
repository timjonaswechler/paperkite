import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  settlePromise,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  AuthOrchestrationOperateScope,
  type ContextMenuItem,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { readThreadShell } from "../state/entities";
import { readEnvironmentScope } from "../state/session";
import { readLocalApi } from "../localApi";
import { toastManager } from "../components/ui/toast";
import { useNewThreadHandler } from "./useHandleNewThread";
import { useThreadActions } from "./useThreadActions";

export function useThreadActionMenu(input: {
  readonly threadRef: ScopedThreadRef | null;
  readonly projectCwd: string | null;
  readonly onStartRename: () => void;
  readonly onFind?: ((threadRef: ScopedThreadRef) => void) | undefined;
  readonly canShareWithGuest: boolean;
}) {
  const actions = useThreadActions();
  const create = useNewThreadHandler();
  function openMenu(position: { x: number; y: number }) {
    const ref = input.threadRef;
    const api = readLocalApi();
    if (!ref || !api) return;
    const thread = readThreadShell(ref);
    if (!thread) return;
    const canOperate = readEnvironmentScope(ref.environmentId, AuthOrchestrationOperateScope);
    const items: ContextMenuItem[] = [
      { id: "new", label: "Neuer Chat", disabled: !canOperate },
      { id: "rename", label: "Chat umbenennen", disabled: !canOperate },
      ...(input.onFind ? [{ id: "find", label: "Im Chat suchen" }] : []),
      { id: "archive", label: "Chat archivieren", disabled: !canOperate },
      { id: "delete", label: "Chat löschen", disabled: !canOperate },
    ];
    void (async () => {
      const clicked = await settlePromise(() => api.contextMenu.show(items, position));
      if (clicked._tag === "Failure" || !clicked.value) return;
      if (clicked.value === "find") {
        input.onFind?.(ref);
        return;
      }
      if (!readEnvironmentScope(ref.environmentId, AuthOrchestrationOperateScope)) return;
      if (clicked.value === "rename") {
        input.onStartRename();
        return;
      }
      if (clicked.value === "new") {
        await create(scopeProjectRef(ref.environmentId, thread.projectId), {
          envMode: "local",
          branch: null,
          worktreePath: null,
          startFromOrigin: false,
        });
        return;
      }
      if (clicked.value !== "archive" && clicked.value !== "delete") return;
      if (
        !(await api.dialogs.confirm(
          `${clicked.value === "delete" ? "Chat dauerhaft löschen" : "Chat archivieren"}: „${thread.title}“?`,
        ))
      )
        return;
      const result =
        clicked.value === "delete"
          ? await actions.deleteThread(ref)
          : await actions.archiveThread(ref);
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add({
          type: "error",
          title: "Chat konnte nicht geändert werden",
          description: error instanceof Error ? error.message : "Native Anfrage fehlgeschlagen.",
        });
      }
    })();
  }
  return {
    openMenu,
    closeMenu: () => {
      void readLocalApi()?.contextMenu.close();
    },
  };
}
