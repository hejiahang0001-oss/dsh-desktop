// Browser half of the fixed desktop plugin; no private Harness imports or UI clone.
window.__ModuleLoader__.load({
  id: 'dsh-desktop-tools',
  factory: () => ({
    inject: ['sidebarRight', 'sessions'],
    apply(ctx) {
      ctx.effect(() => {
        let live = true;
        let request = 0;
        const bridge = Object.freeze({
          async openFile(path, workspacePath) {
            const selected = ctx.sessions.list.getSnapshot();
            if (!selected.current || selected.currentAddress || selected.phase !== 'ready') {
              throw new Error('请先选择已就绪的主会话，再打开工作区文件。');
            }
            if (!window.desktopAPI?.files?.resolvePreview) throw new Error('桌面文件入口尚未就绪。');
            const id = ++request;
            const sessionId = selected.current;
            const result = await window.desktopAPI.files.resolvePreview({ path, workspacePath, sessionId });
            const current = ctx.sessions.list.getSnapshot();
            if (!live || id !== request || current.current !== sessionId || current.currentAddress || current.phase !== 'ready') {
              throw new Error('会话或打开请求已变化，请重试。');
            }
            if (!result?.available) throw new Error(result?.message || '文件当前无法安全打开。');
            if (result.sessionId !== sessionId || typeof result.address !== 'string'
              || !result.address.startsWith(`dsh-resource://file/session/${sessionId}/`)) {
              throw new Error('文件预览身份不一致，未打开文件。');
            }
            ctx.sidebarRight.openResource(result.address);
            return true;
          }
        });
        window.__DSH_OFFICIAL_FILES__ = bridge;
        return () => {
          live = false;
          request += 1;
          if (window.__DSH_OFFICIAL_FILES__ === bridge) delete window.__DSH_OFFICIAL_FILES__;
        };
      }, 'desktop: official file-preview navigation');
    }
  })
});
