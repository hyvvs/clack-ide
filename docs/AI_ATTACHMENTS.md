# Clack AI Attachments

This document records the attachment safety contract. All picker, workspace
`@` picker, and Explorer attachment paths must produce the same normalized
`AttachmentRecord` before the composer may send content to a model.

## Current limits

| Limit | Value |
| --- | --- |
| Attachments per message | 8 |
| Individual file | 8 MiB |
| Text or source file | 1 MiB of strict UTF-8 |
| Image payload | 8 MiB |
| Combined ready attachments | 20 MiB |
| Estimated decoded raster image | 64 MiB at 4 bytes per pixel |
| PDF pages | 10,000 maximum; first 128 inspected |
| PDF decompressed page content | 4 MiB per inspected page |
| PDF extracted text | 64 KiB per page; 512 KiB total |
| ZIP or 7z input | 8 MiB |
| Archive entries | 2,048 |
| Archive expanded entry | 4 MiB |
| Archive total expanded data | 64 MiB |
| Archive compression ratio | 200:1 per ZIP entry or 7z compression block |
| Archive entry path | 1,024 bytes; 256 KiB total manifest paths |
| Nested archive depth | 0; listed but not opened |

The decoded-image limit is enforced from PNG, JPEG, GIF, and WEBP dimensions.
SVG files use the 1 MiB text-byte limit and are not rendered as composer
thumbnails. Later image work may add stricter SVG and animated-image handling.

## Remaining attachment roadmap

### Planned attachment truthfulness and delivery-transparency checkpoint

Detection is not processing. A later attachment UX and polish checkpoint must
make the useful processing outcome and model-delivery outcome explicit. This is
not part of the completed ZIP/7z adapter checkpoint and must not be folded into
Checkpoint 8, PeerTask immutable artifact packages, merely to expand that
checkpoint. Checkpoint 8 must preserve enough structured outcome metadata for
the later UX to report the truth without reparsing content.

The product rule is strict: no attachment may appear supported or ready unless
Clack can state what useful content was processed and what will be delivered to
the selected model. Detection-only formats must be labeled limited or
unsupported. The UI must distinguish fully processed, partially processed or
limited, truncated, and unsupported outcomes.

Required user-facing outcomes include:

- Images: `Ready - vision input` only when image bytes will actually be sent to
  a selected model with confirmed vision support; otherwise show that the
  selected model does not support the image.
- PDFs with embedded text: show ready state, page count, and extracted text.
- Scanned or image-only PDFs: show a limited state explaining that no embedded
  text was found and OCR is unavailable.
- Bounded PDFs: show truncation when only bounded pages or text were processed.
- ZIP and 7z: show that the archive was indexed and how many files were found;
  make clear that entry contents are not sent until entries are selected.
- RAR: show unsupported state and explain that the signature was detected but
  the contents cannot be safely inspected.
- Unknown binary files: show limited metadata-only state rather than implying
  that the model can read the contents.

The later compact attachment detail view should expose only useful delivery
facts, including processed pages, extracted text size, truncation, selected
archive entries, actual image-vision delivery, omitted or unsupported content,
and processing errors. It must not expose unnecessary internal implementation
details. The same truthful status must be used in the composer, persisted chat
history, model capability routing, and future PeerTask artifact packages.

## Security contract

- Browser MIME values are hints only. Signature sniffing determines supported
  image, PDF, archive, and executable types.
- Text must have a known text extension or reported `text/*` type and must
  decode as strict UTF-8. Unknown binary data is never decoded as replacement
  text.
- Secret-denied names such as `.env`, credentials, and private keys are blocked
  by the existing AI secret-path policy before content is loaded.
- Workspace-path attachments are canonicalized, checked by the secret policy,
  and then read by a Tauri command that requires the path to remain inside an
  authorized workspace root.
- Directories and non-regular filesystem entries cannot be attached.
- Rejected and not-yet-supported files remain visible with a specific reason;
  they are not silently omitted or sent to a model.

## Current delivery

Attachment bytes are stored once under Clack's app-data `ai-attachments`
directory. Files are named by their SHA-256 content hash and written
atomically. Message history contains a small `data-clack-attachment` reference,
not raw text or a base64 data URL.

