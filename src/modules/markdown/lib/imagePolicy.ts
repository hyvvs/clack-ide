export type MarkdownImageResolution =
  | { kind: "remote"; src: string }
  | { kind: "local"; path: string }
  | { kind: "blocked"; reason: string };

export type MarkdownImageRenderResolution =
  | { kind: "render"; src: string; source: "remote" }
  | { kind: "render"; src: string; source: "local"; path: string }
  | { kind: "blocked"; reason: string };

export type ResolveMarkdownImageInput = {
  src: string | null | undefined;
  markdownPath: string;
  workspaceRoot: string | null | undefined;
};

function splitSuffix(src: string): { path: string; suffix: string } {
  const match = src.match(/^([^?#]*)([?#].*)?$/);
  return {
    path: match?.[1] ?? src,
    suffix: match?.[2] ?? "",
  };
}

export function normalizeLocalPath(path: string): string {
  const raw = path.replace(/\\/g, "/");
  const drive = raw.match(/^[A-Za-z]:/);
  const absolute = raw.startsWith("/") || drive !== null;
  const prefix = drive ? `${drive[0]}/` : raw.startsWith("/") ? "/" : "";
  const body = drive ? raw.slice(drive[0].length) : raw;
  const parts: string[] = [];

  for (const part of body.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (parts.length > 0 && parts[parts.length - 1] !== "..") {
        parts.pop();
      } else if (!absolute) {
        parts.push("..");
      }
      continue;
    }
    parts.push(part);
  }

  if (!prefix) return parts.join("/");
  if (parts.length === 0) return prefix;
  return `${prefix}${parts.join("/")}`.replace(/\/+$/g, "") || prefix;
}

export function dirname(path: string): string {
  const normalized = normalizeLocalPath(path);
  const slash = normalized.lastIndexOf("/");
  if (slash <= 0) return normalized.startsWith("/") ? "/" : "";
  if (slash === 2 && /^[A-Za-z]:\//.test(normalized)) return normalized.slice(0, 3);
  return normalized.slice(0, slash);
}

export function isPathInside(child: string, root: string): boolean {
  const normalizedChild = normalizeLocalPath(child);
  const normalizedRoot = normalizeLocalPath(root);
  const comparableChild = /^[A-Za-z]:\//.test(normalizedChild)
    ? normalizedChild.toLowerCase()
    : normalizedChild;
  const comparableRoot = /^[A-Za-z]:\//.test(normalizedRoot)
    ? normalizedRoot.toLowerCase()
    : normalizedRoot;
  return (
    comparableChild === comparableRoot ||
    comparableChild.startsWith(`${comparableRoot.replace(/\/+$/g, "")}/`)
  );
}

export function resolveMarkdownImageSrc({
  src,
  markdownPath,
  workspaceRoot,
}: ResolveMarkdownImageInput): MarkdownImageResolution {
  const trimmed = src?.trim();
  if (!trimmed) return { kind: "blocked", reason: "empty image source" };

  if (/^[A-Za-z]:[\\/]/.test(trimmed)) {
    return resolveLocal(trimmed, markdownPath, workspaceRoot);
  }

  const protocol = trimmed.match(/^([A-Za-z][A-Za-z\d+.-]*):/);
  if (protocol) {
    const name = protocol[1].toLowerCase();
    if (name === "http" || name === "https") {
      return { kind: "remote", src: trimmed };
    }
    return { kind: "blocked", reason: `unsupported protocol: ${name}` };
  }

  return resolveLocal(trimmed, markdownPath, workspaceRoot);
}

export function resolveMarkdownImageRenderSrc(
  input: ResolveMarkdownImageInput,
  toAssetUrl: (path: string) => string,
): MarkdownImageRenderResolution {
  const resolved = resolveMarkdownImageSrc(input);
  if (resolved.kind === "remote") {
    return { kind: "render", source: "remote", src: resolved.src };
  }
  if (resolved.kind === "blocked") return resolved;

  const trimmed = input.src?.trim() ?? "";
  const { suffix } = splitSuffix(trimmed);
  return {
    kind: "render",
    source: "local",
    path: resolved.path,
    src: `${toAssetUrl(resolved.path)}${suffix}`,
  };
}

export function isConvertedLocalAssetUrl(src: string): boolean {
  const trimmed = src.trim().toLowerCase();
  return (
    trimmed.startsWith("asset://localhost/") ||
    trimmed.startsWith("http://asset.localhost/") ||
    trimmed.startsWith("https://asset.localhost/")
  );
}

function decodeLocalPath(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

function resolveLocal(
  src: string,
  markdownPath: string,
  workspaceRoot: string | null | undefined,
): MarkdownImageResolution {
  if (!workspaceRoot) {
    return { kind: "blocked", reason: "no workspace root available" };
  }

  const root = normalizeLocalPath(workspaceRoot);
  const { path: withoutSuffix } = splitSuffix(src);
  const decoded = decodeLocalPath(withoutSuffix);
  const candidate = /^[A-Za-z]:[\\/]/.test(decoded)
    ? normalizeLocalPath(decoded)
    : decoded.startsWith("/")
      ? normalizeLocalPath(`${root}/${decoded.slice(1)}`)
      : normalizeLocalPath(`${dirname(markdownPath)}/${decoded}`);

  if (!isPathInside(candidate, root)) {
    return { kind: "blocked", reason: "image path is outside the workspace" };
  }

  return { kind: "local", path: candidate };
}
