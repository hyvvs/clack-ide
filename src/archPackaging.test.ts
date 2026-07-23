/// <reference types="node" />

import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import packageJson from "../package.json";
import archWorkflow from "../.github/workflows/arch-package.yml?raw";
import launcherManifest from "../packaging/linux-launcher/Cargo.toml?raw";
import launcherLibrary from "../packaging/linux-launcher/src/lib.rs?raw";
import launcherMain from "../packaging/linux-launcher/src/main.rs?raw";
import pkgbuildTemplate from "../packaging/arch/PKGBUILD.template?raw";
import desktopEntry from "../packaging/arch/clack.desktop?raw";
import applicationManifest from "../src-tauri/Cargo.toml?raw";
import tauriConfig from "../src-tauri/tauri.conf.json";

const temporaryRoot = mkdtempSync(resolve(tmpdir(), "clack-arch-test-"));
const applicationBinary = resolve(temporaryRoot, "clack-bin");
const launcherBinary = resolve(temporaryRoot, "clack-linux-launcher");
const outputDirectory = resolve(temporaryRoot, "output");

beforeAll(() => {
  writeFileSync(applicationBinary, "application fixture");
  writeFileSync(launcherBinary, "launcher fixture");
  execFileSync(
    process.execPath,
    [
      resolve(process.cwd(), "packaging", "arch", "prepare-package.mjs"),
      outputDirectory,
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        CLACK_APP_BINARY: applicationBinary,
        CLACK_LAUNCHER_BINARY: launcherBinary,
      },
    },
  );
});

afterAll(() => {
  rmSync(temporaryRoot, { recursive: true, force: true });
});

function generatedPkgbuild() {
  return readFileSync(resolve(outputDirectory, "PKGBUILD"), "utf8");
}

function arrayValues(pkgbuild: string, name: string) {
  const body = pkgbuild.match(
    new RegExp(`^${name}=\\(([\\s\\S]*?)^\\)`, "mu"),
  )?.[1];
  if (!body) {
    throw new Error(`Missing ${name} array in generated PKGBUILD`);
  }
  return Array.from(body.matchAll(/'([^']+)'/gu), (match) => match[1]);
}

