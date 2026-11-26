import * as Schema from "effect/Schema";

export const RuntimeCapabilities = Schema.Struct({
  threadSettlement: Schema.Boolean,
  pullRequests: Schema.Boolean,
  git: Schema.Boolean,
  github: Schema.Boolean,
  sourceControl: Schema.Boolean,
  issues: Schema.Boolean,
  pairing: Schema.Boolean,
  environments: Schema.Boolean,
});
export type RuntimeCapabilities = typeof RuntimeCapabilities.Type;

export const RuntimeStatus = Schema.Struct({
  application: Schema.Literal("paperkite"),
  upstreamCommit: Schema.String,
  profile: Schema.Literals(["native", "proof"]),
  capabilities: RuntimeCapabilities,
});
export type RuntimeStatus = typeof RuntimeStatus.Type;
