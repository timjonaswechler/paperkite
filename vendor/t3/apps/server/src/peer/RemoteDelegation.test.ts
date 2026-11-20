import { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import type { McpThreadInvocationScope } from "../mcp/McpInvocationContext.ts";
import * as RemoteDelegation from "./RemoteDelegation.ts";

const scope: McpThreadInvocationScope = {
  environmentId: EnvironmentId.make("local"),
  capabilities: new Set(["orchestration"]),
  issuedAt: 0,
  requestNamespace: "single-server-test",
  thread: {
    threadId: ThreadId.make("local-thread"),
    providerInstanceId: ProviderInstanceId.make("codex"),
    providerSessionId: "synthetic-session",
  },
  client: undefined,
};

it.effect(
  "cannot launch or follow work on another server even when a caller supplies an old target",
  () =>
    Effect.gen(function* () {
      const service = yield* RemoteDelegation.RemoteDelegation;
      yield* service.start();
      const denied = yield* service
        .delegate(scope, {
          task: "Synthetic task that must never leave this server",
          target: { environmentId: EnvironmentId.make("old-remote") },
        })
        .pipe(Effect.flip);
      expect(denied.code).toBe("capability_denied");
      const followed = yield* service
        .followUp(
          scope,
          EnvironmentId.make("old-remote"),
          {
            message: "Must not be forwarded",
          },
          { threadId: ThreadId.make("old-remote-thread") } as never,
        )
        .pipe(Effect.flip);
      expect(followed.code).toBe("capability_denied");
    }).pipe(Effect.provide(RemoteDelegation.layer)),
);
