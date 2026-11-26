import { assert, it } from "@effect/vitest";
import { vi } from "vite-plus/test";

vi.mock("./sourceControlDefinitions.ts", async () => {
  const { definitions } = await import("../paperkite/integration/SourceControl.test-fixtures.ts");
  return { sourceControlDefinitions: definitions };
});

import { DeviceHostId, SecretProviderId, UsageLimitSourceId } from "@t3tools/contracts";
import * as SecretResolver from "@t3tools/secret-provider-core/server/SecretResolver";
import * as Effect from "effect/Effect";

import {
  collectSourceControlHostSecretReferences,
  invalidateSettingsSecrets,
  resolveSourceControlHostSecrets,
} from "./sourceControlHostSecrets.ts";

const source = (reference: string) => ({
  provider: SecretProviderId.make("homelab"),
  reference,
});

const secretsByReference = new Map([
  ["fixture#token", "bb_from_provider"],
  ["source#token", "src_from_provider"],
]);

const perHostHosts = {
  fixturehost: {
    tokens: { "tokens.fixture.test": source("source#token"), "source.acme.test": "src_literal" },
  },
};

const hosts = {
  fixture: { email: "me@example.test", accessToken: source("fixture#token") },
  fixturetoken: { token: source("missing#token") },
  fixturehost: { tokens: { "tokens.fixture.test": "src_literal" } },
};

function countingResolver() {
  const reads: Array<string> = [];
  const resolver = SecretResolver.SecretResolver.of({
    label: (provider) => Effect.succeed(provider),
    read: (references) =>
      Effect.sync(() =>
        references.map((reference) => {
          reads.push(reference.reference);
          return secretsByReference.get(reference.reference);
        }),
      ),
    invalidate: () => Effect.void,
  });
  return { reads, resolver };
}

it.effect(
  "replaces only the requested kind's credential references with the secrets they name",
  () =>
    Effect.gen(function* () {
      const { reads, resolver } = countingResolver();
      const resolved = yield* resolveSourceControlHostSecrets(resolver, hosts, "fixture");
      assert.deepEqual(resolved, {
        ...hosts,
        fixture: { email: "me@example.test", accessToken: "bb_from_provider" },
      });
      assert.deepEqual(reads, ["fixture#token"]);
    }),
);

it.effect("keeps a reference the provider cannot read, so it never passes for an unset one", () =>
  Effect.gen(function* () {
    const { reads, resolver } = countingResolver();
    const resolved = yield* resolveSourceControlHostSecrets(resolver, hosts, "fixturetoken");
    assert.deepEqual(resolved.fixturetoken, { token: source("missing#token") });
    assert.deepEqual(reads, ["missing#token"]);
  }),
);

it.effect("leaves the resolver unused for a kind that holds no reference", () =>
  Effect.gen(function* () {
    const { reads, resolver } = countingResolver();
    const resolved = yield* resolveSourceControlHostSecrets(resolver, hosts, "fixturehost");
    assert.strictEqual(resolved, hosts);
    assert.deepEqual(reads, []);
  }),
);

it.effect("replaces a per-host token reference and keeps the literal beside it", () =>
  Effect.gen(function* () {
    const { reads, resolver } = countingResolver();
    const resolved = yield* resolveSourceControlHostSecrets(resolver, perHostHosts, "fixturehost");
    assert.deepEqual(resolved, {
      fixturehost: {
        tokens: { "tokens.fixture.test": "src_from_provider", "source.acme.test": "src_literal" },
      },
    });
    assert.deepEqual(reads, ["source#token"]);
  }),
);

it("collects the references held in credential fields and skips literal values", () => {
  assert.deepEqual(collectSourceControlHostSecretReferences(hosts), [
    source("missing#token"),
    source("fixture#token"),
  ]);
  assert.deepEqual(collectSourceControlHostSecretReferences(perHostHosts), [
    source("source#token"),
  ]);
  assert.deepEqual(
    collectSourceControlHostSecretReferences({
      fixture: { accessToken: "literal" },
      fixturehost: { tokens: { "tokens.fixture.test": "src_literal" } },
    }),
    [],
  );
});

it.effect("does not resolve or collect references for an unregistered host", () =>
  Effect.gen(function* () {
    const { reads, resolver } = countingResolver();
    const unsupported = { github: { tokens: { "github.com": source("retired#token") } } };
    const resolved = yield* resolveSourceControlHostSecrets(resolver, unsupported, "github");
    assert.strictEqual(resolved, unsupported);
    assert.deepEqual(reads, []);
    assert.deepEqual(collectSourceControlHostSecretReferences(unsupported), []);
  }),
);

it.effect("reads a collected reference again once it is invalidated", () =>
  Effect.gen(function* () {
    let current = "stale";
    const cache = new Map<string, string>();
    const resolver = SecretResolver.SecretResolver.of({
      label: (provider) => Effect.succeed(provider),
      read: (references) =>
        Effect.sync(() =>
          references.map((reference) => {
            const hit = cache.get(reference.reference);
            if (hit !== undefined) return hit;
            cache.set(reference.reference, current);
            return current;
          }),
        ),
      invalidate: (references) =>
        Effect.sync(() => {
          if (references === undefined) cache.clear();
          else for (const reference of references) cache.delete(reference.reference);
        }),
    });
    const read = () => resolveSourceControlHostSecrets(resolver, hosts, "fixture");
    const usageLimitSources = {
      [UsageLimitSourceId.make("referenced")]: {
        kind: "cliproxy",
        url: "https://hub.test",
        managementKey: source("cliproxy#key"),
        enabled: true,
      },
      [UsageLimitSourceId.make("literal")]: {
        kind: "cliproxy",
        url: "https://hub.test",
        managementKey: "plain-key",
        enabled: true,
      },
    } as const;
    const easDeviceHosts = [
      {
        kind: "eas" as const,
        id: DeviceHostId.make("ref"),
        label: "Ref",
        maxSessionMinutes: 30,
        idleMinutes: 10,
        maxConcurrentSessions: 2,
        accessToken: source("expo#token"),
      },
    ];
    const simlockDeviceHosts = [
      {
        kind: "simlock" as const,
        id: DeviceHostId.make("pool"),
        label: "Pool",
        gatewayUrl: "https://simlock.test:4700",
        agentToken: source("simlock#token"),
        maxLeases: 2,
        maxLeaseMinutes: 60,
      },
    ];
    cache.set("cliproxy#key", "stale");
    cache.set("voice#key", "stale");
    cache.set("expo#token", "stale");
    cache.set("simlock#token", "stale");
    assert.deepEqual((yield* read()).fixture, {
      email: "me@example.test",
      accessToken: "stale",
    });
    current = "rotated";
    yield* invalidateSettingsSecrets(
      resolver,
      Effect.succeed({
        sourceControlHosts: hosts,
        cloudSpeechCredentials: { openai: source("voice#key"), xai: "", openrouter: "" },
        usageLimitSources,
        textGenerators: {},
        easDeviceHosts,
        simlockDeviceHosts,
      }),
    );
    assert.isFalse(cache.has("cliproxy#key"));
    assert.isFalse(cache.has("voice#key"));
    assert.isFalse(cache.has("expo#token"));
    assert.isFalse(cache.has("simlock#token"));
    assert.deepEqual((yield* read()).fixture, {
      email: "me@example.test",
      accessToken: "rotated",
    });
    current = "rotated again";
    yield* invalidateSettingsSecrets(resolver, Effect.fail("settings unreadable"));
    assert.deepEqual((yield* read()).fixture, {
      email: "me@example.test",
      accessToken: "rotated again",
    });
  }),
);
