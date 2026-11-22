export type CapabilityState =
  | "Available"
  | "Ask before use"
  | "Not allowed"
  | "Unsupported by this model"
  | "Model support unverified";
const descriptions: Record<string, [string, string]> = {
  fetch_web_page: ["Research", "Retrieve a public HTTPS page with source evidence"],
  compare_web_sources: ["Research", "Retrieve and compare sourced web pages"],
  discover_capabilities: ["Research", "Find available, authorized capabilities"],
  read_file: ["Files", "Read project files"],
  list_directory: ["Files", "Browse project folders"],
  grep: ["Files", "Search project file contents"],
  glob: ["Files", "Find project files"],
  write_file: ["Files", "Create or replace files"],
  edit: ["Files", "Edit project files"],
  multi_edit: ["Files", "Edit several parts of a file"],
  create_directory: ["Files", "Create folders"],
  tf_fs_read: ["Files", "Read, inspect, list and search scoped workspace resources natively"],
  tf_fs_write: ["Files", "Create, replace, patch, rename and create directories with native approval"],
  tf_fs_delete: ["Files", "Delete a scoped file after explicit native approval"],
  tf_repo_read: ["Repository", "Inspect Git status, diffs, history, branch and refs with structured operations"],
  tf_repo_write: ["Repository", "Stage, unstage or change branches under native operation approval"],
  tf_build_run: ["Build and test", "Run a trusted, bounded TypeScript or Rust build/test adapter"],
  bash_run: ["Terminal", "Run commands"],
  bash_background: ["Terminal", "Start background commands"],
  bash_logs: ["Terminal", "Read command output"],
  bash_list: ["Terminal", "Inspect background commands"],
  bash_kill: ["Terminal", "Stop background commands"],
  request_peer_task: ["Collaboration", "Assign work to another Agent"],
  cancel_peer_task: ["Collaboration", "Cancel delegated work"],
  communicate_peer_task: ["Collaboration", "Discuss assigned work"],
  promote_peer_finding: ["Collaboration", "Propose project findings"],
  spawn_coding_agent: ["Collaboration", "Start a terminal coding Agent"],
  send_to_agent: ["Collaboration", "Send instructions to a terminal Agent"],
  read_agent_output: ["Collaboration", "Inspect terminal Agent output"],
  run_subagent: ["Collaboration", "Request a specialist review"],
  request_conversation_evidence: [
    "Context",
    "Retrieve original conversation evidence",
  ],
  get_terminal_output: ["Terminal", "Read terminal output"],
  suggest_command: ["Terminal", "Suggest a terminal command"],
  open_preview: ["Utilities", "Open a preview"],
  todo_write: ["Utilities", "Track work steps"],
  propose_custom_tool: ["External tools", "Propose an optional integration"],
};
export function capabilityGroups(
  tools: { name: string; decision: string }[],
  model: string | undefined,
  readOnly = false,
) {
  const groups = new Map<
    string,
    { name: string; label: string; state: CapabilityState }[]
  >();
  for (const tool of tools) {
    const [category, label] = descriptions[tool.name] ?? [
      "Utilities",
      tool.name.replace(/_/g, " "),
    ];
    const restricted =
      readOnly &&
      [
        "write_file",
        "edit",
        "multi_edit",
        "create_directory",
        "bash_run",
        "bash_background",
        "tf_fs_write",
        "tf_fs_delete",
        "tf_repo_write",
        "tf_build_run",
      ].includes(tool.name);
    const state: CapabilityState =
      model === "unsupported"
        ? "Unsupported by this model"
        : tool.decision === "deny" || restricted
          ? "Not allowed"
          : model !== "supported"
            ? "Model support unverified"
            : tool.decision === "prompt"
              ? "Ask before use"
              : "Available";
    const group = groups.get(category) ?? [];
    group.push({ name: tool.name, label, state });
    groups.set(category, group);
  }
  return [...groups].map(([category, entries]) => ({ category, entries }));
}
