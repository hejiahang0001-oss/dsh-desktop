(() => {
  const root = document.documentElement;
  const liveRegion = document.querySelector('[data-live-status]');
  const themeColor = document.querySelector('meta[name="theme-color"]');

  const syncThemeColor = () => {
    if (themeColor) themeColor.content = root.dataset.uiTheme === 'dark' ? '#0e1117' : '#f5f8fc';
  };

  try {
    const savedTheme = window.localStorage.getItem('dsh-ui-theme');
    if (savedTheme === 'light' || savedTheme === 'dark') root.dataset.uiTheme = savedTheme;
  } catch {
    // Local preview can run without persistent storage.
  }
  syncThemeColor();

  const announce = (message) => {
    if (!liveRegion) return;
    liveRegion.textContent = '';
    window.setTimeout(() => { liveRegion.textContent = message; }, 10);
  };

  document.querySelectorAll('[data-task]').forEach((button) => {
    button.addEventListener('click', () => {
      document.querySelectorAll('[data-task]').forEach((item) => item.removeAttribute('aria-current'));
      button.setAttribute('aria-current', 'page');
      const title = button.querySelector('.task-name')?.textContent?.trim();
      const header = document.querySelector('[data-task-title]');
      if (title && header) header.textContent = title;
      announce(`已切换到项目事项：${title ?? ''}`);
    });
  });

  document.querySelectorAll('[data-tab-target]').forEach((button) => {
    button.addEventListener('click', () => {
      const tabList = button.closest('[role="tablist"]');
      const target = button.dataset.tabTarget;
      tabList?.querySelectorAll('[role="tab"]').forEach((tab) => tab.setAttribute('aria-selected', 'false'));
      button.setAttribute('aria-selected', 'true');
      document.querySelectorAll('[data-tab-panel]').forEach((panel) => {
        panel.hidden = panel.dataset.tabPanel !== target;
      });
    });
  });

  document.querySelectorAll('[data-permission-allow]').forEach((button) => {
    button.addEventListener('click', () => {
      const card = button.closest('.permission-card');
      if (!card) return;
      card.classList.add('approved');
      const title = card.querySelector('.permission-title span');
      const body = card.querySelector('p');
      if (title) title.textContent = button.dataset.approvedTitle || '已允许本次操作';
      if (body) body.textContent = button.dataset.approvedBody || '操作已确认，当前工作继续。';
      card.querySelector('.permission-actions')?.remove();
      announce(button.dataset.approvedTitle || '已允许本次操作');
    });
  });

  document.querySelectorAll('[data-permission-deny]').forEach((button) => {
    button.addEventListener('click', () => {
      const card = button.closest('.permission-card');
      if (!card) return;
      const title = card.querySelector('.permission-title span');
      const body = card.querySelector('p');
      if (title) title.textContent = button.dataset.deniedTitle || '操作已取消';
      if (body) body.textContent = button.dataset.deniedBody || '当前资料未发生变化，可以调整要求后重试。';
      card.querySelector('.permission-actions')?.remove();
      announce(button.dataset.deniedTitle || '操作已取消');
    });
  });

  const form = document.querySelector('[data-composer]');
  const textarea = form?.querySelector('textarea');
  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    const value = textarea?.value.trim();
    if (!value) {
      textarea?.focus();
      announce('请输入补充要求');
      return;
    }
    const stream = document.querySelector('[data-message-stream]');
    if (stream) {
      const wrapper = document.createElement('article');
      wrapper.className = 'message user';
      wrapper.innerHTML = `
        <div class="avatar" aria-hidden="true">你</div>
        <div class="message-content">
          <div class="message-label">你 · 刚刚</div>
          <div class="message-bubble"><p></p></div>
        </div>`;
      const paragraph = wrapper.querySelector('p');
      if (paragraph) paragraph.textContent = value;
      stream.append(wrapper);
      const agent = document.createElement('article');
      agent.className = 'message';
      agent.innerHTML = `
        <div class="avatar agent" aria-hidden="true">DSH</div>
        <div class="message-content">
          <div class="message-label">DSH ERP Advisor · 正在分析</div>
          <div class="message-bubble"><p>已收到补充要求，正在关联项目证据、业务差异与当前交付物。</p></div>
        </div>`;
      stream.append(agent);
      wrapper.scrollIntoView({ block: 'end', behavior: 'smooth' });
    }
    if (textarea) textarea.value = '';
    announce('补充要求已加入当前项目');
  });

  const overlay = document.querySelector('[data-command-overlay]');
  const commandInput = overlay?.querySelector('input');
  let previousFocus = null;
  const openPalette = () => {
    if (!overlay) return;
    previousFocus = document.activeElement;
    overlay.hidden = false;
    window.setTimeout(() => commandInput?.focus(), 10);
  };
  const closePalette = () => {
    if (!overlay) return;
    overlay.hidden = true;
    if (previousFocus instanceof HTMLElement) previousFocus.focus();
  };

  overlay?.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    const focusable = [...overlay.querySelectorAll('button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')]
      .filter((element) => !element.hidden);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  document.querySelectorAll('[data-open-command]').forEach((button) => button.addEventListener('click', openPalette));
  overlay?.addEventListener('click', (event) => {
    if (event.target === overlay) closePalette();
  });
  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      overlay?.hidden ? openPalette() : closePalette();
    }
    if (event.key === 'Escape' && overlay && !overlay.hidden) closePalette();
  });

  commandInput?.addEventListener('input', () => {
    const query = commandInput.value.trim().toLowerCase();
    overlay?.querySelectorAll('[data-command-item]').forEach((item) => {
      item.hidden = query !== '' && !item.textContent.toLowerCase().includes(query);
    });
  });

  overlay?.querySelectorAll('[data-command-item]').forEach((item) => {
    item.addEventListener('click', () => {
      announce(`已选择命令：${item.textContent.trim()}`);
      closePalette();
    });
  });

  document.querySelectorAll('[data-toggle-theme]').forEach((button) => {
    button.setAttribute('aria-label', root.dataset.uiTheme === 'dark' ? '切换到浅色外观' : '切换到深色外观');
    button.addEventListener('click', () => {
      const current = root.dataset.uiTheme ?? 'light';
      const next = current === 'dark' ? 'light' : 'dark';
      root.dataset.uiTheme = next;
      syncThemeColor();
      try { window.localStorage.setItem('dsh-ui-theme', next); } catch { /* Storage is optional. */ }
      if (window.parent !== window) window.parent.postMessage({ type: 'dsh-theme-change', theme: next }, '*');
      button.setAttribute('aria-label', next === 'dark' ? '切换到浅色外观' : '切换到深色外观');
      announce(`已切换到${next === 'dark' ? '深色' : '浅色'}外观`);
    });
  });

  document.querySelectorAll('[data-toggle-pane]').forEach((button) => {
    button.addEventListener('click', () => {
      const target = button.dataset.togglePane;
      if (!target) return;
      document.body.classList.toggle(`hide-${target}`);
      const hidden = document.body.classList.contains(`hide-${target}`);
      button.setAttribute('aria-expanded', String(!hidden));
      announce(`${target === 'sidebar' ? '项目栏' : '检查器'}已${hidden ? '隐藏' : '显示'}`);
    });
  });

  const focusInspector = document.querySelector('[data-focus-inspector]');
  const inspectorTriggers = document.querySelectorAll('[data-focus-inspector-open]');
  const setFocusInspector = (open) => {
    if (!focusInspector) return;
    focusInspector.hidden = !open;
    inspectorTriggers.forEach((button) => button.setAttribute('aria-expanded', String(open)));
    if (open) focusInspector.querySelector('button')?.focus();
    announce(`项目详情已${open ? '显示' : '隐藏'}`);
  };
  inspectorTriggers.forEach((button) => button.addEventListener('click', () => setFocusInspector(focusInspector?.hidden ?? true)));
  document.querySelectorAll('[data-focus-inspector-close]').forEach((button) => {
    button.addEventListener('click', () => {
      setFocusInspector(false);
      const trigger = [...inspectorTriggers][0];
      trigger?.focus();
    });
  });
})();
