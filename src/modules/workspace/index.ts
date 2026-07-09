export {
  currentWorkspaceScopeKey,
  currentWorkspaceEnv,
  getWslHome,
  LOCAL_WORKSPACE,
  useWorkspaceEnvStore,
  workspaceScopeKey,
  type WorkspaceEnv,
  type WslDistro,
} from "./env";
export {
  loadRecentWorkspaces,
  recordRecentWorkspace,
  removeRecentWorkspace,
} from "./recent";
export { pickWorkspaceFolder } from "./picker";
export {
  findWorkspaceByRoot,
  normalizeWorkspacePath,
  workspacePathContains,
  workspaceName,
  workspacePathsEqual,
  type RecentWorkspace,
} from "./root";
