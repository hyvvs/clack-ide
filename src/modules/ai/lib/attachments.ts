import { invoke } from "@tauri-apps/api/core";
import { currentWorkspaceEnv } from "@/modules/workspace";
import {
  type AttachmentContentRef,
  releaseAttachmentContent,
  retainAttachmentContent,
  storeAttachmentContent,
} from "./attachmentStore";
import { checkReadable, checkReadableCanonical } from "./security";

const MIB = 1024 * 1024;

export const ATTACHMENT_LIMITS = {
  maxCount: 8,
  maxIndividualBytes: 8 * MIB,
  maxTextBytes: 1 * MIB,
  maxImageBytes: 8 * MIB,
  maxAggregateBytes: 20 * MIB,
  maxDecodedImageBytes: 64 * MIB,
} as const;

export const ACCEPTED_ATTACHMENT_FILES =
  "image/png,image/jpeg,image/webp,image/gif,image/svg+xml,application/pdf,application/zip,.pdf,.zip,.txt,.md,.markdown,.json,.yaml,.yml,.toml,.sh,.zsh,.bash,.ps1,.py,.js,.jsx,.ts,.tsx,.rs,.go,.java,.c,.cc,.cpp,.h,.hpp,.html,.css,.scss,.csv,.log,.config,.conf,.ini,.xml,.sql,Dockerfile,.dockerfile,Makefile";

export type AttachmentContentKind =
  | "text"
  | "image"
  | "selection"
  | "document"
  | "archive"
  | "binary";

export type AttachmentProcessingState =
  | "processing"
  | "ready"
  | "failed"
  | "unsupported";

export type AttachmentSource =
  | { kind: "picker"; token: string }
  | { kind: "workspace-path"; path: string; canonicalPath?: string }
  | {
      kind: "archive-entry";
      archiveAttachmentId: string;
      archiveDisplayName: string;
      entryIndex: number;
      path: string;
    }
  | { kind: "selection"; surface: "terminal" | "editor" };

export type AttachmentSecurityResult = {
  secretPathCheck: "passed" | "rejected" | "not-applicable";
  workspaceScopeCheck: "passed" | "rejected" | "not-applicable";
  mimeSniffed: boolean;
};

export type AttachmentError = {
  code: string;
  message: string;
};

export type DocumentPageRepresentation = {
  pageNumber: number;
  textBytes: number;
  truncated: boolean;
  error?: string;
};

export type DocumentRepresentation = {
  pageCount: number;
  extractedTextBytes: number;
  truncated: boolean;
  pages: DocumentPageRepresentation[];
  textContentRef?: AttachmentContentRef;
};

export type ArchiveManifestEntry = {
  index: number;
  path: string;
  entryType: "file" | "folder";
  compressedSize: number;
  expandedSize: number;
  mediaType?: string;
  status: "ready" | "blocked";
  selectable: boolean;
  reason?: string;
};

export type ArchiveRepresentation = {
  format: "zip";
  entryCount: number;
  fileCount: number;
  folderCount: number;
  totalCompressedBytes: number;
  totalExpandedBytes: number;
  nestedArchiveDepthLimit: number;
  manifestContentRef: AttachmentContentRef;
  entries?: ArchiveManifestEntry[];
};

export type AttachmentRecord = {
  id: string;
  source: AttachmentSource;
  displayName: string;
  detectedMediaType: string;
  byteSize: number;
  contentKind: AttachmentContentKind;
  processingState: AttachmentProcessingState;
  contentRef?: AttachmentContentRef;
  textRepresentation?: string;
  imageRepresentation?: string;
  documentRepresentation?: DocumentRepresentation;
  archiveRepresentation?: ArchiveRepresentation;
  error?: AttachmentError;
  security: AttachmentSecurityResult;
  createdAt: number;
};

export type AttachmentBatchResult = {
  records: AttachmentRecord[];
  rejected: Array<{ displayName: string; message: string }>;
};

type DetectedAttachment = {
  contentKind: AttachmentContentKind;
  mediaType: string;
  imageDimensions?: { width: number; height: number };
};

