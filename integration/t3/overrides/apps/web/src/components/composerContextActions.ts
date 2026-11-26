import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { createContext } from "react";

export interface ComposerContextActions {
  environmentId: EnvironmentId | null;
  cwd?: string | undefined;
  projectId?: ProjectId | undefined;
  expandImage: (imageId: string) => void;
  expandVideo: (fileId: string) => void;
  openFile: (fileId: string) => void;
  openMention: (path: string) => void;
}

export const ComposerContextActionsContext = createContext<ComposerContextActions>({
  environmentId: null,
  expandImage: () => {},
  expandVideo: () => {},
  openFile: () => {},
  openMention: () => {},
});
