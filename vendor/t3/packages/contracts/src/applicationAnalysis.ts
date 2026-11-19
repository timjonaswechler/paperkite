import * as Schema from "effect/Schema";
import { ModelSelection } from "./modelSelection.ts";

export const ApplicationAnalysisResult = Schema.Struct({
  company: Schema.String.check(Schema.isMaxLength(200)),
  role: Schema.String.check(Schema.isMaxLength(200)),
  requirements: Schema.Array(Schema.String.check(Schema.isMaxLength(600))).check(Schema.isMaxLength(20)),
});
export type ApplicationAnalysisResult = typeof ApplicationAnalysisResult.Type;

export const ApplicationAnalysisInput = Schema.Struct({
  text: Schema.String.check(Schema.isMinLength(80), Schema.isMaxLength(60_000)),
  sourceUrl: Schema.String.check(Schema.isMaxLength(2_000)),
  modelSelection: Schema.optionalKey(ModelSelection),
});
export type ApplicationAnalysisInput = typeof ApplicationAnalysisInput.Type;
