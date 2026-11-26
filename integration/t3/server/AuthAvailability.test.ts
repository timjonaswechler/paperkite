import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as EnvironmentAuth from "../../auth/EnvironmentAuth.ts";
import * as PairingGrantStore from "../../auth/PairingGrantStore.ts";
import * as ServerSecretStore from "../../auth/ServerSecretStore.ts";
import * as ServerConfig from "../../config.ts";
import * as ServerEnvironment from "../../environment/ServerEnvironment.ts";
import * as SqlitePersistence from "../../persistence/Sqlite.ts";
import * as ManagedPolicy from "../../policy/ManagedPolicy.ts";
import * as Runtime from "./Runtime.ts";

const layerTest = EnvironmentAuth.layer.pipe(
  Layer.provide(ManagedPolicy.layerTest()),
  Layer.provideMerge(SqlitePersistence.layerMemory),
  Layer.provide(ServerSecretStore.layer),
  Layer.provide(ServerEnvironment.layerIdentity),
  Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "paperkite-auth-availability-" })),
  Layer.provide(
    Layer.succeed(Runtime.Profile, {
      application: "paperkite",
      upstreamCommit: "fixture",
      profile: "proof",
      capabilities: {
        threadSettlement: false,
        pullRequests: false,
        git: false,
        pairing: false,
        environments: false,
        github: false,
        sourceControl: false,
        issues: false,
      },
    }),
  ),
  Layer.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
);

it.effect(
  "rejects public pairing without creating grants, but retains the local bootstrap and sessions",
  () =>
    Effect.gen(function* () {
      const auth = yield* EnvironmentAuth.EnvironmentAuth;
      const grants = yield* PairingGrantStore.PairingGrantStore;
      const before = yield* grants.listActive();
      for (const operation of [
        auth.createPairingLink(),
        auth.createPairingLink({ purpose: "startup" }),
        auth.issuePairingCredential(),
        auth.issueConnectCredential({
          proofKeyThumbprint: "fixture-device",
          requireApproval: false,
        }),
      ]) {
        expect(yield* operation.pipe(Effect.flip)).toMatchObject({
          _tag: "EnvironmentFeatureUnavailableError",
          feature: "pairing",
        });
      }
      expect(yield* grants.listActive()).toEqual(before);
      const client = {
        deviceType: "desktop" as const,
        ipAddress: "127.0.0.1",
        os: "fixture",
        browser: "fixture",
      };
      const oldBrowserGrant = yield* grants.issueOneTimeToken({ subject: "one-time-token" });
      const oldAccessGrant = yield* grants.issueOneTimeToken({ subject: "one-time-token" });
      expect(
        (yield* auth.createBrowserSession(oldBrowserGrant.credential, client).pipe(Effect.result))
          ._tag,
      ).toBe("Failure");
      expect(
        (yield* auth
          .exchangeBootstrapCredentialForAccessToken(oldAccessGrant.credential, undefined, client, {
            proofKeyThumbprint: "fixture-key",
          })
          .pipe(Effect.result))._tag,
      ).toBe("Failure");
      expect((yield* grants.listActive()).length).toBe(before.length + 2);
      expect(yield* auth.listSessions()).toEqual([]);
      const bootstrap = yield* auth.issueStartupPairingCredential();
      const session = yield* auth.createBrowserSession(bootstrap.credential, client);
      expect(session.sessionToken.length).toBeGreaterThan(0);
      expect((yield* auth.issueSession()).token.length).toBeGreaterThan(0);
    }).pipe(Effect.provide(layerTest)),
);
