export const APPLICATION_STATUSES = [
  "In Arbeit",
  "Fertig",
  "Gesendet",
  "Absage",
  "Zusage",
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];
export type Provider = "pi" | "codex";
export type Settings = {
  revision: number;
  autoBuild: boolean;
  collapsedStatuses: ApplicationStatus[];
};
export type UiState = { openIds: string[] };
export type ApplicationChat = {
  id: string;
  title: string;
  status: string;
  updatedAt: string;
};
export type ApplicationNavigation = {
  environmentId: string;
  applications: {
    id: string;
    projectId: string | null;
    chats: ApplicationChat[];
  }[];
};
export type LibraryDocument = {
  id: string;
  name: string;
  label: string;
  mime: "application/pdf" | "image/jpeg" | "image/png";
  bytes: number;
  sha256: string;
  created: string;
  usedBy: number;
  tags: string[];
};
export type TemplateSummary = {
  id: string;
  created: string;
  bytes: number;
  digest: string;
  profiles: string[];
  label: string;
  isDefault: boolean;
  defaultProfile?: string;
};
export type Application = {
  id: string;
  company: string;
  role: string;
  status: ApplicationStatus;
  posting: string;
  notes: string;
  profile: string;
  template: string | null;
  revision: number;
  created: string;
  updated: string;
};
export type NewApplication = {
  company: string;
  role: string;
  status?: ApplicationStatus;
  posting?: string;
  notes?: string;
  template?: string;
  profile?: string;
  source?: string;
  cvSource?: string;
  coverSource?: string;
  documentIds?: string[];
};
export type Build = {
  id: string;
  app: string;
  kind: "cv" | "cover";
  revision: number;
  status: "queued" | "running" | "failed" | "success";
  finalized: number;
  created: string;
};
export type Model = { provider: string; id: string; name?: string };
export type ApplicationDetail = Application & {
  files: { name: string; size: number; text: boolean }[];
  documents: LibraryDocument[];
  builds: Build[];
  harness: {
    provider: Provider;
    busy: boolean;
    model?: string;
    pending: { id: string; title: string; message: string }[];
  };
};
export type SearchResult = Pick<Application, "id" | "company" | "role" | "status" | "updated"> & {
  match: "company" | "role" | "notes" | "posting" | "chat";
  preview: string;
};
export type PdfInput = {
  kind: "document" | "build";
  id: string;
  pages?: string;
};
export type PdfCompression = "lossless" | "compact";
export type PdfPlan = {
  revision: number;
  items: PdfInput[];
  compression: PdfCompression;
  excluded?: string[];
};
export type PdfJob = {
  id: string;
  app: string | null;
  status: "queued" | "running" | "success" | "failed";
  created: string;
  compression: PdfCompression;
  items: PdfInput[];
  sourceBytes: number;
  bytes?: number;
  pages?: number;
  error?: string;
  note?: string;
  label: string;
};
export type ChatEvent = {
  id: number;
  type: string;
  payload: {
    text?: string;
    error?: string;
    name?: string;
    phase?: string;
    provider?: string;
    [key: string]: unknown;
  };
};
