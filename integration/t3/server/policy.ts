import { ProviderDriverKind, type ManagedPolicyDocument } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { ManagedPolicyFileError } from "@t3tools/shared/managedPolicyFile";

export const constrain = Effect.fn("Paperkite.constrainPolicy")(function* (
  document: ManagedPolicyDocument | undefined,
  proof: boolean,
) {
  const driver = ProviderDriverKind.make("acpRegistry");
  const existing = document?.limits?.providers?.allowedDrivers;
  if (proof && existing !== undefined && !existing.includes(driver)) {
    return yield* new ManagedPolicyFileError({
      path: "paperkite:proof",
      reason: "the administrator policy does not permit the replay driver",
    });
  }
  return {
    ...document,
    schemaVersion: 1,
    organization: document?.organization ?? "Paperkite",
    limits: {
      ...document?.limits,
      updates: { ...document?.limits?.updates, mode: "off" },
      ...(proof
        ? {
            connect: false,
            telemetry: false,
            providers: { ...document?.limits?.providers, allowedDrivers: [driver] },
          }
        : {}),
    },
  } satisfies ManagedPolicyDocument;
});
