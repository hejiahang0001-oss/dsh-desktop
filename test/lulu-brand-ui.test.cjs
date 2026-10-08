const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const pages = ['harness-status', 'workbench-dock', 'terminal', 'context-sources', 'plugin-health',
  'office-center', 'wiki-center', 'worktrees', 'git-delivery', 'tasks-subagents'];

test('lulu display theme is connected to every packaged local surface without widening its CSP', () => {
  const files = JSON.parse(read('package.json')).build.files;
  for (const page of pages) {
    const html = read(`${page}.html`);
    assert.match(html, /<html[^>]+data-lulu-surface=/, page);
    assert.match(html, /<title>[^<]*lulu/i, page);
    assert.ok(html.indexOf('assets/lulu-tokens.css') < html.indexOf('assets/lulu-surfaces.css'), page);
    assert.match(html, /script-src 'self'/, page);
    const scriptPolicy = html.match(/script-src ([^;"<]+)/)?.[1];
    assert.equal(scriptPolicy, "'self'", page);
    assert.doesNotMatch(html, /unsafe-eval|https:\/\//, page);
    assert.ok(files.includes(`${page}.html`), page);
  }
  for (const file of ['assets/lulu-tokens.css', 'assets/lulu-surfaces.css', 'assets/lulu-harness-theme.css',
    'assets/lulu/mascot.png', 'assets/lulu/SOURCE.md']) assert.ok(files.includes(file), file);
});

test('mascot is the user-selected sourced character with original bytes and explicit provenance', () => {
  const png = fs.readFileSync(path.join(root, 'assets/lulu/mascot.png'));
  assert.equal(crypto.createHash('sha256').update(png).digest('hex'), '17688f54123d13cb33d6f309c19a5310543dfe9c43a53eec86affa76cf40c318');
  assert.match(read('assets/lulu/SOURCE.md'), /7560638679044361518/);
  assert.match(read('assets/lulu/SOURCE.md'), /授权.*未|没有取得授权/);
  const icon = fs.readFileSync(path.join(root, 'build/icon.ico'));
  assert.equal(icon.readUInt16LE(2), 1);
  assert.equal(icon.readUInt16LE(4), 9);
});

test('official lulu theme is CSS-only and maps official tokens without overriding controls', () => {
  const css = read('assets/lulu-harness-theme.css');
  assert.match(css, /html body\[data-ds-dark-theme\]/);
  assert.match(css, /html body:not\(\[data-ds-dark-theme\]\)/);
  assert.match(css, /--dsw-specific-input-major:/);
  assert.doesNotMatch(css, /!important|(?:^|[;{])\s*(?:display|position|pointer-events)\s*:|url\(/m);
  assert.match(css, /svg\[aria-hidden="true"\]\[viewBox="0 0 23\.16 17\.04"\]/);
  assert.match(css, /:has\(> div\[data-slot\] > svg/); // SlotOutlet uses display:contents; paint the outer mark.
  const main = read('electron/main.cjs');
  const sideChat = main.slice(main.indexOf('const createSideChatHarnessWindow'), main.indexOf('const createSideChatHarnessWindow') + 7000);
  assert.match(sideChat, /did-finish-load[\s\S]*loadLuluThemeCss/);
  assert.doesNotMatch(sideChat, /installWorkbenchPanel|assets\.commandScript/);
});

test('lulu key text and action color pairs retain WCAG AA contrast in light and dark themes', () => {
  const luminance = (hex) => {
    const channels = hex.match(/[a-f\d]{2}/gi).map((part) => parseInt(part, 16) / 255)
      .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
  };
  for (const [text, bg] of [
    ['302a23', 'f7f3eb'], ['706456', 'fffdf8'], ['ffffff', '985010'],
    ['f4ede1', '201e1a'], ['c3b8a7', '28251f'], ['302313', 'ffc078'],
    ['655b4d', 'fffdf8'], ['766a59', 'fffdf8'], ['c7baaa', '201e1a'], ['b5a792', '201e1a']
  ]) {
    const a = luminance(text); const b = luminance(bg);
    assert.ok((Math.max(a, b) + .05) / (Math.min(a, b) + .05) >= 4.5, `${text} on ${bg}`);
  }
  const css = read('assets/lulu-tokens.css');
  assert.match(css, /html:not\(\[data-lulu-surface\]\) body:not\(\[data-ds-dark-theme\]\)/);
  assert.match(css, /html \.dsh-network-primary/);
  assert.match(read('assets/lulu-surfaces.css'), /prefers-reduced-motion: reduce/);
  assert.match(css, /forced-colors: active/);
});
