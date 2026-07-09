import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

type PermissionEntry =
  | string
  | {
      identifier: string;
      allow?: unknown[];
      deny?: unknown[];
    };

type CapabilityFile = {
  identifier: string;
  windows?: string[];
  permissions: PermissionEntry[];
};

function readJson<T>(...parts: string[]): T {
  return JSON.parse(
    readFileSync(join(process.cwd(), ...parts), "utf8"),
  ) as T;
}

function readCapability(name: string): CapabilityFile {
  return readJson<CapabilityFile>("src-tauri", "capabilities", name);
}

function permissionId(permission: PermissionEntry): string {
  return typeof permission === "string" ? permission : permission.identifier;
}

describe("opener capabilities", () => {
  it("uses the default capability for the main window", () => {
    const capability = readCapability("default.json");
    const config = readJson<{
      app?: { security?: { capabilities?: unknown } };
    }>("src-tauri", "tauri.conf.json");

    expect(capability.windows).toContain("main");
    expect(config.app?.security?.capabilities).toBeUndefined();
  });

  it("loads the desktop capability for desktop main windows", () => {
    const capability = readCapability("desktop.json") as CapabilityFile & {
      platforms?: string[];
    };

    expect(capability.windows).toContain("main");
    expect(capability.platforms).toEqual(
      expect.arrayContaining(["macOS", "windows", "linux"]),
    );
  });

  it("does not expose raw opener.openPath to the webview", () => {
    const capability = readCapability("default.json");
    expect(capability.permissions.map(permissionId)).not.toContain(
      "opener:allow-open-path",
    );
  });

  it("keeps system reveal available through the existing opener permission", () => {
    const capability = readCapability("default.json");
    expect(capability.permissions.map(permissionId)).toContain(
      "opener:allow-reveal-item-in-dir",
    );
  });
});
