# Clack Implementation Plan

## Preserved Terax Systems

- Keep the Tauri 2 + Rust backend as the only authority for filesystem, shell, git, PTY, keychain, and provider-network access.
- Keep the React + TypeScript frontend, xterm.js native PTY terminal, CodeMirror editor, explorer, source-control panel, preview pane, settings window, AI chat, approval cards, plan mode, subagents, and local provider flow.
- Keep the existing AI SDK transport and tool approval model. Goose is a reference for architecture and security patterns, not a replacement UI or runtime.

## Goose Capabilities Adapted In This Pass

- Product-level Clack rename with compatibility for existing Terax settings and keychain entries.
- Provider registry hardening around real, selectable providers already supported by Terax: OpenAI, Anthropic, Google, xAI, Cerebras, Groq, DeepSeek, Mistral, OpenRouter, OpenAI-compatible endpoints, LM Studio, MLX, and Ollama.
- Backend ACP detection boundary for Codex, Claude, and Amp adapters. ACP providers stay hidden from model selection until an end-to-end provider execution bridge exists.
- Auto-update UI and Tauri updater wiring are disabled until Clack has its own release channel and signing key.

## Goose Capabilities Intentionally Not Exposed Yet

- MCP extension manager, recipes, Goose-style codebase analysis, enhanced edit-model rewriting, and full ACP provider execution are not exposed in UI in this pass.
- These need real lifecycle, approval routing, cancellation, error reporting, and tests before becoming visible controls.

## Integration Boundaries

- Rust Tauri commands remain the OS boundary.
- Provider secrets remain in OS keychain. Legacy Terax keychain service names are read for migration, but new writes use Clack service names.
- ACP detection checks real local binaries only and returns actionable setup messages. It does not execute agents or bypass Clack approvals.
- Project memory prefers `CLACK.md` and falls back to existing `TERAX.md` files for workspace compatibility.
- Incomplete Goose features are documented here instead of shown as clickable UI.

## Functional Tests

- Frontend: provider registry tests, settings compatibility tests, typecheck, lint, and Vitest.
- Rust: ACP detection unit tests, existing fs/net/secrets/git/pty tests, format check, clippy, and cargo tests.
- Build: `npm run tauri build` when platform dependencies are present.
