import type { FormSpec, Values } from "../../../../../../../shared/cv-form";
import type {
  ApplicantProfile,
  ApplicantBindings,
} from "../../../../../../../shared/applicant-profile";
export type {
  ApplicantProfile,
  ApplicantBindings,
} from "../../../../../../../shared/applicant-profile";
export type SignatureInfo = { id: string; bytes: number; width: number; height: number };
export type ApplicationApplicantProfile = {
  revision: number;
  profile: ApplicantProfile | null;
  current: ApplicantProfile;
  outdated: boolean;
  signature: SignatureInfo | null;
};
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
  autoPruneBuilds: boolean;
  prepareCoverLetter: boolean;
  defaultCvModId?: string | null;
  defaultCoverModId?: string | null;
  collapsedStatuses: ApplicationStatus[];
  analysisModel: { instanceId: string; model: string } | null;
  applicantName: string;
  applicantProfile: ApplicantProfile;
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
  cvModId?: string | null;
  coverModId?: string | null;
  documentIds?: string[];
};
export type Build = {
  id: string;
  app: string;
  kind: "cv" | "cover";
  revision: number;
  status: "queued" | "running" | "failed" | "success";
  finalized: number;
  deletionBlocked?: string;
  created: string;
};
export type Model = { provider: string; id: string; name?: string };
export type ApplicationDetail = Application & {
  files: { name: string; size: number; text: boolean }[];
  documents: LibraryDocument[];
  builds: Build[];
  documentStatus?: Record<"cv" | "cover", "missing" | "current" | "outdated">;
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
export type PdfCompression = "none" | "lossless" | "compact";
export type ProfileValue =
  | string
  | number
  | boolean
  | ProfileValue[]
  | { [key: string]: ProfileValue };
export type CoverLetter = {
  sender: string;
  recipient: string;
  subject: string;
  salutation: string;
  body: string;
  closing: string;
};
export type CoverLetterState = {
  prepared?: boolean;
  fields: CoverLetter;
  revision: number;
  fingerprint: string;
  requiresConversion: boolean;
  modId: string | null;
  modName?: string;
  applicantBindings?: ApplicantBindings;
};
export type JobAnalysis = {
  company: string;
  role: string;
  requirements: string[];
  text: string;
  url: string;
  capturedAt: string;
};
export type DeliveryOutput = {
  id: string;
  label: string;
  mode: "merge" | "original";
  items: PdfInput[];
  compression: PdfCompression;
};
export type DeliveryPlan = {
  revision: number;
  format: "pdf" | "zip";
  outputs: DeliveryOutput[];
};
export type DeliveryJob = {
  id: string;
  app: string;
  status: "queued" | "running" | "success" | "failed";
  created: string;
  filename: string;
  sourceRevision: number;
  outputs: { filename: string; pdfJob?: string; original?: string }[];
  error?: string;
};
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

export type CvBlock =
  | { id: string; type: "paragraph"; text: string }
  | { id: string; type: "bulletList"; items: { id: string; text: string }[] };
export type CvEntry = {
  id: string;
  included?: boolean;
  fields: Record<string, string>;
  content: CvBlock[];
};
export type CvSection = { id: string; kind: string; label: string; entries: CvEntry[] };
export type CvData = { schemaVersion: 1; person: Record<string, string>; sections: CvSection[] };
export type CvState = {
  data: CvData;
  revision: number;
  fingerprint: string;
  modId: string | null;
  paragraphsSupported: boolean;
  form?: { spec: FormSpec; values: Values };
  mod?: {
    id: string;
    name: string;
    fields: { key: string; label: string; type: "text"; required: boolean }[];
  };
  modWarning?: string;
  applicantBindings?: ApplicantBindings;
};
type ModFileChange = {
  path: string;
  status: "added" | "changed" | "removed" | "unchanged";
  originalSha256: string | null;
  modSha256: string | null;
};
export type ModProvenance = {
  versionId: string | null;
  sourceHash: string;
  sourceFingerprint: string;
  modDigest: string;
  workingSourceIntact: boolean;
  notes: string | null;
  files: ModFileChange[];
};
export type LayoutVersion = {
  importId: string;
  versionId: string;
  label: string;
  kind: "cv" | "cover";
  approvedAt: string;
  updated: string;
  available: boolean;
  signature: "none" | "optional" | "required" | null;
  error?: string;
};
export type LayoutLibrary = {
  layouts: LayoutVersion[];
  defaults: { cv: string | null; cover: string | null };
};
export type ApplicationLayouts = {
  revision: number;
  cvModId: string | null;
  coverModId: string | null;
  coverFingerprint?: string;
};
export type CvModJob = {
  id: string;
  name: string;
  label?: string;
  documentType?: "cv-template" | "cover-template";
  status:
    | "uploaded"
    | "generating"
    | "needs-input"
    | "checking"
    | "review"
    | "failed"
    | "interrupted";
  created: string;
  updated: string;
  files: string[];
  entrypoints: string[];
  selectedEntrypoint?: string;
  warnings?: string[];
  approvedVersionId?: string;
  approvedAt?: string;
  threadId?: string;
  threadUrl?: string;
  error?: string;
  versionId?: string;
  targetFormat?:
    | "bewerbung-cv-form-v2"
    | "bewerbung-cv-mod-prototype-v1"
    | "bewerbung-cover-mod-v1";
  manifest?:
    | FormSpec
    | { format: "bewerbung-cover-mod-v1"; engine: "pdflatex" | "lualatex"; entrypoint: string }
    | {
        format: "bewerbung-cv-mod-prototype-v1";
        engine: "lualatex";
        entrypoint: string;
        fields: { key: string; label: string; type: "text"; required: boolean }[];
      };
  checks: { id: string; status: "passed" | "failed" | "unsupported"; error?: string }[];
};
