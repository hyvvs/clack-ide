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

The decoded-image limit is enforced from PNG, JPEG, GIF, and WEBP dimensions.
SVG files use the 1 MiB text-byte limit and are not rendered as composer
thumbnails. Later image work may add stricter SVG and animated-image handling.

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

Archive and unknown binary references are metadata-only at transport level;
current ingestion continues to mark those formats unsupported until their
dedicated processors exist.

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

Identical content is deduplicated. In-memory leases protect unsent and active
content from cleanup. Startup and session deletion reconcile the store against
persisted references; unreferenced files and abandoned staging files are
removed. Existing persisted data-URL attachments migrate when their chat is
opened. A failed migration preserves the original history.

ZIP, RAR, 7z, and unknown binary files are identified honestly but remain
unsupported until their dedicated processing checkpoints are implemented.
