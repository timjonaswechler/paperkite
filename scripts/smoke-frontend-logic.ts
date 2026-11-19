// Pure frontend checks: no network, servers, fixtures on disk, or model calls.
import assert from "node:assert/strict";
import type { ApplicationDetail, LibraryDocument } from "../shared/api.ts";
import {
  pdfSources,
  rehydratePdfPlan,
  validPageRange,
} from "../src/pdfComposition.ts";

const document = (id: string): LibraryDocument => ({
  id,
  name: `${id}.pdf`,
  label: id,
  mime: "application/pdf",
  bytes: 100,
  sha256: id,
  created: "2026-01-01",
  usedBy: 1,
  tags: [],
});
const app: ApplicationDetail = {
  id: "app",
  company: "Synthetic",
  role: "Example",
  status: "In Arbeit",
  posting: "",
  notes: "",
  profile: "general",
  template: null,
  revision: 7,
  created: "2026-01-01",
  updated: "2026-01-01",
  files: [],
  documents: [document("kept"), document("new")],
  harness: { provider: "pi", busy: false, pending: [] },
  builds: [
    {
      id: "cv-failed",
      app: "app",
      kind: "cv",
      status: "failed",
      revision: 7,
      finalized: 0,
      created: "2026-01-07",
    },
    {
      id: "cv-new",
      app: "app",
      kind: "cv",
      status: "success",
      revision: 6,
      finalized: 0,
      created: "2026-01-06",
    },
    {
      id: "cover-new",
      app: "app",
      kind: "cover",
      status: "success",
      revision: 5,
      finalized: 0,
      created: "2026-01-05",
    },
    {
      id: "cv-old",
      app: "app",
      kind: "cv",
      status: "success",
      revision: 3,
      finalized: 0,
      created: "2026-01-03",
    },
    {
      id: "cover-old",
      app: "app",
      kind: "cover",
      status: "success",
      revision: 2,
      finalized: 0,
      created: "2026-01-02",
    },
  ],
};
const sources = pdfSources(app.documents, app);
assert.deepEqual(
  sources.map(({ kind, id }) => [kind, id]),
  [
    ["build", "cover-new"],
    ["build", "cv-new"],
    ["document", "kept"],
    ["document", "new"],
  ],
);
const plan = rehydratePdfPlan(
  [
    { kind: "document", id: "kept", pages: "2,5" },
    { kind: "build", id: "cv-old", pages: "1-3" },
    { kind: "document", id: "deselected" },
    { kind: "build", id: "cover-old" },
    { kind: "build", id: "cv-new" },
  ],
  sources,
  app,
);
assert.deepEqual(
  plan.map(({ kind, id, pages, included }) => ({ kind, id, pages, included })),
  [
    { kind: "document", id: "kept", pages: "2,5", included: true },
    { kind: "build", id: "cv-new", pages: "1-3", included: true },
    { kind: "build", id: "cover-new", pages: undefined, included: true },
    { kind: "document", id: "new", pages: undefined, included: true },
  ],
);
assert.deepEqual(
  rehydratePdfPlan([], sources, app).map((row) => row.id),
  ["cover-new", "cv-new", "kept", "new"],
);
assert.deepEqual(
  pdfSources([document("global")]).map(({ kind, id }) => [kind, id]),
  [["document", "global"]],
);
assert.deepEqual(
  rehydratePdfPlan([], sources, app, ["build:cover", "document:kept"]).map(
    ({ id, included }) => [id, included],
  ),
  [
    ["cover-new", false],
    ["cv-new", true],
    ["kept", false],
    ["new", true],
  ],
);
for (const value of ["", "  ", "1", "1-3,5", "2, 4-6", "1-1"])
  assert.equal(validPageRange(value), true, value);
for (const value of [
  "0",
  "-1",
  "3-1",
  "1,",
  "1.5",
  "1--3",
  "all",
  "9007199254740992",
])
  assert.equal(validPageRange(value), false, value);
console.log(
  "PASS frontend PDF logic: latest successful source kinds, ordering, ranges, deselection, appended sources, deduplication, global scope",
);
