/** Guard against accidentally treating a WebView2 browser-fetch test as
 * isolated merely because Tauri's native ai_http_stream was blocked.
 * Strictly local: no WebView, provider, proxy or firewall is created.
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repo = process.cwd();
const runner = path.join(repo, "scripts", "post-policy-hosted-notes.mjs");
const frozenRoot = path.join(repo, "src-tauri", "target", "remote-controls");
const frozenFiles = [
  path.join(frozenRoot, "post-policy-laguna-notes-20261029-01", "mission-a-1.native-report.json"),
  path.join(frozenRoot, "post-policy-harness-offline-probe-20261029-01", "mission-a-1.native-report.json"),
  path.join(frozenRoot, "post-policy-harness-offline-verify-20261029-01", "mission-a-1.native-report.json"),
];
const checksum = (file: string) =>
  createHash("sha256").update(readFileSync(file)).digest("hex");

describe("hosted offline WebView launches fail closed without independent OS egress isolation", () => {
  it.each(["probe", "verify"] as const)(
    "blocks --offline-dry-run=%s before settings, workspace, Vite and WebView startup",
    (mode) => {
      // A deliberately missing settings directory proves this guard fires
      // before credential/settings IO. No provider key is supplied.
      const impossibleSettings = path.join(repo, "__offline_isolation_missing_settings__");
      // Preserve every genuinely available original archive byte. In a clean
      // runner missing historical files are observed as ABSENT, not replaced
      // with synthetic evidence or scored as original acceptance.
      const before = frozenFiles.map(file => existsSync(file) ? checksum(file) : null);
      const result = spawnSync(process.execPath,
        [runner, `--offline-dry-run=${mode}`], {
          cwd: repo, encoding: "utf8", windowsHide: true, timeout: 12_000,
          env: { ...process.env, APPDATA: impossibleSettings,
            CLACK_HOSTED_OFFLINE_DRY_RUN: "1" },
        });
      expect(result.error).toBeUndefined();
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("POST-POLICY HOSTED TEST ISOLATION UNSAFE");
      expect(result.stderr).toContain("before any settings, workspace, or provider initialization");
      expect(result.stdout).not.toContain("remote-control-native-start");
      expect(frozenFiles.map(file => existsSync(file) ? checksum(file) : null)).toEqual(before);
      expect(() => statSync(impossibleSettings)).toThrow();
    },
  );
  it("has no unsafe opt-in flag that silently turns the old dry-run back on", () => {
    const source = readFileSync(runner, "utf8");
    const guardAt = source.indexOf("if (offlineDryRun) throw new Error(");
    const firstWorkspaceWrite = source.indexOf("await mkdir(root,");
    const settingsRead = source.indexOf("await readFile(originalSettings)");
    expect(guardAt).toBeGreaterThan(0);
    expect(guardAt).toBeLessThan(firstWorkspaceWrite);
    expect(guardAt).toBeLessThan(settingsRead);
    expect(source).not.toMatch(/CLACK_ALLOW_UNSAFE_OFFLINE|SKIP_ISOLATION_CHECK|FORCE_UNSAFE/);
  });
});