type NormalizeOptions = {
  id?: string;
  createdAt?: number;
  dataUrl?: (blob: Blob) => Promise<string>;
};

type WorkspaceAttachmentDeps = {
  canonicalize: (path: string) => Promise<string>;
  readBytes: (
    path: string,
    workspaceRoot: string,
  ) => Promise<ArrayBuffer | Uint8Array>;
  persistContent?: (bytes: Uint8Array) => Promise<AttachmentContentRef>;
};

const TEXT_MIME_BY_EXTENSION: Record<string, string> = {
  txt: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
  json: "application/json",
  yaml: "application/yaml",
  yml: "application/yaml",
  toml: "application/toml",
  csv: "text/csv",
  html: "text/html",
  css: "text/css",
  scss: "text/x-scss",
  xml: "application/xml",
  js: "text/javascript",
  jsx: "text/jsx",
  ts: "text/typescript",
  tsx: "text/tsx",
  py: "text/x-python",
  rs: "text/x-rust",
  go: "text/x-go",
  java: "text/x-java-source",
  c: "text/x-c",
  cc: "text/x-c++",
  cpp: "text/x-c++",
  h: "text/x-c",
  hpp: "text/x-c++",
  sh: "text/x-shellscript",
  bash: "text/x-shellscript",
  zsh: "text/x-shellscript",
  ps1: "text/x-powershell",
  sql: "application/sql",
  log: "text/plain",
  config: "text/plain",
  conf: "text/plain",
  ini: "text/plain",
};

const TEXT_BASENAMES = new Set(["dockerfile", "makefile"]);

