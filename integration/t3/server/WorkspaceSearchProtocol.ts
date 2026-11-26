import * as Schema from "effect/Schema";

export const Response = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("ready"),
    regexFallbackError: Schema.optional(Schema.String),
  }),
  Schema.Struct({
    type: Schema.Literal("result"),
    matches: Schema.Array(
      Schema.Struct({
        path: Schema.String,
        lineNumber: Schema.Number,
        lineContent: Schema.String,
        matchRanges: Schema.Array(Schema.Struct({ start: Schema.Number, end: Schema.Number })),
      }),
    ),
    truncated: Schema.Boolean,
    regexFallbackError: Schema.optional(Schema.String),
  }),
]);
