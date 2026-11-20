import { Link } from "@tanstack/react-router";
import { ProjectFavicon, type ProjectFaviconProject } from "~/components/ProjectFavicon";
import { ProjectMonogram } from "~/components/ProjectMonogram";
import {
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
  WorkspaceBreadcrumbText,
} from "~/components/WorkspaceBreadcrumb";
import { MiddleTruncate } from "~/components/ui/middle-truncate";
import { deriveProjectIdentity } from "~/projectIdentity";
import { confirmNavigation } from "./navigation";
import type { Application } from "./shared/api";

export function ApplicationBreadcrumbRoot({
  application,
  project,
  onOpen,
}: {
  application: Pick<Application, "id" | "company" | "role">;
  project: ProjectFaviconProject | null;
  onOpen?: () => void;
}) {
  const identity = deriveProjectIdentity(application.company);
  return (
    <>
      <WorkspaceBreadcrumbItem className="shrink">
        <Link
          to="/bewerbungen/$applicationId"
          params={{ applicationId: application.id }}
          search={{}}
          aria-label={`Bewerbung öffnen: ${application.company}`}
          title={`${application.company} · ${application.role}`}
          onClick={(event) => {
            if (
              event.button !== 0 ||
              event.metaKey ||
              event.ctrlKey ||
              event.shiftKey ||
              event.altKey
            )
              return;
            if (!confirmNavigation()) {
              event.preventDefault();
              return;
            }
            onOpen?.();
          }}
          className="inline-flex min-w-0 max-w-full cursor-pointer items-center gap-1.5 rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          {project ? (
            <ProjectFavicon project={project} className="size-3.5" />
          ) : (
            <ProjectMonogram text={identity.monogram} color={identity.color} className="size-3.5" />
          )}
          <MiddleTruncate
            data-slot="workspace-breadcrumb-text"
            value={application.company}
            showTitle={false}
            variant="cap-aligned"
          />
        </Link>
      </WorkspaceBreadcrumbItem>
      <WorkspaceBreadcrumbSeparator>
        <WorkspaceBreadcrumbText>/</WorkspaceBreadcrumbText>
      </WorkspaceBreadcrumbSeparator>
    </>
  );
}
