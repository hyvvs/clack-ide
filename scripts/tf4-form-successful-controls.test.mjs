// Execute the actual fixed native FORM capture function under a minimal,
// deliberately inert DOM contract. No page script, browser, TLS or server.
// The real WebView2 original-node physical probe remains a separate gate.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const hostSource = readFileSync(
  new URL('../src-tauri/src/bin/clack-browser-host.rs', import.meta.url), 'utf8',
);
const source = hostSource.match(
  /const DOM_EXACT_FORM_CAPTURE_JS: &str = r#"([\s\S]*?)"#;/,
)?.[1];
assert.ok(source, 'actual native fixed FORM capture must remain present');

function harness() {
  const document = {
    characterSet: 'UTF-8',
    location: { href: 'https://example.org/form' },
  };
  const form = {
    tagName: 'FORM',
    isConnected: true,
    ownerDocument: document,
    isContentEditable: false,
    action: 'https://example.org/submit',
    method: 'post',
    enctype: 'application/x-www-form-urlencoded',
    target: '_self',
    acceptCharset: 'UTF-8',
    elements: [],
    contains: () => true,
    hasAttribute: (name) => name === 'action',
  };
  const control = (tagName, type, name, value, extra = {}) => ({
    tagName, type, name, value,
    form, ownerDocument: document,
    isConnected: true,
    isContentEditable: false,
    checked: false,
    disabled: false,
    wrap: 'soft',
    hasAttribute: () => false,
    getAttribute: () => null,
    getClientRects: () => [{}],
    matches: () => false,
    ...extra,
  });
  const input = (type, name, value, extra) =>
    control('INPUT', type, name, value, extra);
  const submit = (name = 'commit', value = 'send') =>
    control('BUTTON', 'submit', name, value);
  const option = (parentElement, value, selected = true, disabled = false) => ({
    parentElement, ownerDocument: document, value, selected, disabled,
  });
  const original = submit();
  const state = { changed: false };
  const observer = { takeRecords: () => [] };
  const nodes = [original, form];
  const capture = runInNewContext('(' + source + ')', {
    URL, URLSearchParams, document,
  });
  const preview = () => capture.call({ observer, state, nodes }, 0, 1);
  form.elements = [input('hidden', 'flow', 'owned'), original];
  return { document, form, original, nodes, state, preview, input, control, option, submit };
}

test('retained original FORM serializes ordered duplicates, CRLF textarea, options and named submitter', () => {
  const h = harness();
  const textarea = h.control('TEXTAREA', 'textarea', 'message', 'a\nb\rc\r\nd');
  const selection = h.control('SELECT', 'select-multiple', 'choice', '', { options: [] });
  const group = { tagName: 'OPTGROUP', disabled: false, parentElement: selection };
  selection.options = [
    h.option(selection, 'first'),
    h.option(group, 'second'),
    h.option(selection, 'disabled-option', true, true),
    h.option(selection, 'not-selected', false),
  ];
  h.form.elements = [
    h.input('hidden', 'flow', 'owned'),
    h.input('text', 'same', '1'),
    h.input('text', 'same', '2'),
    textarea,
    h.input('checkbox', 'agree', 'on', { checked: false }),
    h.input('checkbox', 'agree', 'yes', { checked: true }),
    h.input('radio', 'color', 'red', { checked: false }),
    h.input('radio', 'color', 'blue', { checked: true }),
    selection,
    h.input('text', 'disabled', 'omitted', {
      matches: (selector) => selector === ':disabled',
    }),
    h.input('text', '', 'unnamed'),
    h.submit('other', 'skip'),
    h.original,
  ];
  const intent = h.preview();
  const expected = new URLSearchParams([
    ['flow', 'owned'],
    ['same', '1'],
    ['same', '2'],
    ['message', 'a\r\nb\r\nc\r\nd'],
    ['agree', 'yes'],
    ['color', 'blue'],
    ['choice', 'first'],
    ['choice', 'second'],
    ['commit', 'send'],
  ]).toString();
  assert.equal(intent?.body, expected);
  assert.equal(intent?.method, 'POST');
  assert.equal(intent?.destination, 'https://example.org/submit');
  assert.equal(h.preview()?.body, expected, 'immediate recapture is byte identical');
});

