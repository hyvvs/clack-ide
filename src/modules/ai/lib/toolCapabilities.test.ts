import { describe, expect, it } from "vitest";
import { capabilityGroups } from "./toolCapabilities";

describe("Tool Fabric native capability UI grouping", () => {
  const tools = [
    { name: "tf_fs_read", decision: "allow" },
    { name: "tf_fs_write", decision: "prompt" },
    { name: "tf_fs_delete", decision: "prompt" },
    { name: "tf_repo_read", decision: "allow" },
    { name: "tf_repo_write", decision: "prompt" },
    { name: "tf_build_run", decision: "prompt" },
  ];

  it("shows scoped native filesystem, repository and build actions in existing categories", () => {
    const groups = capabilityGroups(tools, "supported");
    expect(groups.find((group) => group.category === "Files")?.entries.map((item) => item.name))
      .toEqual(["tf_fs_read", "tf_fs_write", "tf_fs_delete"]);
    expect(groups.find((group) => group.category === "Repository")?.entries.map((item) => item.name))
      .toEqual(["tf_repo_read", "tf_repo_write"]);
    expect(groups.find((group) => group.category === "Build and test")?.entries[0])
      .toMatchObject({ name: "tf_build_run", state: "Ask before use" });
  });

  it("keeps native reads visible but denies effectful tools in read-only task mode", () => {
    const groups = capabilityGroups(tools, "supported", true);
    const entries = groups.flatMap((group) => group.entries);
    for (const name of ["tf_fs_read", "tf_repo_read"])
      expect(entries.find((item) => item.name === name)?.state).toBe("Available");
    for (const name of ["tf_fs_write", "tf_fs_delete", "tf_repo_write", "tf_build_run"])
      expect(entries.find((item) => item.name === name)?.state).toBe("Not allowed");
  });

  it("treats model support as exposure eligibility, never a native approval grant", () => {
    const groups = capabilityGroups(tools, "unsupported");
    expect(groups.flatMap((group) => group.entries).every((item) => item.state === "Unsupported by this model"))
      .toBe(true);
  });
  it("shows native web research separately, with no Chat Only or read-only task bypass", () => {
    const network = [
      {name:"tf_web_search",decision:"prompt"},
      {name:"tf_http_fetch",decision:"prompt"},
      {name:"tf_http_head",decision:"deny"},
    ];
    const shown = capabilityGroups(network,"supported");
    expect(shown.find(group=>group.category==="Web research")?.entries.map(row=>row.state))
      .toEqual(["Ask before use","Ask before use","Not allowed"]);
    const restricted=capabilityGroups(network,"supported",true);
    expect(restricted.flatMap(group=>group.entries).every(row=>row.state==="Not allowed"))
      .toBe(true);
  });
});
