import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { gzipSync } from "node:zlib";
import {
  compare,
  entryAssets,
  REVIEW_GROWTH_BYTES,
  snapshot,
} from "./emitted-js-budget.mjs";

function tempBuild() {
  const root = mkdtempSync(join(tmpdir(), "clack-js-gzip9-"));
  mkdirSync(join(root, "assets"));
  return {
    root,
    write(file, data) {
      writeFileSync(join(root, file), data);
    },
    close() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

function fixture() {
  const build = tempBuild();
  build.write("index.html", [
    '<script type="module" src="/assets/main-A.js"></script>',
    '<link rel="modulepreload" crossorigin href="/assets/vendor-C.js">',
    '<link rel="modulepreload" href="/assets/vendor-C.js">',
  ].join("\n"));
  build.write("settings.html", '<script type="module" src="/assets/settings-B.js"></script>');
  build.write("assets/main-A.js",
    'import{a}from"./vendor-C.js";import("./lazy-D.js");export{a};');
  build.write("assets/settings-B.js", 'import"./vendor-C.js";');
  build.write("assets/vendor-C.js", "export const a = 3;");
  build.write("assets/lazy-D.js", "export const lazy = 'dormant';");
  return build;
}

test("emitted gzip audit counts every JS separately but excludes lazy chunks from eager HTML graph", () => {
  const b = fixture();
  try {
    const s = snapshot(b.root, { sourceSha: "example" });
    const js = ["main-A.js", "settings-B.js", "vendor-C.js", "lazy-D.js"];
    const expected = js.reduce((n, file) => {
      const contents = {
        "main-A.js": 'import{a}from"./vendor-C.js";import("./lazy-D.js");export{a};',
        "settings-B.js": 'import"./vendor-C.js";',
        "vendor-C.js": "export const a = 3;",
        "lazy-D.js": "export const lazy = 'dormant';",
      }[file];
      return n + gzipSync(contents, { level: 9 }).length;
    }, 0);
    assert.equal(s.totalJsGzip9Bytes, expected);
    assert.equal(s.fileCount, 4);
    assert.deepEqual(s.entries["index.html"].preloadedAssets, ["main-A.js", "vendor-C.js"]);
    assert.deepEqual(s.entries["index.html"].staticClosureAssets, ["main-A.js", "vendor-C.js"]);
    assert.deepEqual(s.entries["settings.html"].staticClosureAssets, ["settings-B.js", "vendor-C.js"]);
    assert(!s.entries["index.html"].staticClosureAssets.includes("lazy-D.js"));
  } finally {
    b.close();
  }
});

test("recursively discovers otherwise unpreloaded static JS dependencies", () => {
  const b = fixture();
  try {
    b.write("assets/main-A.js", 'import"./lazy-D.js";');
    const s = snapshot(b.root);
    assert.deepEqual(s.entries["index.html"].staticClosureAssets,
      ["lazy-D.js", "main-A.js", "vendor-C.js"]);
  } finally {
    b.close();
  }
});

test("rejects missing and path-escaping emitted assets", () => {
  const b = fixture();
  try {
    b.write("assets/main-A.js", 'import"./not-present.js";');
    assert.throws(() => snapshot(b.root), /Broken static import/);
    b.write("assets/main-A.js", 'import"../secret.js";');
    assert.throws(() => snapshot(b.root), /Invalid emitted asset path|Unexpected\/unsafe asset path/);
    assert.throws(() => entryAssets('<script type="module" src="/assets/../../secret.js"></script>'),
      /Invalid emitted asset path|Unexpected\/unsafe asset path/);
  } finally {
    b.close();
  }
});

test("10,000 bytes is permitted; 10,001 requires explicit performance review", () => {
  const b = fixture();
  try {
    const base = snapshot(b.root, { sourceSha: "base" });
    const atLimit = structuredClone(base);
    atLimit.sourceSha = "candidate";
    atLimit.totalJsGzip9Bytes += REVIEW_GROWTH_BYTES;
    assert.equal(compare(base, atLimit).growthReviewRequired, false);
    assert.equal(compare(base, atLimit).reviewRequired, false);
    const overLimit = structuredClone(atLimit);
    overLimit.totalJsGzip9Bytes += 1;
    const result = compare(base, overLimit);
    assert.equal(result.growthBytes, REVIEW_GROWTH_BYTES + 1);
    assert.equal(result.growthReviewRequired, true);
    assert.equal(result.reviewRequired, true);
    const eagerOnly = structuredClone(base);
    eagerOnly.entries["index.html"].preloadGzip9Bytes += REVIEW_GROWTH_BYTES + 1;
    assert.equal(compare(base, eagerOnly).growthReviewRequired, false);
    assert.equal(compare(base, eagerOnly).eagerReviewRequired, true);
    assert.equal(compare(base, eagerOnly).reviewRequired, true);
    assert.throws(() => compare({ ...base, nodeVersion: "v999" }, overLimit),
      /equivalent Node, OS and target/);
  } finally {
    b.close();
  }
});
