import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { NativeT3Runtime } from "./t3-runtime.ts";
import { check } from "./files.ts";

export type NetworkT3Access = {
  publicOrigin: string;
  cookieName: string;
  token: () => Promise<string>;
};

// Caddy authenticates the network peer. Use stock T3's headless session API,
// not pairing grants, installed-user credentials, or changes to native tool policy.
// The credential stays in this process and is never sent to the browser.
export async function createNetworkT3Access(
  runtime: NativeT3Runtime,
  publicOrigin: string,
): Promise<NetworkT3Access> {
  const response = await fetch(runtime.origin + "/api/auth/session", {
    signal: AbortSignal.timeout(10000),
  });
  const descriptor = (await response.json()) as {
    auth?: { sessionCookieName?: string };
  };
  const cookieName = descriptor.auth?.sessionCookieName;
  check(
    response.ok &&
      typeof cookieName === "string" &&
      /^[a-zA-Z0-9_]+$/.test(cookieName),
    "Native T3-Anmeldung nicht verfügbar",
    503,
  );
  let session: { token: string; expiresAt: string } | undefined;
  let issuing: Promise<string> | undefined;
  const access: NetworkT3Access = {
    publicOrigin: new URL(publicOrigin).origin,
    cookieName,
    token: async () => {
      // Renew on demand a day before expiry, without a browser login or timer.
      if (session && Date.parse(session.expiresAt) > Date.now() + 86400000)
        return session.token;
      if (!issuing)
        issuing = (async () => {
          try {
            const { stdout } = await promisify(execFile)(
              path.join(path.resolve(runtime.options.directory), "t3"),
              [
                "auth",
                "session",
                "issue",
                "--base-dir",
                path.resolve(runtime.options.home),
                "--subject",
                "bewerbung-netbird-gateway",
                "--label",
                "NetBird Bewerbungsverwaltung",
                "--json",
              ],
              {
                cwd: path.resolve(runtime.options.directory),
                env: {
                  ...process.env,
                  ...runtime.options.environment,
                  T3CODE_HOME: path.resolve(runtime.options.home),
                },
                timeout: 30000,
                maxBuffer: 1024 * 1024,
              },
            );
            const issued = JSON.parse(stdout) as typeof session;
            check(
              issued &&
                typeof issued.token === "string" &&
                /^[A-Za-z0-9_.-]+$/.test(issued.token) &&
                Date.parse(issued.expiresAt) > Date.now() + 86400000,
              "Native Netzwerk-Anmeldung fehlgeschlagen",
              503,
            );
            session = issued;
            return issued.token;
          } catch {
            // execFile errors can contain captured credentials; never propagate them.
            throw new Error("Native Netzwerk-Anmeldung fehlgeschlagen");
          }
        })().finally(() => {
          issuing = undefined;
        });
      return issuing;
    },
  };
  await access.token();
  return access;
}
