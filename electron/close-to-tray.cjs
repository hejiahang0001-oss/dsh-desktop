'use strict';

// Window close and application quit have different meanings. Only the existing
// safe-quit pipeline may destroy a window or stop its owned background work.
const createCloseToTrayHandler = ({
  getWindow, getTray, canClose, isQuitting, flushDraft,
  restoreWindow, requestQuit, notify, onDraftFailure
}) => {
  let notified = false;
  let pendingFlush = null;
  return (event) => {
    if (canClose()) return;
    event.preventDefault();
    if (isQuitting()) return;
    const window = getWindow();
    if (!window || window.isDestroyed()) return;
    const tray = getTray();
    if (!tray || tray.isDestroyed()) {
      requestQuit('window-close');
      return;
    }

    window.hide();
    if (!notified) {
      notified = true;
      // OS notifications may be disabled; the tray remains the recovery path.
      try {
        notify({ title: 'lulu 已收进托盘', body: '任务会继续运行。点击托盘图标重新打开，右键选择“退出 lulu”才会完全退出。' });
      } catch { /* Optional OS notification, not a lifecycle operation. */ }
    }
    if (!pendingFlush) {
      pendingFlush = Promise.resolve().then(flushDraft).catch(async () => {
        if (canClose() || isQuitting() || getWindow() !== window || window.isDestroyed()) return;
        restoreWindow(window);
        await onDraftFailure(window);
      }).catch(() => {
        // The retained window was restored before attempting error UI.
      }).finally(() => { pendingFlush = null; });
    }
  };
};

module.exports = { createCloseToTrayHandler };