test('changed original values, selected options, enabled state and submitter fail pre/post intent equality', () => {
  const h = harness();
  const text = h.input('text', 'q', 'initial');
  const choice = h.control('SELECT', 'select-one', 'country', '', { options: [] });
  choice.options = [h.option(choice, 'a', true), h.option(choice, 'b', false)];
  const disabled = h.input('text', 'flag', 'now-enabled', {
    matches: () => true,
  });
  h.form.elements = [text, choice, disabled, h.original];
  const before = h.preview()?.body;
  assert.ok(before);
  text.value = 'changed';
  assert.notEqual(h.preview()?.body, before);
  text.value = 'initial';
  choice.options[0].selected = false;
  choice.options[1].selected = true;
  assert.notEqual(h.preview()?.body, before);
  choice.options[0].selected = true;
  choice.options[1].selected = false;
  disabled.matches = () => false;
  assert.notEqual(h.preview()?.body, before);
  disabled.matches = () => true;
  h.original.value = 'changed-submit';
  assert.notEqual(h.preview()?.body, before);
  h.original.value = 'send';
  h.form.action = 'https://example.org/other';
  assert.notEqual(h.preview()?.destination, 'https://example.org/submit');
});

test('original node replacement, stale observer, external form owner and unsupported semantics fail closed', () => {
  const h = harness();
  assert.ok(h.preview());
  h.nodes[0] = h.submit();
  assert.equal(h.preview(), null, 'replacing retained submitter is not an alias');
  h.nodes[0] = h.original;
  h.state.changed = true;
  assert.equal(h.preview(), null, 'stale observation never recaptures');
  h.state.changed = false;
  const foreign = h.input('text', 'foreign', 'x', { form: {} });
  h.form.elements = [foreign, h.original];
  assert.equal(h.preview(), null);
  for (const type of ['password', 'file', 'date', 'image']) {
    h.form.elements = [h.input(type, 'value', 'x'), h.original];
    assert.equal(h.preview(), null, `unsupported ${type}`);
  }
  h.form.elements = [h.input('text', 'api_key', 'synthetic-secret'), h.original];
  assert.equal(h.preview(), null, 'credential-like text field needs separate authority');
  h.form.elements = [h.input('hidden', 'csrf_token', 'synthetic-secret'), h.original];
  assert.equal(h.preview(), null, 'hidden credential-like token also requires separate authority');
  h.form.elements = [h.input('text', 'normal', 'x', {
    getAttribute: (name) => name === 'autocomplete' ? 'current-password' : null,
  }), h.original];
  assert.equal(h.preview(), null);
});

test('ambiguous encoding, destination, controls, lines and counts fail closed', () => {
  const h = harness();
  h.form.elements = [h.input('text', 'q', 'safe'), h.original];
  assert.ok(h.preview());
  h.form.enctype = 'multipart/form-data';
  assert.equal(h.preview(), null);
  h.form.enctype = 'application/x-www-form-urlencoded';
  h.document.characterSet = 'windows-1252';
  assert.equal(h.preview(), null);
  h.document.characterSet = 'UTF-8';
  h.form.action = 'https://example.net/submit';
  assert.equal(h.preview(), null);
  h.form.action = 'https://example.org/submit?query=1';
  assert.equal(h.preview(), null);
  h.form.action = 'https://example.org/submit';
  h.form.elements[0].value = 'bad\nline';
  assert.equal(h.preview(), null);
  h.form.elements = [h.control('TEXTAREA', 'textarea', 'body', 'text', {
    wrap: 'hard',
  }), h.original];
  assert.equal(h.preview(), null);
  h.form.elements = Array.from({ length: 17 }, (_, i) =>
    h.input('text', 'v', String(i))).concat(h.original);
  assert.equal(h.preview(), null, 'bounded control count');
});

test('native preview has no submission or model-visible secret transport', () => {
  for (const prohibited of [
    'requestSubmit(', 'form.submit(', 'fetch(', 'XMLHttpRequest',
    'sendBeacon', 'document.cookie', 'localStorage', 'new FormData(',
    'querySelector', 'getElementById',
  ]) assert.equal(source.includes(prohibited), false, prohibited);
});
