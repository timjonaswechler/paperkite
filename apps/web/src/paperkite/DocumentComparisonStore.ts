import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { create } from "zustand";
import type { ToolCallDiffTarget } from "../diffPanelStore";

export const useDocumentComparisonStore = create<{
  byThreadKey: Record<string, ToolCallDiffTarget>;
  select: (ref: ScopedThreadRef, target: ToolCallDiffTarget) => void;
}>((set) => ({
  byThreadKey: {},
  select: (ref, target) =>
    set((state) => ({
      byThreadKey: { ...state.byThreadKey, [scopedThreadKey(ref)]: target },
    })),
}));
