/** Disposable WebView-only receipt collector. No provider/model functionality. */
import assert from "node:assert/strict";
import { appendFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { createR5bReceiptHandler } from "./r5c-receipt-boundary.mjs";

const [root, expectedOrigin] = process.argv.slice(2);
assert(root && /^http:\/\/127\.0\.0\.1:\d+$/.test(expectedOrigin));
let base = "";
const accepted = new Set(["kind", "browser", "eventAcks", "sensitiveEventRejected", "sensitiveReportRejected"]);
const handler = createR5bReceiptHandler({
  root,
  configuration: () => ({ events: base + "/events", report: base + "/report", syntheticOnly: true }),
  onReport: async report => {
    assert(report && typeof report === "object" && !Array.isArray(report));
    assert(Object.keys(report).every(key => accepted.has(key)), "Unredacted final report");
    assert.equal(report.kind, "r5e-browser-smoke");
    assert.equal(report.browser, true);
    assert.equal(report.eventAcks, 3);
    assert.equal(report.sensitiveEventRejected, true);
    assert.equal(report.sensitiveReportRejected, true);
    await writeFile(path.join(root, "redacted-final-report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  },
});
const server = createServer(async (req, res) => {
  const relevant = ["/configuration", "/events", "/report"].includes(req.url);
  if (relevant) {
    // Store only the route, method and safe origin/preflight booleans; never
    // headers, bodies, prompt text, model identity or credentials.
    await appendFile(path.join(root, "redacted-browser-http.jsonl"), JSON.stringify({
      route: req.url,
      method: req.method,
      originMatches: req.headers.origin === expectedOrigin,
      preflightContentType: req.method === "OPTIONS" &&
        req.headers["access-control-request-method"] === "POST" &&
        req.headers["access-control-request-headers"]?.toLowerCase() === "content-type",
    }) + "\n");
  }
  await handler(req, res);
});
server.listen(0, "127.0.0.1", () => {
  base = `http://127.0.0.1:${server.address().port}`;
  process.stdout.write(JSON.stringify({ port: server.address().port }) + "\n");
});