When a request is sent, the transport reads and integrity-checks the referenced
content. Bounded text and source files become transient delimited text with
JSON-escaped metadata. Bounded images become transient AI SDK image parts only
when the selected model has confirmed vision support. The transcript renders
compact attachment cards and loads image thumbnails only near the viewport.

PeerTask delegation uses the same content-addressed references. Existing chat
attachments reuse their stored hashes, while explicit workspace paths are
canonicalized, security-checked, normalized, and snapshotted when the task is
created. A queued task never rereads the source path. Missing or corrupted
stored content fails the task closed, and model delivery still goes through the
normal attachment resolver and capability checks.

PeerTask records contain bounded metadata rather than bytes: artifact and
attachment IDs, content hash and size, media and content kind, source session,
agent, model, workspace, origin, and any PDF, archive-entry, or worktree
provenance. Input packages and returned packages each allow at most 8 artifacts
and 20 MiB in aggregate; the normal 8 MiB per-content-store object limit still
applies. Isolated-worktree patches are stored as immutable returned artifacts
without changing the existing explicit review and apply flow. Retained input
and returned PeerTask references participate in attachment-store cleanup.

## Restart recovery

AI startup is ordered so dead execution is never presented as resumed work:
provider and agent settings load first, chat sessions recover stale runs, then
PeerTasks validate their schema, captured conversation/workspace/agent/model
identity, dependencies, cancellation state, immutable content, and managed Git
worktrees. The PeerTask queue is enabled only after the recovered ledger has
been saved.

A chat that was running when Clack closed becomes interrupted and keeps the
transcript received so far. A running PeerTask becomes failed with explicit
app-restart provenance while preserving any persisted result, returned
artifacts, worktree, and captured patch. Approval controls from the dead run
are expired rather than reconnected to a nonexistent provider stream.

Queued work survives only when its source and target conversations, workspace,
captured target agent/model, dependencies, and immutable input content still
validate. Missing or hash-invalid input content fails closed before dispatch.
Returned artifact metadata remains visible when its blob is unavailable.
Waiting tasks are recalculated from durable dependency state; blocked and
cancelled tasks remain terminal.

Content-store reconciliation retains references from normal chat messages and
all PeerTask input, returned, PDF-derived, and archive-derived representations.
It removes unreachable blobs and reports missing, invalid, or hash-mismatched
retained content without deleting the affected durable metadata.

Managed task worktrees are inspected without applying or modifying their
changes. Valid worktrees remain available for review; a missing or invalid
worktree is labeled unavailable while any durable patch remains reviewable.
Successful capture removes its worktree, and explicit discard removes a
preserved terminal worktree. Startup cleanup removes only clean managed
worktrees that have no retained PeerTask record. Orphaned worktrees containing
tracked, untracked, or ignored changes are preserved rather than deleted.

## Model capability routing

Clack represents text, image, native document, tool, and audio capability as
`supported`, `unsupported`, or `unknown`. Known registry models use their
existing explicit `vision` and `tools` tags. Saved provider IDs, custom
OpenAI-compatible endpoints, and local freeform model IDs remain `unknown` for
modalities that Clack cannot verify. Clack never infers vision support from a
model name.

Text attachments are delivered as bounded text because every configured chat
transport accepts text. Images are sent only when vision support is confirmed.
An explicitly text-only model blocks the image before provider invocation. An
unknown image capability also blocks delivery and asks the user to choose a
model with confirmed vision support. The composer chip shows the same state,
and the transport repeats the check to cover non-composer send paths.

ZIP and 7z archives are delivered as bounded manifests plus any entries the user
explicitly selected. Selected entries pass through the same normalizer,
capability routing, and content store as direct attachments. RAR4 and RAR5 are
signature-detected but remain unsupported. Unknown binary references remain
unsupported or metadata-only.

## Image input routes

PNG, JPEG, WEBP, GIF, and SVG files can enter the shared normalizer through the
file picker, a file dropped onto the AI composer, an image pasted from the
clipboard, the workspace `@` picker, or Explorer's Attach to Agent action. A
picker, drop, or paste file appears immediately with a `Processing` chip and is
then replaced in place by its ready or specific error state.

