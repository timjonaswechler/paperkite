import { useState } from "react";
import { Button } from "~/components/ui/button";
import { useApplications } from "./ApplicationsProvider";

export function NativeChatButton({ applicationId }: { applicationId: string }) {
  const app = useApplications();
  const [busy, setBusy] = useState(false);
  async function create() {
    setBusy(true);
    await app.newChat(applicationId);
    setBusy(false);
  }
  return (
    <Button disabled={busy} onClick={() => void create()}>
      {busy ? "Chat wird geöffnet…" : "Neuer Chat"}
    </Button>
  );
}
