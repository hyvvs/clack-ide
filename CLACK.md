# CLACK.md

Clack is a Tauri 2 + React 19 + Rust IDE/agent app forked from Terax.

## Project Rules

- Product name: Clack.
- Package manager: npm. Use `npm install`, `npm run check-types`, `npm run lint`, `npm test`, `npm run tauri -- dev`, and `npm run tauri -- build`.
- Tauri build hooks must stay on `npm run dev` and `npm run build`.
- On Linux NVIDIA Wayland, if normal Tauri dev launch has Wayland, GDK, or GBM failures or severe WebKitGTK lag, use `npm run tauri:dev:linux:nvidia`. It sets `__NV_DISABLE_EXPLICIT_SYNC=1` for that dev process only. `WEBKIT_DISABLE_COMPOSITING_MODE=1` is a last resort because it can be very laggy, and `WEBKIT_DISABLE_DMABUF_RENDERER=1` may still be laggy.
- The central workspace is for editor, preview, markdown, AI diff, git diff, and git history tabs.
- Terminals are real PTY-backed sessions rendered in the bottom dock, not center editor tabs.
- Do not replace xterm.js, PTY streaming, shell cwd tracking, WSL behavior, terminal tabs, or terminal splits with mock UI.
- Keep explorer, editor, source control, preview, AI chat, approvals, provider settings, and workspace switching functional.
- No fake visible controls. Incomplete features should be hidden or wired to real behavior.

## Verification

Run the relevant subset before claiming done:

- `npm install`
- `npm run check-types`
- `npm run lint`
- `npm test`
- `npm run tauri -- dev`
- `npm run tauri:dev:linux:nvidia` for NVIDIA Wayland dev launch issues on Linux
- `npm run tauri -- build`
- `cd src-tauri && cargo fmt --check`
- `cd src-tauri && cargo clippy --all-targets --locked -- -D warnings`
- `cd src-tauri && cargo test --locked`