function newAttachmentId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `attachment-${crypto.randomUUID()}`;
  }
  return `attachment-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function pickerDisplayName(file: File): string {
  const name = file.name.trim();
  if (name) return name;
  if (file.type === "image/jpeg") return "Pasted image.jpg";
  if (file.type === "image/webp") return "Pasted image.webp";
  if (file.type === "image/gif") return "Pasted image.gif";
  if (file.type === "image/svg+xml") return "Pasted image.svg";
  return "Pasted image.png";
}

function pickerToken(
  file: File,
  displayName = pickerDisplayName(file),
): string {
  return `${displayName}:${file.size}:${file.lastModified}`;
}

export function createPendingPickerAttachment(file: File): AttachmentRecord {
  const displayName = pickerDisplayName(file);
  return {
    id: newAttachmentId(),
    source: { kind: "picker", token: pickerToken(file, displayName) },
    displayName,
    detectedMediaType: file.type || "application/octet-stream",
    byteSize: file.size,
    contentKind: "binary",
    processingState: "processing",
    security: {
      secretPathCheck: "not-applicable",
      workspaceScopeCheck: "not-applicable",
      mimeSniffed: false,
    },
    createdAt: Date.now(),
  };
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

function extension(name: string): string {
  const base = basename(name);
  const index = base.lastIndexOf(".");
  return index > 0 ? base.slice(index + 1).toLowerCase() : "";
}

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.slice(start, start + length));
}

function u16be(bytes: Uint8Array, offset: number): number {
  return bytes[offset] * 256 + bytes[offset + 1];
}

function u16le(bytes: Uint8Array, offset: number): number {
  return bytes[offset] + bytes[offset + 1] * 256;
}

function u24le(bytes: Uint8Array, offset: number): number {
  return bytes[offset] + bytes[offset + 1] * 256 + bytes[offset + 2] * 65_536;
}

function u32be(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] * 16_777_216 +
    bytes[offset + 1] * 65_536 +
    bytes[offset + 2] * 256 +
    bytes[offset + 3]
  );
}

function jpegDimensions(
  bytes: Uint8Array,
): { width: number; height: number } | undefined {
  const frameMarkers = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce,
    0xcf,
  ]);
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (offset + 2 > bytes.length) return undefined;
    const length = u16be(bytes, offset);
    if (length < 2 || offset + length > bytes.length) return undefined;
    if (frameMarkers.has(marker) && length >= 7) {
      return {
        height: u16be(bytes, offset + 3),
        width: u16be(bytes, offset + 5),
      };
    }
    offset += length;
  }
  return undefined;
}

function webpDimensions(
  bytes: Uint8Array,
): { width: number; height: number } | undefined {
  if (bytes.length < 30) return undefined;
  const chunk = ascii(bytes, 12, 4);
  if (chunk === "VP8X") {
    return {
      width: u24le(bytes, 24) + 1,
      height: u24le(bytes, 27) + 1,
    };
  }
  if (chunk === "VP8 " && ascii(bytes, 23, 3) === "\u009d\u0001\u002a") {
    return {
      width: u16le(bytes, 26) & 0x3fff,
      height: u16le(bytes, 28) & 0x3fff,
    };
  }
  if (chunk === "VP8L" && bytes[20] === 0x2f) {
    const bits =
      bytes[21] + bytes[22] * 256 + bytes[23] * 65_536 + bytes[24] * 16_777_216;
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
    };
  }
  return undefined;
}

function imageDimensions(
  bytes: Uint8Array,
  mediaType: string,
): { width: number; height: number } | undefined {
  if (mediaType === "image/png" && bytes.length >= 24) {
    return { width: u32be(bytes, 16), height: u32be(bytes, 20) };
  }
  if (mediaType === "image/gif" && bytes.length >= 10) {
    return { width: u16le(bytes, 6), height: u16le(bytes, 8) };
  }
  if (mediaType === "image/jpeg") return jpegDimensions(bytes);
  if (mediaType === "image/webp") return webpDimensions(bytes);
  return undefined;
}

function looksLikeSvg(bytes: Uint8Array): boolean {
  if (bytes.length === 0 || bytes.slice(0, 8_192).includes(0)) return false;
  const prefix = new TextDecoder("utf-8").decode(bytes.slice(0, 8_192));
  return /^(?:\uFEFF|\s|<\?xml[^>]*\?>|<!--[\s\S]*?-->)*<svg(?:\s|>)/i.test(
    prefix,
  );
}

function validImageDimensions(dimensions: {
  width: number;
  height: number;
}): boolean {
  if (dimensions.width <= 0 || dimensions.height <= 0) return false;
  const maxPixels = ATTACHMENT_LIMITS.maxDecodedImageBytes / 4;
  return dimensions.width <= maxPixels / dimensions.height;
}

export function detectAttachment(
  bytes: Uint8Array,
  name: string,
  reportedMediaType = "",
): DetectedAttachment {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return {
      contentKind: "image",
      mediaType: "image/png",
      imageDimensions: imageDimensions(bytes, "image/png"),
    };
  }
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return {
      contentKind: "image",
      mediaType: "image/jpeg",
      imageDimensions: imageDimensions(bytes, "image/jpeg"),
    };
  }
  if (ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a") {
    return {
      contentKind: "image",
      mediaType: "image/gif",
      imageDimensions: imageDimensions(bytes, "image/gif"),
    };
  }
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
    return {
      contentKind: "image",
      mediaType: "image/webp",
      imageDimensions: imageDimensions(bytes, "image/webp"),
    };
  }
  if (looksLikeSvg(bytes)) {
    return { contentKind: "image", mediaType: "image/svg+xml" };
  }
  if (ascii(bytes, 0, 5) === "%PDF-") {
    return { contentKind: "document", mediaType: "application/pdf" };
  }
  if (
    startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) ||
    startsWith(bytes, [0x50, 0x4b, 0x05, 0x06]) ||
    startsWith(bytes, [0x50, 0x4b, 0x07, 0x08])
  ) {
    return { contentKind: "archive", mediaType: "application/zip" };
  }
  if (startsWith(bytes, [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07])) {
    return { contentKind: "archive", mediaType: "application/vnd.rar" };
  }
  if (startsWith(bytes, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) {
    return { contentKind: "archive", mediaType: "application/x-7z-compressed" };
  }
  if (startsWith(bytes, [0x4d, 0x5a])) {
    return {
      contentKind: "binary",
      mediaType: "application/vnd.microsoft.portable-executable",
    };
  }
  if (startsWith(bytes, [0x7f, 0x45, 0x4c, 0x46])) {
    return { contentKind: "binary", mediaType: "application/x-elf" };
  }

  const ext = extension(name);
  const knownText = TEXT_MIME_BY_EXTENSION[ext];
  const knownTextBasename = TEXT_BASENAMES.has(basename(name).toLowerCase());
  if (knownText || knownTextBasename || reportedMediaType.startsWith("text/")) {
    return {
      contentKind: "text",
      mediaType:
        knownText ||
        (reportedMediaType.startsWith("text/")
          ? reportedMediaType
          : "text/plain"),
    };
  }
  return { contentKind: "binary", mediaType: "application/octet-stream" };
}

function failureRecord(input: {
  source: AttachmentSource;
  displayName: string;
  byteSize: number;
  contentKind?: AttachmentContentKind;
  mediaType?: string;
  state?: "failed" | "unsupported";
  code: string;
  message: string;
  security: AttachmentSecurityResult;
  options?: NormalizeOptions;
}): AttachmentRecord {
  return {
    id: input.options?.id ?? newAttachmentId(),
    source: input.source,
    displayName: input.displayName,
    detectedMediaType: input.mediaType ?? "application/octet-stream",
    byteSize: input.byteSize,
    contentKind: input.contentKind ?? "binary",
    processingState: input.state ?? "failed",
    error: { code: input.code, message: input.message },
    security: input.security,
    createdAt: input.options?.createdAt ?? Date.now(),
  };
}

function strictText(bytes: Uint8Array): string | null {
  if (bytes.slice(0, 8_192).includes(0)) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function defaultDataUrl(blob: Blob): Promise<string> {
  if (typeof URL.createObjectURL !== "function") {
    return Promise.reject(new Error("Image previews are unavailable."));
  }
  return Promise.resolve(URL.createObjectURL(blob));
}

export async function persistAttachmentRecord(
  record: AttachmentRecord,
  bytes: Uint8Array,
  persistContent = storeAttachmentContent,
): Promise<AttachmentRecord> {
  if (record.processingState !== "ready") return record;
  let persisted: AttachmentRecord;
  try {
    const contentRef = await persistContent(bytes);
    retainAttachmentContent(contentRef.id);
    persisted = {
      ...record,
      contentRef,
      ...(record.contentKind === "text" || record.contentKind === "selection"
        ? { textRepresentation: undefined }
        : {}),
    };
  } catch (error) {
    releaseAttachmentPreview(record);
    return {
      ...record,
      processingState: "failed",
      contentRef: undefined,
      textRepresentation: undefined,
      imageRepresentation: undefined,
      error: {
        code: "attachment_persistence_failed",
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
  if (persisted.contentKind === "document") {
    const { processPdfAttachment } = await import("./pdfAttachments");
    return processPdfAttachment(persisted, bytes);
  }
  if (
    persisted.contentKind === "archive" &&
    persisted.detectedMediaType === "application/zip"
  ) {
    const { processZipAttachment } = await import("./archiveAttachments");
    return processZipAttachment(persisted, bytes);
  }
  return persisted;
}

export function releaseAttachmentPreview(record: AttachmentRecord): void {
  if (
    record.imageRepresentation?.startsWith("blob:") &&
    typeof URL.revokeObjectURL === "function"
  ) {
    URL.revokeObjectURL(record.imageRepresentation);
  }
}

export function releaseAttachmentRecordContent(record: AttachmentRecord): void {
  if (record.contentRef) releaseAttachmentContent(record.contentRef.id);
  const extracted = record.documentRepresentation?.textContentRef;
  if (extracted && extracted.id !== record.contentRef?.id) {
    releaseAttachmentContent(extracted.id);
  }
  const manifest = record.archiveRepresentation?.manifestContentRef;
  if (
    manifest &&
    manifest.id !== record.contentRef?.id &&
    manifest.id !== extracted?.id
  ) {
    releaseAttachmentContent(manifest.id);
  }
}

export async function normalizeAttachmentBytes(input: {
  source: AttachmentSource;
  displayName: string;
  bytes: Uint8Array;
  reportedMediaType?: string;
  security: AttachmentSecurityResult;
  options?: NormalizeOptions;
}): Promise<AttachmentRecord> {
  const { bytes, displayName, source, security, options } = input;
  if (bytes.byteLength > ATTACHMENT_LIMITS.maxIndividualBytes) {
    return failureRecord({
      source,
      displayName,
      byteSize: bytes.byteLength,
      code: "attachment_too_large",
      message: `Files must be ${formatBytes(ATTACHMENT_LIMITS.maxIndividualBytes)} or smaller.`,
      security,
      options,
    });
  }

  const detected = detectAttachment(
    bytes,
    displayName,
    input.reportedMediaType,
  );
  if (detected.contentKind === "document") {
    return {
      id: options?.id ?? newAttachmentId(),
      source,
      displayName,
      detectedMediaType: detected.mediaType,
      byteSize: bytes.byteLength,
      contentKind: "document",
      processingState: "ready",
      security,
      createdAt: options?.createdAt ?? Date.now(),
    };
  }
  if (detected.contentKind === "archive") {
    if (detected.mediaType === "application/zip") {
      return {
        id: options?.id ?? newAttachmentId(),
        source,
        displayName,
        detectedMediaType: detected.mediaType,
        byteSize: bytes.byteLength,
        contentKind: "archive",
        processingState: "ready",
        security,
        createdAt: options?.createdAt ?? Date.now(),
      };
    }
    return failureRecord({
      source,
      displayName,
      byteSize: bytes.byteLength,
      contentKind: "archive",
      mediaType: detected.mediaType,
      state: "unsupported",
      code: "archive_not_supported",
      message: "RAR and 7z inspection are not available yet.",
      security,
      options,
    });
  }
  if (detected.contentKind === "binary") {
    return failureRecord({
      source,
      displayName,
      byteSize: bytes.byteLength,
      mediaType: detected.mediaType,
      state: "unsupported",
      code: "binary_not_supported",
      message: "Clack cannot inspect this file type yet.",
      security,
      options,
    });
  }
  if (detected.contentKind === "text") {
    if (bytes.byteLength > ATTACHMENT_LIMITS.maxTextBytes) {
      return failureRecord({
        source,
        displayName,
        byteSize: bytes.byteLength,
        contentKind: "text",
        mediaType: detected.mediaType,
        code: "text_attachment_too_large",
        message: `Text attachments must be ${formatBytes(ATTACHMENT_LIMITS.maxTextBytes)} or smaller.`,
        security,
        options,
      });
    }
    const text = strictText(bytes);
    if (text === null) {
      return failureRecord({
        source,
        displayName,
        byteSize: bytes.byteLength,
        contentKind: "binary",
        mediaType: "application/octet-stream",
        state: "unsupported",
        code: "invalid_text_encoding",
        message: "This file is not valid UTF-8 text.",
        security,
        options,
      });
    }
    return {
      id: options?.id ?? newAttachmentId(),
      source,
      displayName,
      detectedMediaType: detected.mediaType,
      byteSize: bytes.byteLength,
      contentKind: "text",
      processingState: "ready",
      textRepresentation: text,
      security,
      createdAt: options?.createdAt ?? Date.now(),
    };
  }

  if (bytes.byteLength > ATTACHMENT_LIMITS.maxImageBytes) {
    return failureRecord({
      source,
      displayName,
      byteSize: bytes.byteLength,
      contentKind: "image",
      mediaType: detected.mediaType,
      code: "image_attachment_too_large",
      message: `Images must be ${formatBytes(ATTACHMENT_LIMITS.maxImageBytes)} or smaller.`,
      security,
      options,
    });
  }
  if (detected.mediaType === "image/svg+xml") {
    if (bytes.byteLength > ATTACHMENT_LIMITS.maxTextBytes) {
      return failureRecord({
        source,
        displayName,
        byteSize: bytes.byteLength,
        contentKind: "image",
        mediaType: detected.mediaType,
        code: "svg_attachment_too_large",
        message: `SVG attachments must be ${formatBytes(ATTACHMENT_LIMITS.maxTextBytes)} or smaller.`,
        security,
        options,
      });
    }
    if (strictText(bytes) === null) {
      return failureRecord({
        source,
        displayName,
        byteSize: bytes.byteLength,
        contentKind: "image",
        mediaType: detected.mediaType,
        state: "unsupported",
        code: "invalid_svg_encoding",
        message: "SVG attachments must contain valid UTF-8 source.",
        security,
        options,
      });
    }
    return {
      id: options?.id ?? newAttachmentId(),
      source,
      displayName,
      detectedMediaType: detected.mediaType,
      byteSize: bytes.byteLength,
      contentKind: "image",
      processingState: "ready",
      security,
      createdAt: options?.createdAt ?? Date.now(),
    };
  }
  if (
    !detected.imageDimensions ||
    !validImageDimensions(detected.imageDimensions)
  ) {
    return failureRecord({
      source,
      displayName,
      byteSize: bytes.byteLength,
      contentKind: "image",
      mediaType: detected.mediaType,
      code: "image_dimensions_unsafe",
      message: `Image dimensions are malformed or exceed the ${formatBytes(ATTACHMENT_LIMITS.maxDecodedImageBytes)} decoded-image budget.`,
      security,
      options,
    });
  }
  try {
    const ownedBytes = Uint8Array.from(bytes);
    const dataUrl = await (options?.dataUrl ?? defaultDataUrl)(
      new Blob([ownedBytes.buffer], { type: detected.mediaType }),
    );
    return {
      id: options?.id ?? newAttachmentId(),
      source,
      displayName,
      detectedMediaType: detected.mediaType,
      byteSize: bytes.byteLength,
      contentKind: "image",
      processingState: "ready",
      imageRepresentation: dataUrl,
      security,
      createdAt: options?.createdAt ?? Date.now(),
    };
  } catch (error) {
    return failureRecord({
      source,
      displayName,
      byteSize: bytes.byteLength,
      contentKind: "image",
      mediaType: detected.mediaType,
      code: "attachment_read_failed",
      message: error instanceof Error ? error.message : String(error),
      security,
      options,
    });
  }
}

export async function normalizePickerAttachment(
  file: File,
  options?: Pick<NormalizeOptions, "id" | "createdAt">,
): Promise<AttachmentRecord> {
  const displayName = pickerDisplayName(file);
  const source: AttachmentSource = {
    kind: "picker",
    token: pickerToken(file, displayName),
  };
  const nameSafety = checkReadable(displayName);
  if (!nameSafety.ok) {
    return failureRecord({
      source,
      displayName,
      byteSize: file.size,
      code: "secret_path_rejected",
      message: nameSafety.reason,
      security: {
        secretPathCheck: "rejected",
        workspaceScopeCheck: "not-applicable",
        mimeSniffed: false,
      },
      options,
    });
  }
  if (file.size > ATTACHMENT_LIMITS.maxIndividualBytes) {
    return failureRecord({
      source,
      displayName,
      byteSize: file.size,
      code: "attachment_too_large",
      message: `Files must be ${formatBytes(ATTACHMENT_LIMITS.maxIndividualBytes)} or smaller.`,
      security: {
        secretPathCheck: "passed",
        workspaceScopeCheck: "not-applicable",
        mimeSniffed: false,
      },
      options,
    });
  }
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const normalized = await normalizeAttachmentBytes({
      source,
      displayName,
      bytes,
      reportedMediaType: file.type,
      security: {
        secretPathCheck: "passed",
        workspaceScopeCheck: "not-applicable",
        mimeSniffed: true,
      },
      options,
    });
    return persistAttachmentRecord(normalized, bytes);
  } catch (error) {
    return failureRecord({
      source,
      displayName,
      byteSize: file.size,
      code: "attachment_read_failed",
      message: error instanceof Error ? error.message : String(error),
      security: {
        secretPathCheck: "passed",
        workspaceScopeCheck: "not-applicable",
        mimeSniffed: false,
      },
      options,
    });
  }
}

function rawBytes(value: ArrayBuffer | Uint8Array): Uint8Array {
  return value instanceof Uint8Array ? value : new Uint8Array(value);
}

export async function normalizeWorkspaceAttachment(
  path: string,
  workspaceRoot: string | null,
  deps?: WorkspaceAttachmentDeps,
): Promise<AttachmentRecord> {
  const displayName = basename(path);
  const source: AttachmentSource = { kind: "workspace-path", path };
  if (!workspaceRoot) {
    return failureRecord({
      source,
      displayName,
      byteSize: 0,
      code: "workspace_required",
      message: "Open a workspace before attaching a workspace file.",
      security: {
        secretPathCheck: "not-applicable",
        workspaceScopeCheck: "rejected",
        mimeSniffed: false,
      },
    });
  }
  const workspace = currentWorkspaceEnv();
  const activeDeps: WorkspaceAttachmentDeps = deps ?? {
    canonicalize: (candidate) =>
      invoke<string>("fs_canonicalize", { path: candidate, workspace }),
    readBytes: (candidate, root) =>
      invoke<ArrayBuffer>("fs_read_attachment", {
        path: candidate,
        workspaceRoot: root,
        workspace,
        maxBytes: ATTACHMENT_LIMITS.maxIndividualBytes,
      }),
    persistContent: storeAttachmentContent,
  };
  const safety = await checkReadableCanonical(path, activeDeps.canonicalize);
  if (!safety.ok) {
    return failureRecord({
      source,
      displayName,
      byteSize: 0,
      code: "secret_path_rejected",
      message: safety.reason,
      security: {
        secretPathCheck: "rejected",
        workspaceScopeCheck: "not-applicable",
        mimeSniffed: false,
      },
    });
  }
  const canonicalSource: AttachmentSource = {
    kind: "workspace-path",
    path,
    canonicalPath: safety.canonical,
  };
  try {
    const response = await activeDeps.readBytes(
      safety.canonical,
      workspaceRoot,
    );
    const bytes = rawBytes(response);
    const normalized = await normalizeAttachmentBytes({
      source: canonicalSource,
      displayName,
      bytes,
      security: {
        secretPathCheck: "passed",
        workspaceScopeCheck: "passed",
        mimeSniffed: true,
      },
    });
    return persistAttachmentRecord(
      normalized,
      bytes,
      activeDeps.persistContent,
    );
  } catch (error) {
    return failureRecord({
      source: canonicalSource,
      displayName,
      byteSize: 0,
      code: "workspace_attachment_read_failed",
      message: error instanceof Error ? error.message : String(error),
      security: {
        secretPathCheck: "passed",
        workspaceScopeCheck: "rejected",
        mimeSniffed: false,
      },
    });
  }
}

export function createSelectionAttachment(input: {
  id: string;
  text: string;
  surface: "terminal" | "editor";
}): AttachmentRecord {
  const bytes = new TextEncoder().encode(input.text);
  if (bytes.byteLength > ATTACHMENT_LIMITS.maxTextBytes) {
    return failureRecord({
      source: { kind: "selection", surface: input.surface },
      displayName:
        input.surface === "editor" ? "Editor selection" : "Terminal selection",
      byteSize: bytes.byteLength,
      contentKind: "selection",
      mediaType: "text/plain",
      code: "selection_too_large",
      message: `Selections must be ${formatBytes(ATTACHMENT_LIMITS.maxTextBytes)} or smaller.`,
      security: {
        secretPathCheck: "not-applicable",
        workspaceScopeCheck: "not-applicable",
        mimeSniffed: true,
      },
      options: { id: input.id },
    });
  }
  return {
    id: input.id,
    source: { kind: "selection", surface: input.surface },
    displayName:
      input.surface === "editor" ? "Editor selection" : "Terminal selection",
    detectedMediaType: "text/plain",
    byteSize: bytes.byteLength,
    contentKind: "selection",
    processingState: "ready",
    textRepresentation: input.text,
    security: {
      secretPathCheck: "not-applicable",
      workspaceScopeCheck: "not-applicable",
      mimeSniffed: true,
    },
    createdAt: Date.now(),
  };
}

function sourceKey(record: AttachmentRecord): string {
  if (record.source.kind === "workspace-path") {
    return `path:${record.source.canonicalPath ?? record.source.path}`;
  }
  if (record.source.kind === "picker") return `picker:${record.source.token}`;
  if (record.source.kind === "archive-entry") {
    return `archive:${record.source.archiveAttachmentId}:${record.source.entryIndex}`;
  }
  return `selection:${record.id}`;
}

export function mergeAttachmentRecords(
  existing: readonly AttachmentRecord[],
  incoming: readonly AttachmentRecord[],
): AttachmentBatchResult {
  const records = [...existing];
  const rejected: AttachmentBatchResult["rejected"] = [];
  const seen = new Set(records.map(sourceKey));
  let aggregateBytes = records
    .filter((record) => record.processingState === "ready")
    .reduce((sum, record) => sum + record.byteSize, 0);

  for (const original of incoming) {
    if (seen.has(sourceKey(original))) {
      rejected.push({
        displayName: original.displayName,
        message: "This attachment is already included.",
      });
      continue;
    }
    if (records.length >= ATTACHMENT_LIMITS.maxCount) {
      rejected.push({
        displayName: original.displayName,
        message: `A message can include up to ${ATTACHMENT_LIMITS.maxCount} attachments.`,
      });
      continue;
    }
    let record = original;
    if (
      record.processingState === "ready" &&
      aggregateBytes + record.byteSize > ATTACHMENT_LIMITS.maxAggregateBytes
    ) {
      record = {
        ...record,
        processingState: "failed",
        error: {
          code: "attachment_aggregate_too_large",
          message: `Combined attachments must be ${formatBytes(ATTACHMENT_LIMITS.maxAggregateBytes)} or smaller.`,
        },
        textRepresentation: undefined,
        imageRepresentation: undefined,
      };
    }
    records.push(record);
    seen.add(sourceKey(record));
    if (record.processingState === "ready") aggregateBytes += record.byteSize;
  }
  return { records, rejected };
}

export function isDeliverableAttachment(record: AttachmentRecord): boolean {
  return (
    record.processingState === "ready" &&
    Boolean(record.contentRef) &&
    (record.contentKind === "text" ||
      record.contentKind === "image" ||
      (record.contentKind === "document" &&
        Boolean(record.documentRepresentation?.textContentRef)) ||
      (record.contentKind === "archive" &&
        Boolean(record.archiveRepresentation?.manifestContentRef)) ||
      record.contentKind === "selection")
  );
}

export function formatTextAttachmentBlock(record: AttachmentRecord): string {
  return [
    "----- CLACK ATTACHMENT -----",
    JSON.stringify({
      name: record.displayName,
      mediaType: record.detectedMediaType,
    }),
    record.textRepresentation ?? "",
    "----- END CLACK ATTACHMENT -----",
  ].join("\n");
}

export function formatSelectionAttachmentBlock(
  record: AttachmentRecord,
): string {
  return [
    "----- CLACK SELECTION -----",
    JSON.stringify({
      source:
        record.source.kind === "selection" ? record.source.surface : "terminal",
    }),
    record.textRepresentation ?? "",
    "----- END CLACK SELECTION -----",
  ].join("\n");
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < MIB) return `${Math.ceil(bytes / 1024)} KB`;
  const value = bytes / MIB;
  return `${Number.isInteger(value) ? value : value.toFixed(1)} MB`;
}
