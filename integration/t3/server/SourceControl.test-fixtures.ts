import {
  makeProviderSettingsSchema,
  SettingsSecretValue,
  SourceControlProviderKind,
} from "@t3tools/contracts";
import {
  HostCredentialSettings,
  makeSourceControlDefinitionRegistry,
  UNKNOWN_SOURCE_CONTROL_CLIENT,
} from "@t3tools/source-control-core/shared/definition";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

const secret = SettingsSecretValue.pipe(
  Schema.withDecodingDefault(Effect.succeed("")),
  Schema.annotateKey({ providerSettingsForm: { control: "password" } }),
);

// Synthetic catalog configuration tests shared secret plumbing, not installed product integrations.
export const registryDefinitions = makeSourceControlDefinitionRegistry(
  ["fixtureone", "fixturetwo", "fixturethree"].map((kind) => ({
    ...UNKNOWN_SOURCE_CONTROL_CLIENT,
    kind: SourceControlProviderKind.make(kind),
    recognizeRemote: (remote) =>
      remote.hostname.includes(kind)
        ? {
            kind: SourceControlProviderKind.make(kind),
            name: remote.hostname,
            baseUrl: `https://${remote.host}`,
          }
        : null,
  })),
);

export const definitions = makeSourceControlDefinitionRegistry([
  {
    ...UNKNOWN_SOURCE_CONTROL_CLIENT,
    kind: SourceControlProviderKind.make("fixturetoken"),
    settings: makeProviderSettingsSchema({ token: secret }),
  },
  {
    ...UNKNOWN_SOURCE_CONTROL_CLIENT,
    kind: SourceControlProviderKind.make("fixture"),
    settings: makeProviderSettingsSchema({
      accessToken: secret,
      apiToken: secret,
      email: Schema.String,
    }),
  },
  {
    ...UNKNOWN_SOURCE_CONTROL_CLIENT,
    kind: SourceControlProviderKind.make("fixturehost"),
    settings: HostCredentialSettings,
  },
]);
