import type { ExecutionEnvironmentCapabilities } from "@t3tools/contracts";

/** Older native servers omit this capability; a missing configuration is not ready. */
export const supportsThreadSettlement = (
  capabilities: Pick<ExecutionEnvironmentCapabilities, "threadSettlement"> | undefined,
): boolean => capabilities !== undefined && capabilities.threadSettlement !== false;
