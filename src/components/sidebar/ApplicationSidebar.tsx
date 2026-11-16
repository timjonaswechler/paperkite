// T3 SidebarThreadHeader, SidebarThreadRow (card), SidebarListMarkers and SidebarChrome slots.
// Project/runtime metadata replaced by company/status; no T3 orchestration or drag/drop dependencies.
import { ContextMenu } from "@base-ui/react/context-menu";
import {
  BookOpen,
  Copy,
  FileText,
  ListFilter,
  Pencil,
  RefreshCw,
  Search,
  Settings,
  SquarePen,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import {
  APPLICATION_STATUSES,
  type Application,
  type ApplicationStatus,
} from "../../../shared/api";
import { cn } from "~/lib/utils";
import {
  SidebarFooter,
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "../ui/sidebar";
import {
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRadioItemIndicator,
  MenuSeparator,
  MenuSub,
  MenuSubTrigger,
  MenuSubPopup,
} from "../ui/menu";
import { CollapsibleSectionHeader } from "../ui/collapsible-section-header";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export type ApplicationAction = "edit" | "copy" | "documents" | "source";
type Props = {
  applications: Application[];
  currentId: string;
  openIds: string[];
  collapsed: ApplicationStatus[];
  onOpen: (id: string) => void;
  onClose: (id: string) => void;
  onAction: (action: ApplicationAction, id: string) => void;
  onStatus: (app: Application, status: ApplicationStatus) => void;
  onCollapse: (status: ApplicationStatus) => void;
  onNew: () => void;
  onSearch: () => void;
  onSettings: () => void;
  onLibrary: () => void;
  onRefresh: () => void;
};
function Utility({
  label,
  children,
  onClick,
}: {
  label: string;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <SidebarMenuButton size="icon" aria-label={label} onClick={onClick} />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipPopup>{label}</TooltipPopup>
    </Tooltip>
  );
}
function ApplicationRow({
  app,
  opened,
  props,
}: {
  app: Application;
  opened: boolean;
  props: Props;
}) {
  const selected = props.currentId === app.id;
  return (
    <li className="list-none py-0.5" data-application-id={app.id}>
      <ContextMenu.Root>
        <ContextMenu.Trigger
          render={
            <button
              type="button"
              aria-current={selected ? "page" : undefined}
              aria-label={`${app.company} · ${app.role}`}
              onClick={() => props.onOpen(app.id)}
              onKeyDown={(event) => {
                if (
                  event.key !== "ContextMenu" &&
                  !(event.shiftKey && event.key === "F10")
                )
                  return;
                event.preventDefault();
                const rect = event.currentTarget.getBoundingClientRect();
                event.currentTarget.dispatchEvent(
                  new MouseEvent("contextmenu", {
                    bubbles: true,
                    cancelable: true,
                    clientX: rect.left + 16,
                    clientY: rect.top + rect.height / 2,
                  }),
                );
              }}
            />
          }
          className={cn(
            "group/sidebar-row relative w-full cursor-pointer overflow-hidden rounded-md text-left outline-none select-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
            selected
              ? "bg-sidebar-row-active text-sidebar-foreground light:ring-1 light:ring-inset light:ring-sidebar-border/70"
              : "bg-transparent text-sidebar-foreground hover:bg-sidebar-row-hover",
          )}
        >
          <div className="relative z-10 h-auto px-(--sidebar-row-content-inset) py-(--sidebar-content-inset)">
            <div className="flex h-5 min-w-0 items-center gap-1.5">
              <span className="min-w-0 flex-1 truncate font-normal text-secondary-label text-xs">
                {app.company}
              </span>
              {opened && (
                <span className="shrink-0 text-xs text-sidebar-muted-foreground">
                  {app.status}
                </span>
              )}
            </div>
            <div className="mt-1 flex min-w-0 items-center gap-1.5">
              <span className="min-w-0 flex-1 truncate text-start text-sm font-medium text-foreground">
                {app.role}
              </span>
            </div>
          </div>
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Positioner
            className="z-[130]"
            sideOffset={4}
            align="start"
          >
            <ContextMenu.Popup
              className="dropdown-glass relative flex max-w-[calc(100vw-2rem)] min-w-56 origin-(--transform-origin) rounded-lg shadow-[0_16px_40px_-18px_rgb(0_0_0/55%)] outline-none focus:outline-none dark:shadow-[0_18px_44px_-18px_rgb(0_0_0/80%)]"
              data-slot="menu-popup"
            >
              <div className="max-h-(--available-height) w-full overflow-y-auto p-1">
                <MenuItem onClick={() => props.onOpen(app.id)}>
                  <SquarePen />
                  Öffnen
                </MenuItem>
                {opened && (
                  <MenuItem onClick={() => props.onClose(app.id)}>
                    <X />
                    Aus geöffneten Bewerbungen schließen
                  </MenuItem>
                )}
                <MenuSeparator />
                <MenuItem onClick={() => props.onAction("edit", app.id)}>
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
                      value={app.status}
                      onValueChange={(status) =>
                        props.onStatus(app, status as ApplicationStatus)
                      }
                    >
                      {APPLICATION_STATUSES.map((status) => (
                        <MenuRadioItem key={status} value={status} closeOnClick>
                          <span className="flex items-center gap-4">
                            <span className="flex-1">{status}</span>
                            <MenuRadioItemIndicator />
                          </span>
                        </MenuRadioItem>
                      ))}
                    </MenuRadioGroup>
                  </MenuSubPopup>
                </MenuSub>
                <MenuItem onClick={() => props.onAction("copy", app.id)}>
                  <Copy />
                  Kopie erstellen…
                </MenuItem>
                <MenuSeparator />
                <MenuItem onClick={() => props.onAction("documents", app.id)}>
                  <FileText />
                  Unterlagen / PDF öffnen
                </MenuItem>
                <MenuItem onClick={() => props.onAction("source", app.id)}>
                  <Pencil />
                  Lebenslauf / Quellen bearbeiten
                </MenuItem>
              </div>
            </ContextMenu.Popup>
          </ContextMenu.Positioner>
        </ContextMenu.Portal>
      </ContextMenu.Root>
    </li>
  );
}
export function ApplicationSidebar(props: Props) {
  const openedIds = new Set([
    ...props.openIds,
    ...(props.currentId ? [props.currentId] : []),
  ]);
  const opened = [...openedIds]
    .map((id) => props.applications.find((a) => a.id === id))
    .filter((a): a is Application => Boolean(a));
  return (
    <div
      className="flex h-full w-full flex-col bg-sidebar text-sidebar-foreground"
      data-app-sidebar
    >
      <SidebarGroup>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={props.onSearch}
            aria-label="Bewerbungen suchen"
            className="flex h-8 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring/70"
          >
            <Search className="size-4 shrink-0 text-(--sidebar-icon-color)" />
            <span>Suchen</span>
            <kbd className="ml-auto text-2xs font-normal opacity-60">⌘ K</kbd>
          </button>
          <Utility label="Neue Bewerbung (Strg/⌘ N)" onClick={props.onNew}>
            <SquarePen />
          </Utility>
        </div>
      </SidebarGroup>
      <nav
        aria-label="Bewerbungen"
        className="flex min-h-0 flex-1 flex-col overflow-y-auto px-(--sidebar-content-inset) pb-2"
      >
        <ul aria-label="Geöffnete Bewerbungen" className="shrink-0 pb-4">
          {opened.map((app) => (
            <ApplicationRow key={app.id} app={app} opened props={props} />
          ))}
        </ul>
        <div className="mt-auto" data-status-groups>
          {APPLICATION_STATUSES.map((status) => {
            const apps = props.applications.filter(
              (app) => app.status === status,
            );
            const expanded = !props.collapsed.includes(status);
            return (
              <section key={status} aria-label={status}>
                <div className="relative mx-0.5 h-8">
                  <CollapsibleSectionHeader
                    expanded={expanded}
                    onClick={() => props.onCollapse(status)}
                    accessory={
                      <span className="font-normal tabular-nums">
                        {apps.length}
                      </span>
                    }
                  >
                    {status}
                  </CollapsibleSectionHeader>
                </div>
                {expanded && (
                  <ul>
                    {apps.map((app) => (
                      <ApplicationRow
                        key={app.id}
                        app={app}
                        opened={openedIds.has(app.id)}
                        props={props}
                      />
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      </nav>
      <SidebarFooter>
        <SidebarMenu className="flex-row items-center gap-1">
          <SidebarMenuItem>
            <Utility
              label="Einstellungen (Strg/⌘ ,)"
              onClick={props.onSettings}
            >
              <Settings />
            </Utility>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <Utility label="Eigene Dateien" onClick={props.onLibrary}>
              <BookOpen />
            </Utility>
          </SidebarMenuItem>
          <SidebarMenuItem className="ml-auto">
            <Utility label="Aktualisieren" onClick={props.onRefresh}>
              <RefreshCw />
            </Utility>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </div>
  );
}
