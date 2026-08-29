const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  captureFrameOwner,
  isFrameOwner,
  isTrustedMainFrameEvent
} = require('../electron/ipc-policy.cjs');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const createFixture = () => {
  const mainFrame = { url: 'http://127.0.0.1:43120/', processId: 40, routingId: 7 };
  const webContents = { id: 9, mainFrame, getURL: () => mainFrame.url };
  return {
    mainFrame,
    webContents,
    event: { sender: webContents, senderFrame: mainFrame }
  };
};

test('IPC policy accepts only the expected webContents main frame and exact URL policy', () => {
  const fixture = createFixture();
  const allowedUrl = (url) => url === fixture.mainFrame.url;
  assert.equal(isTrustedMainFrameEvent(fixture.event, fixture.webContents, allowedUrl), true);

  const childFrame = { url: fixture.mainFrame.url, processId: 40, routingId: 8 };
  assert.equal(isTrustedMainFrameEvent({ sender: fixture.webContents, senderFrame: childFrame }, fixture.webContents, allowedUrl), false);
  assert.equal(isTrustedMainFrameEvent({ sender: { ...fixture.webContents, id: 10 }, senderFrame: fixture.mainFrame }, fixture.webContents, allowedUrl), false);
  assert.equal(isTrustedMainFrameEvent(fixture.event, fixture.webContents, () => false), false);
  assert.equal(isTrustedMainFrameEvent({ sender: fixture.webContents }, fixture.webContents, allowedUrl), false);
});

test('terminal owner binding rejects another frame and changes after navigation', () => {
  const fixture = createFixture();
  const owner = captureFrameOwner(fixture.event);
  assert.equal(isFrameOwner(fixture.event, owner), true);
  assert.equal(isFrameOwner({
    sender: fixture.webContents,
    senderFrame: { ...fixture.mainFrame, routingId: 99 }
  }, owner), false);
  assert.equal(isFrameOwner({
    sender: { ...fixture.webContents, id: 10 },
    senderFrame: fixture.mainFrame
  }, owner), false);
  assert.equal(isFrameOwner(fixture.event, null), false);
});

test('every previously unguarded desktop handler now validates its sender', () => {
  const main = read('electron/main.cjs');
  assert.match(main, /const desktopIpcAllowed = \(event\) => isTrustedMainFrameEvent/);
  assert.match(main, /workspace:get-state', \(event\)[\s\S]*?desktopIpcAllowed\(event\)/);
  assert.match(main, /workspace:choose', \(event\)[\s\S]*?desktopIpcAllowed\(event\)/);
  assert.match(main, /diagnostics:get-state', \(event\)[\s\S]*?desktopIpcAllowed\(event\)/);
  assert.match(main, /diagnostics:refresh', \(event\)[\s\S]*?desktopIpcAllowed\(event\)/);
  assert.match(main, /support:export-diagnostics', \(event\)[\s\S]*?desktopIpcAllowed\(event\)/);
  assert.match(main, /support:create-backup', \(event\)[\s\S]*?desktopIpcAllowed\(event\)/);
  assert.match(main, /support:validate-backup', \(event\)[\s\S]*?desktopIpcAllowed\(event\)/);
  assert.match(main, /harness:get-state', \(event\)[\s\S]*?desktopIpcAllowed\(event\)/);
  assert.match(main, /harness:restart', \(event\)[\s\S]*?desktopIpcAllowed\(event\)/);
  assert.match(main, /harness:open-log', async \(event\)[\s\S]*?desktopIpcAllowed\(event\)/);
  assert.match(main, /terminal:write'[\s\S]*?terminalOwnedBy\(event\)/);
  assert.match(main, /terminal:resize'[\s\S]*?terminalOwnedBy\(event\)/);
  assert.match(main, /terminal:stop'[\s\S]*?terminalOwnedBy\(event\)/);
});
