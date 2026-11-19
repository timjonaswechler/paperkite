import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ContextMenu } from "@base-ui/react/context-menu";
import {
  BookOpen,
  ChevronRight,
  Copy,
  FileText,
  ListFilter,
  MessageSquare,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  SquarePen,
  Trash2,
} from "lucide-react";
import { APPLICATION_STATUSES, type Application, type ApplicationChat } from "./shared/api";
import { useApplications } from "./ApplicationsProvider";
import { errorMessage } from "./api";
import { useQuietThreadShells } from "~/state/entities";
import { DraftId, useComposerDraftStore } from "~/composerDraftStore";
import { discardComposerDraft } from "~/lib/discardComposerDraft";
import { isListedThreadLineage } from "@t3tools/contracts";
import { isElectron } from "~/env";
import { SidebarChromeHeader, SidebarChromeFooter } from "~/components/sidebar/SidebarChrome";
import {
  SidebarContent,
  SidebarGroup,
  SidebarMenuItem,
  SidebarMenuButton,
  useSidebar,
} from "~/components/ui/sidebar";
import { CollapsibleSectionHeader } from "~/components/ui/collapsible-section-header";
import { Button } from "~/components/ui/button";
import {
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRadioItemIndicator,
  MenuSeparator,
  MenuSub,
  MenuSubTrigger,
  MenuSubPopup,
} from "~/components/ui/menu";
import { cn } from "~/lib/utils";

function DraftTitle({ id }: { id: string }) {
  const prompt = useComposerDraftStore((store) => store.draftsByThreadKey[id]?.prompt ?? "");
  return (
    <span className="min-w-0 flex-1 truncate">
      {prompt.trim().split("\n", 1)[0] || "Neuer Chat"}
    </span>
  );
}

