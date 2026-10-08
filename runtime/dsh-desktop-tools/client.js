// Browser half of the fixed desktop plugin; no private Harness imports or UI clone.
window.__ModuleLoader__.load({
  id: 'dsh-desktop-tools',
  factory: () => ({
    inject: ['sidebarRight', 'sessions'],
    apply(ctx) {
      ctx.effect(() => {
        let live = true;
        let request = 0;
        const mainSession = (expectedSessionId) => {
          const selected = ctx.sessions.list.getSnapshot();
          if (!live || !expectedSessionId || selected.phase !== 'ready') return null;
          // alpha.1 owns a single public selection. alpha.2 instead exposes
          // source-labelled live bindings; the desktop must supply the target.
          if (Object.prototype.hasOwnProperty.call(selected, 'current')) {
            return selected.current === expectedSessionId && !selected.currentAddress
              ? { sessionId: expectedSessionId, binding: undefined } : null;
          }
          const row = selected.byId?.[expectedSessionId];
          if (row?.id !== expectedSessionId || !(row.retainedBy?.mainView > 0)) return null;
          // A navigation transition can temporarily retain two main views.
          if (Object.values(selected.byId).some(other => other.id !== expectedSessionId
            && other.retainedBy?.mainView > 0)) return null;
          const binding = ctx.sessions.binding?.(expectedSessionId);
          const state = binding?.session?.getSnapshot();
          if (binding?.sessionId !== expectedSessionId || state?.sessionId !== expectedSessionId
            || state.openState !== 'open' || state.removed || state.subagent) return null;
          return { sessionId: expectedSessionId, binding };
        };
        const bridge = Object.freeze({
          openTerminal(expectedSessionId) {
            if (!mainSession(expectedSessionId)) {
              throw new Error('请先选择已就绪的主会话，再打开官方终端。');
            }
            ctx.sidebarRight.openTab('terminal');
            return true;
          },
          async openFile(path, workspacePath) {
            const id = ++request;
            const catalog = ctx.sessions.list.getSnapshot();
            let sessionId = catalog.current;
            if (!Object.prototype.hasOwnProperty.call(catalog, 'current')) {
              const diagnostic = await window.desktopAPI?.diagnostics?.getState();
              sessionId = diagnostic?.workspaceSync?.status === 'synced'
                ? diagnostic.workspaceSync.sessionId : undefined;
            }
            const selected = mainSession(sessionId);
            if (!selected) {
              throw new Error('请先选择已就绪的主会话，再打开工作区文件。');
            }
            if (id !== request) throw new Error('会话或打开请求已变化，请重试。');
            if (!window.desktopAPI?.files?.resolvePreview) throw new Error('桌面文件入口尚未就绪。');
            const result = await window.desktopAPI.files.resolvePreview({ path, workspacePath, sessionId });
            const current = mainSession(sessionId);
            if (id !== request || !current || current.binding !== selected.binding) {
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
