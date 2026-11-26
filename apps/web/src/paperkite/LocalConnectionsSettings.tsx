import {
  AuthAccessReadScope,
  AuthAccessWriteScope,
  type AuthSessionId,
  type AuthClientSession,
} from "@t3tools/contracts";
import { useGT } from "gt-react";
import { useState } from "react";
import { Button } from "../components/ui/button";
import {
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "../components/settings/settingsLayout";
import { authEnvironment } from "../state/auth";
import { usePrimaryEnvironment } from "../state/environments";
import { useEnvironmentQuery } from "../state/query";
import { useEnvironmentScope } from "../state/session";
import { useAtomCommand } from "../state/use-atom-command";

function clientLabel(session: AuthClientSession): string {
  // oxlint-disable-next-line t3code/no-rpc-permission-bypass -- AuthClientSession.client is presentation metadata, not a raw RPC client.
  const metadata = session.client;
  return metadata.label ?? metadata.browser ?? metadata.os ?? metadata.deviceType;
}

export function LocalConnectionsSettings({ view }: { readonly view: "environments" | "access" }) {
  const gt = useGT();
  const environment = usePrimaryEnvironment();
  const environmentId = environment?.environmentId ?? null;
  const canRead = useEnvironmentScope(environmentId, AuthAccessReadScope);
  const canWrite = useEnvironmentScope(environmentId, AuthAccessWriteScope);
  const access = useEnvironmentQuery(
    view === "access" && canRead && environmentId !== null
      ? authEnvironment.accessChanges({ environmentId, input: null })
      : null,
  );
  const sessions = access.data?.type === "snapshot" ? access.data.payload.clientSessions : [];
  const revoke = useAtomCommand(authEnvironment.revokeClient);
  const [revoking, setRevoking] = useState<AuthSessionId | null>(null);
  const revokeSession = async (sessionId: AuthSessionId) => {
    if (!canWrite || environmentId === null || revoking !== null) return;
    setRevoking(sessionId);
    await revoke({ environmentId, input: { sessionId } });
    setRevoking(null);
  };
  return (
    <SettingsPageContainer>
      <SettingsSection title={gt("This device")}>
        <SettingsRow title={environment?.label ?? gt("This device")} />
      </SettingsSection>
      {view === "access" ? (
        <SettingsSection title={gt("Authorized clients")}>
          {access.error ? <p role="alert">{access.error}</p> : null}
          {access.isPending && access.data === null ? <p>{gt("Loading…")}</p> : null}
          {sessions.map((session) => (
            <SettingsRow
              key={session.sessionId}
              title={clientLabel(session)}
              status={session.current ? gt("This device") : undefined}
              control={
                session.current ? undefined : (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!canWrite || revoking !== null}
                    onClick={() => void revokeSession(session.sessionId)}
                  >
                    {revoking === session.sessionId ? gt("Revoking…") : gt("Revoke")}
                  </Button>
                )
              }
            />
          ))}
        </SettingsSection>
      ) : null}
    </SettingsPageContainer>
  );
}
