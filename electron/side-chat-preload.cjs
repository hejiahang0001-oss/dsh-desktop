const installSideChatSurface = () => {
  if (!document.head || !document.body || document.getElementById('dsh-side-chat-banner')) return;
  const style = document.createElement('style');
  style.id = 'dsh-side-chat-style';
  style.textContent = `
    [class*="_sidebarCol"], [class*="_detailsCol"], [data-side="sidebar"], [data-side="details"] { display: none !important; }
    [class*="_frame"] { grid-template-columns: minmax(0, 1fr) !important; padding-top: 36px !important; box-sizing: border-box !important; }
    #dsh-side-chat-banner {
      position: fixed; inset: 0 0 auto 0; z-index: 2147483647; height: 36px;
      box-sizing: border-box; display: flex; align-items: center; justify-content: center;
      padding: 0 14px; color: #d8e4ff; background: #171b24;
      border-bottom: 1px solid #34415a; font: 600 12px/1 system-ui, sans-serif;
      letter-spacing: .01em; pointer-events: none;
    }
    @media (forced-colors: active) { #dsh-side-chat-banner { border-bottom: 1px solid CanvasText; } }
  `;
  const banner = document.createElement('aside');
  banner.id = 'dsh-side-chat-banner';
  banner.setAttribute('role', 'status');
  banner.textContent = 'Side Chat · 独立会话 · Workspace Write / Ask · 修改代码请使用隔离工作树';
  document.head.append(style);
  document.body.append(banner);
};

window.addEventListener('DOMContentLoaded', installSideChatSurface, { once: true });
