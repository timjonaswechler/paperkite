import { useEffect, useEffectEvent } from "react";
import { registerCommands, registerMenuAction } from "~/shortcuts/dispatcher";
import { useApplications } from "./ApplicationsProvider";

export function ApplicationShortcuts() {
  const app = useApplications();
  const search = useEffectEvent(() => app.setShowSearch(true));
  const createApplication = useEffectEvent(() => app.setForm({ mode: "new" }));
  const createChat = useEffectEvent(() => {
    if (app.currentId) void app.newChat(app.currentId);
    else app.setForm({ mode: "new" });
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- registers application navigation with the native shortcut dispatcher and menu bus
  useEffect(() => {
    const unregister = registerCommands({
      "commandPalette.toggle": (event) => {
        event.preventDefault();
        search();
      },
      "chat.new": (event) => {
        event.preventDefault();
        createChat();
      },
      "chat.newLocal": (event) => {
        event.preventDefault();
        createChat();
      },
      "projectSearch.toggle": (event) => {
        event.preventDefault();
        search();
      },
    });
    const open = (event: Event) => {
      const detail = (event as CustomEvent<{ open?: string }>).detail;
      if (detail?.open === "add-project") createApplication();
      else if (detail?.open === "new-thread-in") createChat();
      else search();
    };
    window.addEventListener("bewerbung:command", open);
    const menu = registerMenuAction("new-thread", createChat);
    return () => {
      unregister();
      menu();
      window.removeEventListener("bewerbung:command", open);
    };
  }, []);
  return null;
}
