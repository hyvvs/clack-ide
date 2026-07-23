import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..", "..");
const outputDirectory = resolve(
  process.argv[2] ?? resolve(scriptDirectory, ".build"),
);

function fail(message) {
  throw new Error(`Clack Arch package preparation failed: ${message}`);
}

function requireFile(path, label) {
  if (!existsSync(path) || !statSync(path).isFile()) {
    fail(`${label} was not found at ${path}`);
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function cargoPackageVersion(manifestPath) {
  const manifest = readFileSync(manifestPath, "utf8");
  const packageSection = manifest.match(
    /^\[package\]\s*$([\s\S]*?)(?=^\[|(?![\s\S]))/mu,
  );
  const version = packageSection?.[1].match(
    /^version\s*=\s*"([^"]+)"\s*$/mu,
  )?.[1];

  if (!version) {
    fail(`could not read the package version from ${manifestPath}`);
  }

  return version;
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function prepareOutputDirectory() {
  mkdirSync(outputDirectory, { recursive: true });
  const existingEntries = readdirSync(outputDirectory);
  if (existingEntries.length > 0) {
    fail(`output directory must be empty: ${outputDirectory}`);
  }
}

const packageJsonPath = resolve(repositoryRoot, "package.json");
const tauriConfigPath = resolve(
  repositoryRoot,
  "src-tauri",
  "tauri.conf.json",
);
const applicationManifestPath = resolve(
  repositoryRoot,
  "src-tauri",
  "Cargo.toml",
);
const launcherManifestPath = resolve(
  repositoryRoot,
  "packaging",
  "linux-launcher",
  "Cargo.toml",
);

const packageJson = readJson(packageJsonPath);
const tauriConfig = readJson(tauriConfigPath);
const versions = new Map([
  ["package.json", packageJson.version],
  ["src-tauri/tauri.conf.json", tauriConfig.version],
  ["src-tauri/Cargo.toml", cargoPackageVersion(applicationManifestPath)],
  [
    "packaging/linux-launcher/Cargo.toml",
    cargoPackageVersion(launcherManifestPath),
  ],
]);
const uniqueVersions = new Set(versions.values());

if (uniqueVersions.size !== 1 || !packageJson.version) {
  fail(
    `package versions do not match: ${Array.from(versions, ([file, version]) => `${file}=${version}`).join(", ")}`,
  );
}
if (tauriConfig.identifier !== "app.clack.dev") {
  fail(`unexpected Tauri identifier: ${tauriConfig.identifier}`);
}

const applicationBinary = resolve(
  process.env.CLACK_APP_BINARY ??
    resolve(repositoryRoot, "src-tauri", "target", "release", "clack"),
);
const launcherBinary = resolve(
  process.env.CLACK_LAUNCHER_BINARY ??
    resolve(
      repositoryRoot,
      "packaging",
      "linux-launcher",
      "target",
      "release",
      "clack-linux-launcher",
    ),
);

if (applicationBinary === launcherBinary) {
  fail("application and launcher binaries must be distinct files");
}
requireFile(applicationBinary, "Clack application binary");
requireFile(launcherBinary, "Clack Linux launcher");

const inputs = [
  {
    source: applicationBinary,
    destination: "clack-bin",
    checksumToken: "@CLACK_BIN_SHA256@",
  },
  {
    source: launcherBinary,
    destination: "clack-linux-launcher",
    checksumToken: "@CLACK_LAUNCHER_SHA256@",
  },
  {
    source: resolve(scriptDirectory, "clack.desktop"),
    destination: "clack.desktop",
    checksumToken: "@DESKTOP_SHA256@",
  },
  {
    source: resolve(repositoryRoot, "src-tauri", "icons", "32x32.png"),
    destination: "clack-32.png",
    checksumToken: "@ICON_32_SHA256@",
  },
  {
    source: resolve(repositoryRoot, "src-tauri", "icons", "128x128.png"),
    destination: "clack-128.png",
    checksumToken: "@ICON_128_SHA256@",
  },
  {
    source: resolve(repositoryRoot, "src-tauri", "icons", "128x128@2x.png"),
    destination: "clack-256.png",
    checksumToken: "@ICON_256_SHA256@",
  },
  {
    source: resolve(scriptDirectory, "ARCH_PACKAGE_README.txt"),
    destination: "ARCH_PACKAGE_README.txt",
    checksumToken: "@PACKAGE_README_SHA256@",
  },
  {
    source: resolve(repositoryRoot, "LICENSE"),
    destination: "LICENSE",
    checksumToken: "@LICENSE_SHA256@",
  },
];

prepareOutputDirectory();

const replacements = new Map([["@PKGVER@", packageJson.version]]);
for (const input of inputs) {
  requireFile(input.source, input.destination);
  const destination = resolve(outputDirectory, input.destination);
  copyFileSync(input.source, destination);
  replacements.set(input.checksumToken, sha256(destination));
}

let pkgbuild = readFileSync(resolve(scriptDirectory, "PKGBUILD.template"), "utf8");
for (const [token, value] of replacements) {
  pkgbuild = pkgbuild.replaceAll(token, value);
}

const remainingTokens = pkgbuild.match(/@[A-Z0-9_]+@/gu) ?? [];
if (remainingTokens.length > 0) {
  fail(`unresolved PKGBUILD tokens: ${remainingTokens.join(", ")}`);
}

writeFileSync(resolve(outputDirectory, "PKGBUILD"), pkgbuild);
console.log(
  `Prepared Clack ${packageJson.version}-1 Arch package inputs in ${outputDirectory}`,
);
