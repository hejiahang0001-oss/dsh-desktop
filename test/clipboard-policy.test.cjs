const assert = require('node:assert/strict');
const test = require('node:test');
const { isTrustedClipboardWrite } = require('../electron/clipboard-policy.cjs');

test('clipboard policy allows only sanitized writes from the trusted Harness main frame', () => {
  const mainWebContents = { getURL: () => 'http://127.0.0.1:4567/chat' };
  const base = {
    webContents: mainWebContents,
    mainWebContents,
    permission: 'clipboard-sanitized-write',
    requestingUrl: 'http://127.0.0.1:4567/chat',
    harnessOrigin: 'http://127.0.0.1:4567',
    isMainFrame: true
  };
  assert.equal(isTrustedClipboardWrite(base), true);
  assert.equal(isTrustedClipboardWrite({ ...base, permission: 'clipboard-read' }), false);
  assert.equal(isTrustedClipboardWrite({ ...base, requestingUrl: 'http://127.0.0.1:9999' }), false);
  assert.equal(isTrustedClipboardWrite({ ...base, isMainFrame: false }), false);
  assert.equal(isTrustedClipboardWrite({ ...base, webContents: { getURL: mainWebContents.getURL } }), false);
  assert.equal(isTrustedClipboardWrite({ ...base, harnessOrigin: null }), false);
});