function ApplicationEntry({ application }: { application: Application }) {
  const app = useApplications();
  const navigate = useNavigate();
  const { isMobile, setOpenMobile } = useSidebar();
  const [expanded, setExpanded] = useState<boolean | null>(null);
  const loaded = useQuietThreadShells();
  const drafts = useComposerDraftStore((store) => store.draftThreadsByThreadKey);
  const mapping = app.navigation.applications.find((item) => item.id === application.id);
  const chats = new Map<string, ApplicationChat>(
    (mapping?.chats ?? []).map((chat) => [chat.id, chat]),
  );
  for (const thread of loaded) {
    if (
      thread.environmentId !== app.navigation.environmentId ||
      thread.projectId !== mapping?.projectId
    )
      continue;
    if (
      thread.deletedAt !== null ||
      thread.archivedAt !== null ||
      !isListedThreadLineage(thread.lineage)
    ) {
      chats.delete(thread.id);
      continue;
    }
    chats.set(thread.id, {
      id: thread.id,
      title: thread.title,
      status: thread.source.status,
      updatedAt: thread.updatedAt,
    });
  }
  const ordered = [...chats.values()].sort(
    (a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id),
  );
  const localDrafts = Object.entries(drafts)
    .filter(
      ([, draft]) =>
        draft.environmentId === app.navigation.environmentId &&
        draft.projectId === mapping?.projectId &&
        draft.promotedTo == null &&
        !chats.has(draft.threadId),
    )
    .map(([draftId, draft]) => ({ ...draft, draftId }));
  const active = app.currentId === application.id;
  const open = expanded ?? active;
  const closeMobile = () => {
    if (isMobile) setOpenMobile(false);
  };
  const openDetails = () => {
    app.open(application.id);
    closeMobile();
  };
  const newChat = () => {
    setExpanded(true);
    void app.newChat(application.id);
    closeMobile();
  };
  return (
    <li data-application-id={application.id} className="list-none pb-1">
      <ContextMenu.Root>
        <ContextMenu.Trigger render={<div className="flex min-w-0 items-center gap-0.5" />}>
          <Button
            size="icon-micro"
            variant="ghost"
            aria-label={`${open ? "Chats einklappen" : "Chats ausklappen"}: ${application.company}`}
            aria-expanded={open}
            onClick={() => setExpanded(!open)}
          >
            <ChevronRight className={cn("size-3.5", open && "rotate-90")} />
          </Button>
          <SidebarMenuButton
            isActive={active}
            onClick={openDetails}
            aria-label={`${application.company} · ${application.role}`}
            className="h-auto min-h-12 min-w-0 flex-1"
          >
            <span className="block min-w-0">
              <span className="block truncate text-xs text-sidebar-muted-foreground">
                {application.company}
              </span>
              <span className="block truncate text-sm">{application.role}</span>
            </span>
          </SidebarMenuButton>
          <Button
            size="icon-micro"
            variant="ghost"
            aria-label={`Neuer Chat: ${application.company}`}
            onClick={newChat}
          >
            <Plus className="size-3.5" />
          </Button>
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Positioner className="z-[130]" sideOffset={4}>
            <ContextMenu.Popup className="dropdown-glass min-w-56 rounded-lg p-1 shadow-xl outline-none">
              <MenuItem onClick={openDetails}>
                <FileText />
                Bewerbung öffnen
              </MenuItem>
              <MenuItem onClick={newChat}>
                <Plus />
                Neuer Chat
              </MenuItem>
              <MenuSeparator />
              <MenuItem onClick={() => void app.applicationAction("edit", application.id)}>
                <Pencil />
                Bewerbungsdetails bearbeiten
              </MenuItem>
              <MenuSub>
                <MenuSubTrigger>
                  <ListFilter />
                  Status ändern
                </MenuSubTrigger>
                <MenuSubPopup>
                  <MenuRadioGroup
                    value={application.status}
                    onValueChange={(status) =>
                      void app.changeStatus(application, status as Application["status"])
                    }
                  >
                    {APPLICATION_STATUSES.map((status) => (
                      <MenuRadioItem key={status} value={status} closeOnClick>
                        <span className="flex w-full items-center gap-4">
                          <span className="flex-1">{status}</span>
                          <MenuRadioItemIndicator />
                        </span>
                      </MenuRadioItem>
                    ))}
                  </MenuRadioGroup>
                </MenuSubPopup>
              </MenuSub>
              <MenuItem onClick={() => void app.applicationAction("copy", application.id)}>
                <Copy />
                Kopie erstellen…
              </MenuItem>
              <MenuItem onClick={() => app.open(application.id, "documents")}>
                <FileText />
                Unterlagen / PDF öffnen
              </MenuItem>
              <MenuItem onClick={() => app.open(application.id, "source")}>
                <Pencil />
                Lebenslauf / Quellen bearbeiten
              </MenuItem>
              <MenuSeparator />
              <MenuItem onClick={() => void app.applicationAction("delete", application.id)}>
                <Trash2 />
                Bewerbung löschen
              </MenuItem>
            </ContextMenu.Popup>
          </ContextMenu.Positioner>
        </ContextMenu.Portal>
      </ContextMenu.Root>
      {open && (
        <ul
          aria-label={`Chats: ${application.company}`}
          className="ml-5 border-l border-sidebar-border pl-1"
        >
          {ordered.map((chat) => (
            <li key={chat.id} data-chat-id={chat.id} className="flex min-w-0 items-center">
              <SidebarMenuButton
                size="sm"
                isActive={
                  app.routeTarget?.kind === "server" &&
                  app.routeTarget.threadRef.threadId === chat.id
                }
                onClick={() => {
                  void navigate({
                    to: "/$environmentId/$threadId",
                    params: {
                      environmentId: app.navigation.environmentId,
                      threadId: chat.id,
                    },
                  });
                  closeMobile();
                }}
              >
                <MessageSquare />
                <span className="min-w-0 flex-1 truncate">{chat.title || "Chat"}</span>
                {["queued", "preparing", "starting", "running", "waiting"].includes(
                  chat.status,
                ) && (
                  <span
                    aria-label="Chat ist aktiv"
                    className="size-1.5 shrink-0 rounded-full bg-success"
                  />
                )}
              </SidebarMenuButton>
              <Button
                size="icon-micro"
                variant="ghost"
                aria-label={`Chat löschen: ${chat.title || "Chat"}`}
                onClick={() => {
                  app.setDeleteError("");
                  app.setRemovingChat({
                    applicationId: application.id,
                    id: chat.id,
                    title: chat.title || "Chat",
                    environmentId: app.navigation.environmentId,
                  });
                }}
              >
                <Trash2 className="size-3" />
              </Button>
            </li>
          ))}
          {localDrafts.map((draft) => (
            <li
              key={draft.draftId}
              data-chat-draft-id={draft.draftId}
              className="flex min-w-0 items-center"
            >
              <SidebarMenuButton
                size="sm"
                isActive={
                  app.routeTarget?.kind === "draft" && app.routeTarget.draftId === draft.draftId
                }
                onClick={() => {
                  void navigate({
                    to: "/draft/$draftId",
                    params: { draftId: draft.draftId },
                  });
                  closeMobile();
                }}
              >
                <MessageSquare />
                <DraftTitle id={draft.draftId} />
              </SidebarMenuButton>
              <Button
                size="icon-micro"
                variant="ghost"
                aria-label="Chatentwurf löschen"
                onClick={() => {
                  discardComposerDraft(DraftId.make(draft.draftId));
                  if (
                    app.routeTarget?.kind === "draft" &&
                    app.routeTarget.draftId === draft.draftId
                  )
                    app.open(application.id);
                }}
              >
                <Trash2 className="size-3" />
              </Button>
            </li>
          ))}
          <li>
            <SidebarMenuButton size="sm" onClick={newChat}>
              <Plus />
              <span>Neuer Chat</span>
            </SidebarMenuButton>
          </li>
        </ul>
      )}
    </li>
  );
}

