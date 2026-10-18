'use strict';

const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createCloseToTrayHandler } = require('./close-to-tray.cjs');
const { restoreAndFocusWindow } = require('./app-lifecycle.cjs');

// Real native controls, programmatically invoked; no Harness, account or network.
async function runCloseToTraySmoke({ BrowserWindow, Tray, Menu, iconPath }) {
  const checks = {}, events = [], quitRequests = [], flushedDrafts = [];
  const draft = `隔离托盘草稿 ${randomUUID()}`;
  let window, tray, isolatedSession, closeHandler, failure;
  let allowQuit = false, quitPending = false, closeEvents = 0, hideEvents = 0;
  let rendererFailure = null, notificationCount = 0, draftFailures = 0;
  const until = async (predicate, label) => {
    const deadline = Date.now() + 5000;
    while (!await predicate()) {
      if (Date.now() >= deadline) throw new Error(`Close-to-tray smoke timeout: ${label}`);
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  };
  const check = (name, condition) => { assert.ok(condition, name); checks[name] = true; };
  const requestQuit = reason => { quitRequests.push(reason); quitPending = true; };
  try {
    window = new BrowserWindow({ width: 520, height: 300, show: false, title: 'DSH isolated close-to-tray smoke',
      webPreferences: { partition: `dsh-close-to-tray-${randomUUID()}`, sandbox: true,
        contextIsolation: true, nodeIntegration: false, webSecurity: true, spellcheck: false } });
    isolatedSession = window.webContents.session;
    check('isolatedMemorySession', isolatedSession.isPersistent() === false);
    isolatedSession.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (_details, callback) => callback({ cancel: true }));
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.webContents.on('render-process-gone', (_event, details) => { rendererFailure = details.reason; });
    window.on('close', () => { closeEvents += 1; events.push('close'); });
    window.on('hide', () => { hideEvents += 1; events.push('hide'); });
    window.on('show', () => events.push('show'));
    window.on('minimize', () => events.push('minimize'));
    window.on('restore', () => events.push('restore'));
    window.on('closed', () => events.push('closed'));
    const windowId = window.id, contentsId = window.webContents.id;
    const readDraft = () => window.webContents.executeJavaScript('document.querySelector("textarea").value');
    closeHandler = createCloseToTrayHandler({
      getWindow: () => window, getTray: () => tray, canClose: () => allowQuit,
      isQuitting: () => quitPending, flushDraft: async () => { flushedDrafts.push(await readDraft()); },
      restoreWindow: restoreAndFocusWindow, requestQuit,
      notify: () => { notificationCount += 1; }, onDraftFailure: async () => { draftFailures += 1; }
    });
    window.on('close', closeHandler);
    tray = new Tray(iconPath);
    tray.setToolTip('DSH isolated close-to-tray smoke');
    const menu = Menu.buildFromTemplate([
      { id: 'restore', label: '打开隔离测试窗口', click: () => restoreAndFocusWindow(window) },
      { id: 'quit', label: '退出隔离测试', click: () => requestQuit('tray-menu') }
    ]);
    tray.setContextMenu(menu);
    const invokeMenu = id => { const item = menu.getMenuItemById(id); item.click(item, window, {}); };
    const close = async () => {
      const previous = closeEvents; window.close();
      await until(() => closeEvents === previous + 1, 'native close event');
      await new Promise(resolve => setImmediate(resolve));
    };
    const restore = async () => {
      invokeMenu('restore');
      await until(() => window.isVisible() && !window.isMinimized() && window.isFocused(), 'menu restore and focus');
      check('sameWindowAndRenderer', window.id === windowId && window.webContents.id === contentsId);
      check('draftRetained', await readDraft() === draft);
    };
    await window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'"><title>Isolated tray smoke</title><textarea aria-label="Synthetic draft"></textarea>'));
    await window.webContents.executeJavaScript(`document.querySelector('textarea').value = ${JSON.stringify(draft)}`);
    const preferences = window.webContents.getLastWebPreferences();
    check('sandboxConfigured', preferences.sandbox === true && preferences.contextIsolation === true && preferences.nodeIntegration === false && preferences.webSecurity === true);
    check('rendererHasNoNode', await window.webContents.executeJavaScript('typeof require === "undefined" && typeof process === "undefined"'));
    restoreAndFocusWindow(window);
    if (!window.isVisible()) restoreAndFocusWindow(window); // Windows may consume the first ShowWindow.
    await until(() => window.isVisible(), 'initial show');
    await close();
    await until(() => !window.isVisible() && flushedDrafts.length === 1, 'ordinary close and draft flush');
    check('ordinaryCloseHidesWithoutDestroy', !window.isDestroyed() && !events.includes('closed') && quitRequests.length === 0);
    await restore();
    check('trayMenuRestores', window.isVisible() && window.isFocused());
    window.minimize();
    await until(() => window.isMinimized(), 'native minimize');
    await close();
    await until(() => !window.isVisible() && flushedDrafts.length === 2, 'minimized close and draft flush');
    check('minimizedCloseRetainsWindow', !window.isDestroyed());
    await restore();
    check('minimizedHiddenWindowRestores', !window.isMinimized() && window.isVisible());
    invokeMenu('quit');
    check('trayExitRequestsSafeQuit', quitPending && quitRequests[0] === 'tray-menu');
    const beforePendingHide = hideEvents;
    await close();
    check('pendingQuitCloseDoesNotHideOrDestroy', window.isVisible() && !window.isDestroyed() && hideEvents === beforePendingHide);
    quitPending = false; // Simulate cancellation of the owner's safe-quit confirmation.
    tray.destroy();
    const beforeMissingHide = hideEvents;
    await close();
    check('missingTrayRequestsSafeQuit', quitRequests.length === 2 && quitRequests[1] === 'window-close');
    check('missingTrayRetainsVisibleWindow', !window.isDestroyed() && window.isVisible() && hideEvents === beforeMissingHide);
    check('draftStillIntactBeforeQuit', await readDraft() === draft && flushedDrafts.every(value => value === draft));
    check('flushAndNotificationPolicy', draftFailures === 0 && flushedDrafts.length === 2 && notificationCount === 1);
    check('rendererRemainedAlive', rendererFailure === null);
    allowQuit = true;
    await close();
    await until(() => window.isDestroyed(), 'confirmed native close');
    check('confirmedQuitActuallyCloses', events.filter(event => event === 'closed').length === 1);
  } catch (error) {
    failure = error?.message || String(error);
  } finally {
    try { if (tray && !tray.isDestroyed()) tray.destroy(); } catch (error) { failure ||= error.message; }
    try {
      if (window && !window.isDestroyed()) {
        if (closeHandler) window.removeListener('close', closeHandler);
        window.destroy();
      }
      if (isolatedSession) {
        isolatedSession.webRequest.onBeforeRequest(null);
        await isolatedSession.clearStorageData();
      }
    } catch (error) { failure ||= error.message; }
    checks.ownedResourcesCleaned = (!tray || tray.isDestroyed()) && (!window || window.isDestroyed());
  }
  return { ok: !failure && checks.ownedResourcesCleaned, checks, events, quitRequests,
    ...(failure ? { error: failure } : {}), syntheticDataOnly: true, networkAccess: false,
    evidence: 'Programmatic native BrowserWindow close/minimize and Tray Menu callbacks with production lifecycle handlers.',
    unverified: ['human mouse clicks on the taskbar tray or titlebar', 'full safe-quit confirmation and Harness shutdown', 'real draft persistence', 'OS notification delivery'] };
}

module.exports = { runCloseToTraySmoke };