Raster images receive bounded previews and are delivered as image parts only
under the capability policy above. SVG is handled differently: Clack validates
bounded strict UTF-8 source, never embeds the SVG as active composer markup,
and delivers its source as text. This lets text models inspect SVG structure
without claiming that they saw a rendered image.

## PDF processing

PDF parsing runs in Rust against the raw, signature-checked bytes. Clack uses
bounded per-page decompression, records the total page count, and extracts
embedded text into page-aware chunks. The raw PDF and the derived text are
stored as separate content-addressed objects. Chat history keeps their hashes,
page metadata, and limits rather than duplicating PDF bytes or extracted text.

Transport loads only the bounded derived text and preserves page markers in the
model input. It does not send the raw PDF to providers that lack confirmed
native document support. PDFs beyond the extraction page or text budgets are
marked truncated. Malformed and encrypted PDFs show a processing failure.
Image-only PDFs show their page count and explain that no embedded text was
found; Clack does not run OCR automatically.

## Archive processing

ZIP and 7z inspection runs in Rust against signature-checked bytes. Clack rejects
absolute, UNC, Windows-drive, NUL, traversal, duplicate, oversized, and
control-character paths. Symbolic links, Windows reparse points, anti-items, and
every non-regular Unix entry type are rejected, covering devices, FIFOs,
sockets, and represented link-like entries.
Entry count, compressed size, expanded size, per-entry size, path metadata,
and compression ratio are all bounded before any selected entry is
decompressed. ZIP ratio checks are per entry. 7z ratio checks are per decoder
block so solid archives cannot hide unsafe expansion behind zero per-file
compressed-size metadata.

Inspection returns a compact manifest. The composer initially renders only a
bounded searchable portion of that manifest, and nested archives are visible
but non-selectable. Clack never recursively opens nested archives in this
checkpoint.

Selecting one entry asks Rust to revalidate the complete archive and expand
only that entry into a bounded in-memory buffer. The bytes then enter the same
normal attachment pipeline used by picker and workspace files. This catches
disguised executables, invalid UTF-8, oversized text, oversized images, and
model capability mismatches without a ZIP-specific bypass.

No archive content is written into the workspace or a temporary extraction
tree. Cancellation and failures drop bounded in-memory buffers, so there are
no extracted permissions or temporary files to clean up. Executable mode bits
are never propagated and archive content is never executed.

Identical content is deduplicated. In-memory leases protect unsent and active
content from cleanup. Startup and session deletion reconcile the store against
persisted references; unreferenced files and abandoned staging files are
removed. Existing persisted data-URL attachments migrate when their chat is
opened. A failed migration preserves the original history.

7z uses `sevenz-rust2` 0.22.2, an Apache-2.0, maintained, in-process Rust
reader. Clack enables its standard COPY, LZMA, LZMA2, BZIP2, and PPMd support.
It never invokes `7z`, `7zz`, PowerShell, or another system archive program.
Unicode names are decoded by the reader and then normalized by the shared path
policy. Stored POSIX type bits and the Windows reparse flag are checked before
an entry is selectable. The 7z format does not expose a separate hardlink
record through this reader; materialization returns bytes only and never
creates filesystem links or propagates permissions.

Encrypted 7z content is shown as locked and non-selectable when the unencrypted
header exposes its entries. An encrypted header produces a visible unsupported
processing error. Clack does not prompt for, store, or attempt archive
passwords. Nested ZIP, RAR, and 7z entries remain visible but non-selectable;
the nested archive depth is zero.

RAR4 and RAR5 signatures are distinguished from other files, but safe RAR
inspection is intentionally blocked. The audited pure Rust `unrar-rs` 0.7.0
reader exposes the required redirection metadata but is GPL-3.0-or-later with
the UnRAR restriction, which is not compatible with this Apache-2.0 package.
The `unrar` 0.5.8 crate uses bundled RARLAB C++ code under the UnRAR license and
does not expose enough redirection metadata in its high-level entry API to
guarantee Clack's symlink and hardlink rejection policy. Clack does not fall
back to a system `unrar` executable. A suitable permissively licensed embedded
reader with trustworthy link metadata is required before RAR materialization
can be enabled.