export default function ApplicationsSidebar() {
  const app = useApplications();
  const { isMobile, setOpenMobile } = useSidebar();
  const closeMobile = () => {
    if (isMobile) setOpenMobile(false);
  };
  return (
    <>
      <SidebarChromeHeader isElectron={isElectron} />
      <SidebarContent data-applications-sidebar className="min-h-full">
        <SidebarGroup>
          <div className="flex items-center gap-1">
            <SidebarMenuButton
              onClick={() => {
                app.setShowSearch(true);
                closeMobile();
              }}
            >
              <Search />
              <span>Suchen</span>
            </SidebarMenuButton>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Neue Bewerbung"
              onClick={() => {
                app.setForm({ mode: "new" });
                closeMobile();
              }}
            >
              <SquarePen />
            </Button>
          </div>
        </SidebarGroup>
        <nav
          aria-label="Bewerbungen"
          className="flex min-h-0 flex-1 flex-col px-(--sidebar-content-inset) pb-2"
        >
          {APPLICATION_STATUSES.map((status) => {
            const applications = app.applications.filter(
              (application) => application.status === status,
            );
            const expanded = !(app.settings?.collapsedStatuses ?? []).includes(status);
            return (
              <section
                key={status}
                aria-label={status}
                className={status === "Fertig" ? "mt-auto" : undefined}
              >
                <div className="relative h-8">
                  <CollapsibleSectionHeader
                    expanded={expanded}
                    onClick={() => app.collapse(status)}
                    accessory={
                      <span className="font-normal tabular-nums">{applications.length}</span>
                    }
                  >
                    {status}
                  </CollapsibleSectionHeader>
                </div>
                {expanded && (
                  <ul>
                    {applications.map((application) => (
                      <ApplicationEntry key={application.id} application={application} />
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </nav>
      </SidebarContent>
      <SidebarChromeFooter>
        <SidebarMenuItem>
          <SidebarMenuButton
            size="icon"
            aria-label="Eigene Dateien"
            onClick={() => {
              app.setShowLibrary(true);
              closeMobile();
            }}
          >
            <BookOpen />
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem className="ml-auto">
          <SidebarMenuButton
            size="icon"
            aria-label="Aktualisieren"
            onClick={() =>
              void app.refreshAll().catch((error) => app.setError(errorMessage(error)))
            }
          >
            <RefreshCw />
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarChromeFooter>
    </>
  );
}
