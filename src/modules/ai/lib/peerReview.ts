import type { PeerTask } from "@/modules/ai/lib/peerTasks";
import { communicationDigest } from "@/modules/ai/lib/peerCommunication";
import {
  peerReviewBinding,
  type PeerReviewBinding,
} from "@/modules/ai/lib/peerHandoff";
import { native } from "@/modules/ai/lib/native";
import { checkReadable } from "@/modules/ai/lib/security";
import { resolveCurrentAgentPermission } from "@/modules/ai/lib/permissions";
import { usePeerTaskStore } from "@/modules/ai/store/peerTaskStore";

async function reviewedFile(task: PeerTask, path: string) {
  const root = (
    await native.canonicalize(task.workspaceRoot, task.workspaceEnvironment)
  )
    .replace(/\\/g, "/")
    .replace(/\/$/, "");
  const absolute = /^[a-z]:|^\//i.test(path) ? path : `${root}/${path}`;
  if (!checkReadable(absolute).ok) throw new Error("peer_review_secret_path");
  const canonical = (
    await native.canonicalize(absolute, task.workspaceEnvironment)
  ).replace(/\\/g, "/");
  const fold = (value: string) =>
    task.workspaceEnvironment.kind === "local" && /^[a-z]:/i.test(root)
      ? value.toLowerCase()
      : value;
  if (
    !fold(canonical).startsWith(`${fold(root)}/`) ||
    !checkReadable(canonical).ok
  )
    throw new Error("peer_review_path_denied");
  const context = {
    getSessionId: () => task.targetSessionId,
    getAgentId: () => task.targetAgentId,
    getCwd: () => task.workspaceRoot,
    getWorkspaceRoot: () => task.workspaceRoot,
  };
  if (
    resolveCurrentAgentPermission("read_file", { path: canonical }, context)
      .outcome !== "allow"
  )
    throw new Error("peer_review_permission_denied");
  const read = await native.readFile(canonical, task.workspaceEnvironment);
  if (read.kind !== "text" || read.size > 1024 * 1024)
    throw new Error("peer_review_file_unavailable");
  const bytes = new TextEncoder().encode(read.content);
  const contentHash = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (value) => value.toString(16).padStart(2, "0"),
  ).join("");
  return {
    path,
    hash: await communicationDigest(read.content),
    contentHash,
    size: read.size,
  };
}

export async function capturePeerReview(
  task: PeerTask,
  tasks: PeerTask[],
): Promise<PeerReviewBinding> {
  const dependencies = task.dependsOn.map((id) =>
    tasks.find((item) => item.id === id),
  );
  if (
    dependencies.some(
      (item) =>
        !item ||
        item.workspaceId !== task.workspaceId ||
        item.rootTaskId !== task.rootTaskId ||
        item.status !== "completed",
    )
  )
    throw new Error("peer_review_dependency_unavailable");
  const paths = [
    ...new Set([
      ...task.artifactRefs.flatMap((artifact) =>
        artifact.sourcePath ? [artifact.sourcePath] : [],
      ),
      ...dependencies.flatMap(
        (dependency) => dependency?.changeSet?.changedPaths ?? [],
      ),
    ]),
  ];
  if (paths.length > 32) throw new Error("peer_review_file_limit");
  const files: PeerReviewBinding["files"] = [];
  let bytes = 0;
  for (const path of paths) {
    const file = await reviewedFile(task, path);
    if (
      task.artifactRefs.some(
        (artifact) =>
          artifact.sourcePath === path &&
          ["text", "selection"].includes(artifact.contentKind) &&
          artifact.contentRef.contentHash !== file.contentHash,
      )
    )
      throw new Error(
        "peer_review_stale_artifact: The current file differs from the supplied immutable snapshot.",
      );
    bytes += file.size;
    if (bytes > 1024 * 1024) throw new Error("peer_review_byte_limit");
    files.push({ path: file.path, hash: file.hash });
  }
  const patches: PeerReviewBinding["patches"] = [];
  for (const dependency of dependencies)
    if (dependency?.changeSet)
      patches.push({
        taskId: dependency.id,
        hash: await communicationDigest({
          baseSha: dependency.changeSet.baseSha,
          patch: dependency.changeSet.patch,
          changedPaths: dependency.changeSet.changedPaths,
        }),
      });
  const results: PeerReviewBinding["results"] = [];
  for (const dependency of dependencies)
    if (dependency?.result)
      results.push({
        taskId: dependency.id,
        hash: await communicationDigest(dependency.result),
      });
  return peerReviewBinding.parse({ version: 1, files, patches, results });
}

export async function validatePeerReview(
  task: PeerTask,
  tasks = usePeerTaskStore.getState().tasks,
) {
  if (!task.review) return;
  const current = await capturePeerReview(task, tasks);
  if (
    (await communicationDigest(current)) !==
    (await communicationDigest(task.review))
  )
    throw new Error(
      "peer_review_stale: Reviewed files or patches changed. Request a new review before using these findings or applying changes.",
    );
}

export async function validatePeerApplyReview(task: PeerTask) {
  const tasks = usePeerTaskStore.getState().tasks;
  const review = tasks
    .filter(
      (item) =>
        item.kind === "review" &&
        item.dependsOn.includes(task.id) &&
        item.workspaceId === task.workspaceId &&
        item.rootTaskId === task.rootTaskId,
    )
    .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id))[0];
  if (review) {
    if (review.status !== "completed" || !review.review)
      throw new Error(
        "peer_review_incomplete: Finish or reconcile the requested review before applying.",
      );
    await validatePeerReview(review, tasks);
  }
}
