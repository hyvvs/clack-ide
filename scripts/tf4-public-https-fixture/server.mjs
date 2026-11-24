// TF4 independent server-side acceptance oracle. The browser never receives
// the oracle token, filesystem path, synthetic credential, or write receipts.
// No cloud, listener, or TLS authority is created by importing this module.
import { createServer as httpsServer } from 'node:https';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, statSync, writeSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const MAX_BODY = 64 * 1024;
const MAX_EVENTS = 24 * 1024 * 1024;
const NONCE = /^[a-z0-9][a-z0-9-]{14,62}[a-z0-9]$/;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const same = (a, b) => typeof a === 'string' && typeof b === 'string'
  && Buffer.byteLength(a) === Buffer.byteLength(b)
  && timingSafeEqual(Buffer.from(a), Buffer.from(b));

function html(run) {
  // Deliberately fixed document, no external JS, fetch, image, service worker
  // or automatic resource writes. Mutation is an explicit human-run scenario.
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Clack TF4 owned fixture</title></head><body>
<h1>Owned TF4 fixture</h1>
<a id="exact-navigation" href="/case/${run}/next">Navigate to owned next document</a>
<input id="stable-type" type="text" autocomplete="off" maxlength="128" aria-label="Stable type">
<label><input id="stable-check" type="checkbox">Stable check</label>
<select id="stable-select"><option value="a">Alpha</option><option value="b">Beta</option></select>
<div id="stable-scroll" style="height:120px;overflow:auto"><div style="height:500px">Scrollable panel</div></div>
<form id="exact-form" action="/case/${run}/form" method="post" enctype="application/x-www-form-urlencoded">
<input type="hidden" name="nonce" value="${run}"><input type="hidden" name="commit" value="once">
<button id="exact-submitter" type="submit">One write</button></form>
<button id="replace-original" type="button">Replace original submitter</button>
<script>document.getElementById('replace-original').addEventListener('click', () => {
const old = document.getElementById('exact-submitter');
old.replaceWith(old.cloneNode(true));
});</script>
<a id="download" href="/case/${run}/download">Owned download</a>
<a id="delayed" href="/case/${run}/delay/1200">Delayed navigation</a>
<a id="redirect" href="/case/${run}/redirect">Same-origin redirect negative</a>
<a id="cross-redirect" href="/case/${run}/cross-redirect">Cross-origin redirect negative</a>
</body></html>`;
}

function takeBody(req) {
  return new Promise((resolveBody, reject) => {
    const parts = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('body-too-large'), { status: 413 }));
        req.destroy();
      } else {
        parts.push(chunk);
      }
    });
    req.on('end', () => resolveBody(Buffer.concat(parts)));
    req.on('error', reject);
  });
}

export function createFixtureHandler({ root, runNonce, oracleToken, syntheticCredential, crossOrigin }) {
  if (!NONCE.test(runNonce) || !/^[a-f0-9]{64}$/.test(oracleToken)
      || !syntheticCredential || syntheticCredential.length < 24
      || (crossOrigin && (() => {
        try {
          const other = new URL(crossOrigin);
          return other.protocol !== 'https:' || other.pathname !== '/' || other.search
            || other.hash || other.username || other.password || other.port;
        } catch { return true; }
      })())) {
    throw new Error('fixture-configuration-invalid');
  }
  root = resolve(root);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  mkdirSync(join(root, 'claims'), { recursive: true, mode: 0o700 });
  const log = join(root, 'events.jsonl');
  if (!existsSync(log)) {
    const fd = openSync(log, 'wx', 0o600);
    closeSync(fd);
  }
  function logEvent(entry) {
    if (statSync(log).size > MAX_EVENTS) throw new Error('fixture-event-budget-exceeded');
    const fd = openSync(log, 'a', 0o600);
    try {
      writeSync(fd, JSON.stringify({ eventId: randomUUID(), at: new Date().toISOString(), ...entry }) + '\n');
      fsyncSync(fd);
    } finally { closeSync(fd); }
  }
  function respond(res, code, body, contentType = 'text/plain; charset=utf-8', headers = {}) {
    res.writeHead(code, { 'content-type': contentType, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      ...headers });
    res.end(body);
  }
  function reject(res, status, reason) { respond(res, status, reason); }
  return async (req, res) => {
    // Never allow credentials in URLs, never log authorization header values.
    let url;
    try { url = new URL(req.url, 'https://fixture.invalid'); } catch { return reject(res, 400, 'invalid-url'); }
    if (url.search || req.url.length > 512 || req.headers.cookie || req.headers['proxy-authorization']) {
      return reject(res, 400, 'query-cookie-or-proxy-credential-denied');
    }
    if (url.pathname === '/__oracle/receipts' && req.method === 'GET') {
      if (!same(req.headers.authorization, `Bearer ${oracleToken}`)) return reject(res, 403, 'denied');
      // Read-only, non-browser-accessible bearer path; no full token or body.
      const events = readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(x => JSON.parse(x));
      return respond(res, 200, JSON.stringify({ runNonce, events }), 'application/json');
    }
    if (url.pathname === '/' && req.method === 'GET') {
      logEvent({ method: 'GET', path: '/', status: 200, runNonce });
      return respond(res, 200, html(runNonce), 'text/html; charset=utf-8');
    }
    const match = /^\/case\/([a-z0-9-]+)\/(next|form|upload|download|redirect|cross-redirect|credential|delay(?:\/\d{1,5})?)$/.exec(url.pathname);
    if (!match || match[1] !== runNonce || !NONCE.test(match[1])) return reject(res, 404, 'not-found');
    const action = match[2];
    if (action === 'form' || action === 'upload') {
      if (req.method !== 'POST') return reject(res, 405, 'method-denied');
      const allowedContent = action === 'form' ? 'application/x-www-form-urlencoded' : 'application/octet-stream';
      if (req.headers['content-type'] !== allowedContent || req.headers['content-encoding']
          || req.headers['transfer-encoding'] || !Number.isSafeInteger(Number(req.headers['content-length']))
          || Number(req.headers['content-length']) > MAX_BODY
          || Number(req.headers['content-length']) < 1) return reject(res, 415, 'request-shape-denied');
      let body;
      try { body = await takeBody(req); } catch { return reject(res, 413, 'body-denied'); }
      if (body.length !== Number(req.headers['content-length'])) return reject(res, 400, 'length-denied');
      if (action === 'form') {
        const parsed = new URLSearchParams(body.toString('utf8'));
        if (parsed.size !== 2 || parsed.get('nonce') !== runNonce || parsed.get('commit') !== 'once'
            || body.toString('utf8') !== `nonce=${runNonce}&commit=once`) return reject(res, 422, 'body-binding-denied');
      }
      const bodySha256 = sha256(body);
      const claim = join(root, 'claims', `${runNonce}.${action}.claim`);
      let fd;
      try { fd = openSync(claim, 'wx', 0o600); } catch (error) {
        if (error.code === 'EEXIST') {
          logEvent({ runNonce, method: req.method, path: url.pathname, bodySha256, bodyBytes: body.length,
            status: 409, disposition: 'replay-denied' });
          return reject(res, 409, 'replay-denied');
        }
        throw error;
      }
      try { writeSync(fd, Buffer.from(bodySha256)); fsyncSync(fd); } finally { closeSync(fd); }
      // On POSIX, fsync the containing directory as well: a synced *file*
      // alone does not make its new directory entry crash durable.
      // Windows does not expose equivalent directory-handle fsync via Node.
      if (process.platform !== 'win32') {
        const dir = openSync(join(root, 'claims'), 'r');
        try { fsyncSync(dir); } finally { closeSync(dir); }
      }
      logEvent({ runNonce, method: 'POST', path: url.pathname, bodySha256, bodyBytes: body.length,
        status: 201, disposition: 'one-write-accepted' });
      return respond(res, 201, 'accepted');
    }
    if (req.method !== 'GET') return reject(res, 405, 'method-denied');
    if (action === 'credential') {
      const accepted = same(req.headers.authorization, `Bearer ${syntheticCredential}`);
      logEvent({ runNonce, method: 'GET', path: url.pathname, status: accepted ? 200 : 403,
        credentialAccepted: accepted });
      return respond(res, accepted ? 200 : 403, accepted ? 'credential-accepted' : 'credential-denied');
    }
    if (action === 'redirect' || action === 'cross-redirect') {
      const to = action === 'redirect' ? `/case/${runNonce}/next` : crossOrigin;
      if (!to) return reject(res, 404, 'cross-origin-not-configured');
      logEvent({ runNonce, method: 'GET', path: url.pathname, status: 302, redirectDestination: to });
      return respond(res, 302, '', 'text/plain', { location: to });
    }
    if (action.startsWith('delay/')) {
      const ms = Number(action.split('/')[1]);
      if (!Number.isSafeInteger(ms) || ms > 8000) return reject(res, 422, 'delay-bounds-denied');
      await new Promise(resolveDelay => setTimeout(resolveDelay, ms));
    }
    if (action === 'download') {
      const file = Buffer.from('TF4-OWNED-BOUNDED-DOWNLOAD\n');
      logEvent({ runNonce, method: 'GET', path: url.pathname, status: 200, bodySha256: sha256(file),
        bodyBytes: file.length });
      return respond(res, 200, file, 'application/octet-stream',
        { 'content-disposition': 'attachment; filename="tf4-acceptance.txt"' });
    }
    logEvent({ runNonce, method: 'GET', path: url.pathname, status: 200 });
    return respond(res, 200, `<!doctype html><html><body><h1>Owned destination ${runNonce}</h1></body></html>`, 'text/html; charset=utf-8');
  };
}

// Production CLI requires explicitly operator-provided cert/key and TLS443.
// Isolated tests import createFixtureHandler and use loopback HTTP; those
// tests are explicitly NOT production-path, TLS or installed-app acceptance.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const env = process.env;
  const port = Number(env.TF4_FIXTURE_PORT ?? '443');
  const hostname = env.TF4_FIXTURE_BIND;
  if (port !== 443 || !hostname || !env.TF4_FIXTURE_TLS_CERT || !env.TF4_FIXTURE_TLS_KEY
      || !env.TF4_FIXTURE_STATE || !env.TF4_FIXTURE_RUN_NONCE || !env.TF4_FIXTURE_ORACLE_TOKEN
      || !env.TF4_FIXTURE_SYNTHETIC_CREDENTIAL) throw new Error('operator-owned-TLS443-config-required');
  const handler = createFixtureHandler({ root: env.TF4_FIXTURE_STATE, runNonce: env.TF4_FIXTURE_RUN_NONCE,
    oracleToken: env.TF4_FIXTURE_ORACLE_TOKEN, syntheticCredential: env.TF4_FIXTURE_SYNTHETIC_CREDENTIAL,
    crossOrigin: env.TF4_FIXTURE_CROSS_ORIGIN });
  httpsServer({ cert: readFileSync(env.TF4_FIXTURE_TLS_CERT), key: readFileSync(env.TF4_FIXTURE_TLS_KEY),
    minVersion: 'TLSv1.2' }, handler).listen(port, hostname);
}
