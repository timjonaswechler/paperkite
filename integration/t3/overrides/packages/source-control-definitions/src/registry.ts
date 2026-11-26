import {
  makeSourceControlDefinitionRegistry,
  type SourceControlDefinitionRegistry,
} from "@t3tools/source-control-core/shared/definition";

export const builtInSourceControlDefinitions: SourceControlDefinitionRegistry = {
  ...makeSourceControlDefinitionRegistry([]),
  issueBindings: () => [],
};