describe("native Arch package", () => {
  it("keeps the package, Tauri, Rust application, and launcher versions aligned", () => {
    expect(packageJson.version).toBe("0.8.0");
    expect(tauriConfig.version).toBe(packageJson.version);
    expect(applicationManifest).toContain(`version = "${packageJson.version}"`);
    expect(launcherManifest).toContain(`version = "${packageJson.version}"`);
    expect(generatedPkgbuild()).toContain(`pkgver=${packageJson.version}`);
  });

  it("uses a distinct launcher and real application binary layout", () => {
    const pkgbuild = generatedPkgbuild();

    expect(launcherLibrary).toContain(
      'pub const REAL_BINARY_PATH: &str = "/usr/lib/clack/clack-bin"',
    );
    expect(pkgbuild).toContain(
      '"$srcdir/clack-linux-launcher" "$pkgdir/usr/bin/clack"',
    );
    expect(pkgbuild).toContain(
      '"$srcdir/clack-bin" "$pkgdir/usr/lib/clack/clack-bin"',
    );
  });

  it("installs the desktop entry, icons, documentation, and license", () => {
    const pkgbuild = generatedPkgbuild();
    const expectedDestinations = [
      "/usr/share/applications/clack.desktop",
      "/usr/share/icons/hicolor/32x32/apps/clack.png",
      "/usr/share/icons/hicolor/128x128/apps/clack.png",
      "/usr/share/icons/hicolor/256x256/apps/clack.png",
      "/usr/share/doc/clack/ARCH_PACKAGE_README.txt",
      "/usr/share/licenses/clack/LICENSE",
    ];

    for (const destination of expectedDestinations) {
      expect(pkgbuild).toContain(destination);
    }
    expect(desktopEntry).toContain("Exec=/usr/bin/clack");
    expect(desktopEntry).toContain("Icon=clack");
    expect(desktopEntry).not.toContain("__NV_DISABLE_EXPLICIT_SYNC");
  });

  it("declares Clack's native Arch runtime dependencies", () => {
    expect(arrayValues(generatedPkgbuild(), "depends")).toEqual([
      "cairo",
      "gdk-pixbuf2",
      "glib2",
      "gtk3",
      "hicolor-icon-theme",
      "libappindicator-gtk3",
      "librsvg",
      "openssl",
      "pango",
      "webkit2gtk-4.1",
      "xdg-utils",
    ]);
  });

  it("stages only application assets and no bundled system graphics libraries", () => {
    const stagedFiles = readdirSync(outputDirectory).sort();
    const bannedLibraryPattern =
      /(?:gtk|webkit|nvidia|mesa|gbm|egl|alsa).*\.(?:a|so(?:\.\d+)*)$/iu;

    expect(stagedFiles).toEqual([
      "ARCH_PACKAGE_README.txt",
      "LICENSE",
      "PKGBUILD",
      "clack-128.png",
      "clack-256.png",
      "clack-32.png",
      "clack-bin",
      "clack-linux-launcher",
      "clack.desktop",
    ]);
    expect(stagedFiles.some((file) => bannedLibraryPattern.test(file))).toBe(
      false,
    );
  });

  it("resolves every package checksum token", () => {
    const pkgbuild = generatedPkgbuild();
    const sources = arrayValues(pkgbuild, "source");
    const checksums = arrayValues(pkgbuild, "sha256sums");

    expect(checksums).toHaveLength(sources.length);
    expect(checksums.every((checksum) => /^[a-f0-9]{64}$/u.test(checksum))).toBe(
      true,
    );
    expect(pkgbuild).not.toMatch(/@[A-Z0-9_]+@/u);
  });

  it("launches directly with OsString arguments and Unix exec without a shell", () => {
    expect(launcherMain).toContain("Command::new(plan.executable)");
    expect(launcherMain).toContain("command.args(plan.arguments)");
    expect(launcherMain).toContain("command.exec()");
    expect(launcherMain).not.toMatch(/Command::new\("(?:sh|bash)"\)/u);
    expect(launcherMain).not.toContain('"-c"');
    expect(launcherMain).not.toContain("std::env::set_var");
  });

  it("keeps the existing Linux NVIDIA development script unchanged", () => {
    expect(packageJson.scripts["tauri:dev:linux:nvidia"]).toBe(
      "__NV_DISABLE_EXPLICIT_SYNC=1 tauri dev",
    );
    expect(pkgbuildTemplate).not.toContain("__NV_DISABLE_EXPLICIT_SYNC");
  });

  it("builds and validates through separate official Arch containers", () => {
    expect(archWorkflow).toContain("container: archlinux:base-devel");
    expect(archWorkflow).toContain("container: archlinux:base");
    expect(archWorkflow).toContain("npm ci");
    expect(archWorkflow).toContain("rustup default stable");
    expect(archWorkflow).toContain("npm run tauri -- build --no-bundle");
    expect(archWorkflow).toContain(
      "cargo build --manifest-path packaging/linux-launcher/Cargo.toml --release --locked",
    );
    expect(archWorkflow).toContain(
      "makepkg --cleanbuild --clean --force --noconfirm",
    );
  });

  it("uses unprivileged makepkg and clean pacman validation without publishing", () => {
    expect(archWorkflow).toContain(
      "useradd --create-home --shell /bin/bash",
    );
    expect(archWorkflow).toMatch(
      /runuser -u "\$BUILD_USER"[\s\S]*makepkg --cleanbuild/u,
    );
    expect(archWorkflow).toContain("pacman -Qip");
    expect(archWorkflow).toContain("pacman -Qlp");
    expect(archWorkflow).toContain("namcap");
    expect(archWorkflow).toContain("pacman -U --noconfirm");
    expect(archWorkflow).toContain(
      "desktop-file-validate /usr/share/applications/clack.desktop",
    );
    expect(archWorkflow).toContain("ldd /usr/lib/clack/clack-bin");
    expect(archWorkflow).toContain("SHA256SUMS.txt");
    expect(archWorkflow).not.toMatch(
      /publish[\s\S]*aur|create[-_]release|release-action|tauri-action/iu,
    );
  });

  it("reports each clean-install assertion and queries validation tools deterministically", () => {
    expect(archWorkflow).toContain("pacman -Ql clack");
    expect(archWorkflow).toContain(
      "if pacman -Qq desktop-file-utils >/dev/null 2>&1; then",
    );
    expect(archWorkflow).not.toContain(
      "pacman -S --needed --noconfirm desktop-file-utils",
    );
    expect(archWorkflow).toContain(
      "NoExtract[[:space:]]*=.*usr/share/doc/",
    );
    expect(archWorkflow).toContain(
      "Removing the container's documentation NoExtract rule",
    );
    expect(archWorkflow).toContain("print_parent_contents()");
    expect(archWorkflow).toContain("Nearest existing parent:");
    expect(archWorkflow).toContain("require_executable()");
    expect(archWorkflow).toContain("require_regular_file()");
    expect(archWorkflow).toContain("require_not_symlink()");
    expect(archWorkflow).toContain("require_executable /usr/bin/clack");
    expect(archWorkflow).toContain("require_not_symlink /usr/bin/clack");
    expect(archWorkflow).not.toContain("test -x /usr/bin/clack");
    expect(archWorkflow).not.toContain("test ! -L /usr/bin/clack");
    expect(archWorkflow).not.toContain("|| true");
  });
});
