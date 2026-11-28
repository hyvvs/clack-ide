// Source-matched, cross-platform output audit for the *emitted* Vite bundle.
// This is independent of, and never replaces, the hard @size-limit/file gate.
// npm run build && npm run size && npm run size:report
// node scripts/emitted-js-budget.mjs snapshot --dist dist --out report.json
// node scripts/emitted-js-budget.mjs compare --base before.json --head after.json
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, normalize, resolve, sep } from "node:path";
import { gzipSync } from "node:zlib";
import { pathToFileURL } from "node:url";

export const REVIEW_GROWTH_BYTES = 10_000;
export const SNAPSHOT_VERSION = 1;
const htmlEntries = ["index.html", "settings.html"];
const jsFileName = /^[\w.\-]+\.js$/;
const htmlTag = /<(link|script)\b[^>]*>/gi;
const htmlAttribute = /([\w:-]+)\s*=\s*(["'])(.*?)\2/g;
const staticImport =
  /(?:^|[;\n])\s*(?:import\s*(?!\()[^;"']*?(?:from\s*)?|export\s+[^;"']*?from\s*)["'](\.[^"']+\.js)["']/g;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function fileSha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function withinAssets(specifier, parent = "") {
  const candidate = specifier.startsWith("/assets/")
    ? specifier.slice(1)
    : specifier.startsWith("assets/")
      ? specifier
      : join("assets", dirname(parent), specifier).replaceAll("\\", "/");
  const relative = normalize(candidate).replaceAll("\\", "/");
  assert(relative.startsWith("assets/"), `Invalid emitted asset path: ${specifier}`);
  const name = relative.slice("assets/".length);
  assert(jsFileName.test(name), `Unexpected/unsafe asset path: ${specifier}`);
  return name;
}

function parseAttributes(tag) {
  const attrs = Object.create(null);
  htmlAttribute.lastIndex = 0;
  let match;
  while ((match = htmlAttribute.exec(tag))) attrs[match[1].toLowerCase()] = match[3];
  return attrs;
}

export function entryAssets(html) {
  const found = new Set();
  htmlTag.lastIndex = 0;
  let tag;
  while ((tag = htmlTag.exec(html))) {
    const attrs = parseAttributes(tag[0]);
    const isEntry = tag[1].toLowerCase() === "script" && attrs.type === "module";
    const isPreload = tag[1].toLowerCase() === "link" && attrs.rel === "modulepreload";
    if (isEntry || isPreload) {
      const location = isEntry ? attrs.src : attrs.href;
      assert(typeof location === "string", "Entry/preload without a JS asset");
      found.add(withinAssets(location));
    }
  }
  assert(found.size > 0, "No emitted module scripts/preloads found in HTML");
  return [...found].sort();
}

function importTargets(js) {
  const result = new Set();
  staticImport.lastIndex = 0;
  let match;
  while ((match = staticImport.exec(js))) result.add(match[1]);
  return [...result];
}

/**
 * Calculates independent gzip level-9 sizes (the @size-limit/file contract).
 * HTML modulepreloads and recursively reached static ESM imports are counted
 * separately from the historical *named-chunk* startup subset. Dynamic
 * import() is NOT followed. All paths must resolve inside emitted assets.
 */
export function snapshot(dist, meta = {}) {
  const base = resolve(dist);
  const assetsDir = join(base, "assets");
  const files = readdirSync(assetsDir).filter((f) => f.endsWith(".js")).sort();
  assert(files.length > 0, "Production JS assets missing");
  const fileData = new Map();
  for (const file of files) {
    assert(jsFileName.test(file), `Unsafe emitted JS filename: ${file}`);
    const bytes = readFileSync(join(assetsDir, file));
    fileData.set(file, {
      gzip9Bytes: gzipSync(bytes, { level: 9 }).length,
      rawBytes: bytes.length,
      sha256: fileSha256(bytes),
    });
  }
  const gzipSize = (name) => {
    const item = fileData.get(name);
    assert(item, `Referenced JS not in emitted output: ${name}`);
    return item.gzip9Bytes;
  };
  const entries = {};
  for (const htmlFile of htmlEntries) {
    const html = readFileSync(join(base, htmlFile), "utf8");
    const preload = entryAssets(html);
    const reached = new Set(preload);
    const queue = [...preload];
    while (queue.length) {
      const name = queue.pop();
      const js = readFileSync(join(assetsDir, name), "utf8");
      for (const spec of importTargets(js)) {
        const child = withinAssets(spec, name);
        assert(fileData.has(child), `Broken static import: ${name} → ${child}`);
        if (!reached.has(child)) {
          reached.add(child);
          queue.push(child);
        }
      }
    }
    const closure = [...reached].sort();
    entries[htmlFile] = {
      preloadAssetCount: preload.length,
      preloadGzip9Bytes: preload.reduce((total, file) => total + gzipSize(file), 0),
      staticClosureCount: closure.length,
      staticClosureGzip9Bytes: closure.reduce((total, file) => total + gzipSize(file), 0),
      // Keep names so a regression can be independently inspected or bisected.
      preloadedAssets: preload,
      staticClosureAssets: closure,
    };
  }
  const namedStartup = files.filter((f) =>
    /^(main|react|radix|alert-dialog|xterm)-.*\.js$/.test(f)
  );
  const output = {
    schemaVersion: SNAPSHOT_VERSION,
    sourceSha: meta.sourceSha ?? "unknown",
    nodeVersion: process.version,
    platform: process.platform,
    // Deployment/target settings affect emitted bytes and must be comparable.
    tauriEnvPlatform: process.env.TAURI_ENV_PLATFORM ?? "",
    fileCount: files.length,
    totalJsGzip9Bytes: files.reduce((total, f) => total + gzipSize(f), 0),
    namedStartupGzip9Bytes: namedStartup.reduce((total, f) => total + gzipSize(f), 0),
    entries,
    files: Object.fromEntries([...fileData]),
  };
  return output;
}

/** A review trigger, not permission to inflate an absolute hard ceiling. */
export function compare(base, head, threshold = REVIEW_GROWTH_BYTES) {
  assert(base.schemaVersion === SNAPSHOT_VERSION && head.schemaVersion === SNAPSHOT_VERSION,
    "Incompatible gzip9 snapshot versions");
  assert(base.nodeVersion === head.nodeVersion && base.platform === head.platform &&
    base.tauriEnvPlatform === head.tauriEnvPlatform,
  "Base/head must be built with equivalent Node, OS and target settings");
  assert(Number.isSafeInteger(threshold) && threshold >= 0, "Invalid growth threshold");
  const growth = head.totalJsGzip9Bytes - base.totalJsGzip9Bytes;
  const entries = {};
  for (const name of htmlEntries) {
    assert(base.entries[name] && head.entries[name], `Missing graph entry: ${name}`);
    entries[name] = {
      baselinePreloadGzip9Bytes: base.entries[name].preloadGzip9Bytes,
      headPreloadGzip9Bytes: head.entries[name].preloadGzip9Bytes,
      preloadGrowthBytes: head.entries[name].preloadGzip9Bytes - base.entries[name].preloadGzip9Bytes,
      baselineStaticClosureGzip9Bytes: base.entries[name].staticClosureGzip9Bytes,
      headStaticClosureGzip9Bytes: head.entries[name].staticClosureGzip9Bytes,
      staticClosureGrowthBytes:
        head.entries[name].staticClosureGzip9Bytes - base.entries[name].staticClosureGzip9Bytes,
    };
  }
  const eagerReviewRequired = Object.values(entries).some((entry) =>
    entry.preloadGrowthBytes > threshold || entry.staticClosureGrowthBytes > threshold
  );
  return {
    baseSha: base.sourceSha,
    headSha: head.sourceSha,
    baseTotalGzip9Bytes: base.totalJsGzip9Bytes,
    headTotalGzip9Bytes: head.totalJsGzip9Bytes,
    growthBytes: growth,
    maxGrowthWithoutReviewBytes: threshold,
    growthReviewRequired: growth > threshold,
    eagerReviewRequired,
    reviewRequired: growth > threshold || eagerReviewRequired,
    entries,
  };
}

function argsToObject(args) {
  const [action, ...rest] = args;
  const flags = Object.create(null);
  assert(action === "snapshot" || action === "compare", "Use snapshot or compare");
  assert(rest.length % 2 === 0, "Expected --flag value pairs");
  for (let i = 0; i < rest.length; i += 2) {
    assert(/^--[\w-]+$/.test(rest[i]), `Unexpected argument ${rest[i]}`);
    assert(!Object.hasOwn(flags, rest[i]), `Repeated flag ${rest[i]}`);
    flags[rest[i]] = rest[i + 1];
  }
  return { action, flags };
}

function run() {
  const { action, flags } = argsToObject(process.argv.slice(2));
  if (action === "snapshot") {
    const result = snapshot(flags["--dist"] ?? "dist", {
      sourceSha: flags["--source-sha"] ?? process.env.GITHUB_SHA ?? "unknown",
    });
    if (flags["--out"]) writeFileSync(flags["--out"], JSON.stringify(result, null, 2) + "\n");
    console.log(JSON.stringify({
      sourceSha: result.sourceSha,
      totalJsGzip9Bytes: result.totalJsGzip9Bytes,
      namedStartupGzip9Bytes: result.namedStartupGzip9Bytes,
      mainWindowPreloadGzip9Bytes: result.entries["index.html"].preloadGzip9Bytes,
      mainWindowStaticClosureGzip9Bytes: result.entries["index.html"].staticClosureGzip9Bytes,
      settingsPreloadGzip9Bytes: result.entries["settings.html"].preloadGzip9Bytes,
    }, null, 2));
  } else {
    assert(flags["--base"] && flags["--head"], "compare requires --base and --head");
    const result = compare(
      JSON.parse(readFileSync(flags["--base"], "utf8")),
      JSON.parse(readFileSync(flags["--head"], "utf8")),
      flags["--max-growth"] === undefined ? REVIEW_GROWTH_BYTES : Number(flags["--max-growth"])
    );
    if (flags["--out"]) writeFileSync(flags["--out"], JSON.stringify(result, null, 2) + "\n");
    console.log(JSON.stringify(result, null, 2));
    const summary = [
      "### Emitted JS gzip9 growth review",
      `Base: \`${result.baseSha}\`; head: \`${result.headSha}\``,
      `Total baseline ${result.baseTotalGzip9Bytes} B; PR ${result.headTotalGzip9Bytes} B; delta ${result.growthBytes} B; review trigger >${result.maxGrowthWithoutReviewBytes} B`,
      `Main-window preload gzip9 delta ${result.entries["index.html"].preloadGrowthBytes} B; recursive static closure delta ${result.entries["index.html"].staticClosureGrowthBytes} B`,
      `Settings preload gzip9 delta ${result.entries["settings.html"].preloadGrowthBytes} B; recursive static closure delta ${result.entries["settings.html"].staticClosureGrowthBytes} B`,
      "The 540 KB hard gate still measures its historical named startup subset. HTML modulepreloads/static closure are additional measurements, NOT a substitute.",
      result.reviewRequired
        ? "**REVIEW_REQUIRED:** Total emitted JS or a window's actual eager graph grew beyond the review threshold. Obtain explicit human performance review and reduce/justify growth before CI sign-off."
        : "Total and eager-graph growth review triggers: PASS. Absolute size-limit gates remain independent.",
    ].join("\n\n") + "\n";
    if (process.env.GITHUB_STEP_SUMMARY) {
      writeFileSync(process.env.GITHUB_STEP_SUMMARY, summary, { flag: "a" });
    }
    if (result.reviewRequired) {
      console.error("PERFORMANCE_GROWTH_REVIEW_REQUIRED");
      process.exitCode = 2;
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    run();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
