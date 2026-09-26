import { describe, expect, it, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  applyFreshness,
  freshnessTargets,
  projectDependencies,
  projectMemoryClient,
  type ProjectEntry,
  type ProjectMemoryView,
} from "@/modules/ai/lib/projectMemory";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@/modules/ai/lib/sessions", () => ({
  awaitSessionWrites: vi.fn(async () => {}),
}));
beforeEach(() => vi.clearAllMocks());
const entry = (id: string, freshness = "needs-revalidation"): ProjectEntry => ({
  id,
  freshness,
  section: "architecture",
  text: "Explicit claim",
  qualification: "user-correction",
  status: "approved",
  sourceState: "historical-source-verified",
  sourceSessionId: "a",
  locator: { kind: "part", messageId: "m", partIndex: 0 },
  sliceHash: "hash",
  start: 0,
  end: 3,
  authorAgent: "coder",
  supersedes: null,
  conflicts: [],
  updatedAt: 1,
  knowledge: {
    verifiedBy: "a",
    verifiedAt: 1,
    revision: 2,
    records: [],
    dependencies: [
      {
        path: "src/x.ts",
        canonical: "C:/work/src/x.ts",
        contentHash: "hash",
        sliceHash: "slice",
        end: 3,
        environment: false,
      },
    ],
  },
});
const view = (entries: ProjectEntry[]): ProjectMemoryView => ({
  workspace: "local:/work",
  checkout: "local:/work",
  baseSha: null,
  revision: 2,
  entries,
});

describe("M2 evidence client", () => {
  it("keeps code and test environment dependencies explicit", () => {
    expect(
      projectDependencies("src/auth.ts\r\nREADME.md", "package-lock.json"),
    ).toEqual([
      { path: "src/auth.ts", environment: false },
      { path: "README.md", environment: false },
      { path: "package-lock.json", environment: true },
    ]);
  });
  it.each([
    "",
    "a\na",
    Array.from({ length: 9 }, (_, i) => `f${i}`).join("\n"),
  ])("rejects empty, duplicate and unbounded dependency input", (paths) => {
    expect(() => projectDependencies(paths, "")).toThrow();
  });
  it("rechecks only dirty records during event-driven refresh", () => {
    expect(
      freshnessTargets(
        view([
          entry("a", "current"),
          entry("b", "potentially-stale"),
          entry("c", "invalidated"),
        ]),
        false,
      ),
    ).toEqual(["b"]);
  });
  it("forces at-use checks after reopening, even if events were missed", () => {
    expect(freshnessTargets(view([entry("a", "current")]), true)).toEqual([
      "a",
    ]);
  });
  it("bounds automatic work to eight records and excludes private proposals", () => {
    const entries = Array.from({ length: 20 }, (_, i) => entry(`${i}`));
    entries[0].status = "pending";
    expect(freshnessTargets(view(entries), true)).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
    ]);
  });
  it("rejects late revision responses without changing claims", () => {
    const original = view([entry("a")]);
    expect(() =>
      applyFreshness(original, {
        revision: 1,
        entries: [],
        reads: 0,
        bytes: 0,
      }),
    ).toThrow();
    expect(original.entries[0].text).toBe("Explicit claim");
  });
  it("applies freshness without replacing source provenance or user text", () => {
    const original = view([entry("a"), entry("b")]);
    const next = applyFreshness(original, {
      revision: 2,
      entries: [
        {
          id: "a",
          freshness: "invalidated",
          sourceState: "historical-source-verified",
          evidence: [],
        },
      ],
      reads: 2,
      bytes: 10,
    });
    expect(next.entries[0]).toEqual({
      ...original.entries[0],
      freshness: "invalidated",
    });
    expect(next.entries[1]).toBe(original.entries[1]);
  });
  it("cannot supply a consent boolean or redirect native workspace ownership", async () => {
    await projectMemoryClient("a").verify(view([]), "record", "src/x.ts", "", [
      "requirement",
    ]);
    expect(invoke).toHaveBeenCalledExactlyOnceWith("project_memory_verify", {
      sessionId: "a",
      expectedRevision: 2,
      id: "record",
      dependencies: [{ path: "src/x.ts", environment: false }],
      dependsOn: ["requirement"],
    });
  });
  it("uses bounded record IDs without invoking models or transcript retrieval", async () => {
    await projectMemoryClient("b").revalidate(view([]), ["record"]);
    expect(invoke).toHaveBeenCalledExactlyOnceWith(
      "project_memory_revalidate",
      { sessionId: "b", expectedRevision: 2, ids: ["record"] },
    );
  });
});
