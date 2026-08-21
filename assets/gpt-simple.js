(() => {
  'use strict';

  const root = document.documentElement;
  const locales = window.DSH_LOCALES || {};
  const themeColor = document.querySelector('meta[name="theme-color"]');
  const themeButtons = [...document.querySelectorAll('[data-theme-option]')];
  const languageButton = document.querySelector('[data-language-toggle]');
  const liveRegion = document.querySelector('[data-live-status]');
  const appShell = document.querySelector('.app-shell');
  const workspaceElement = document.querySelector('.workspace');
  const detailPanel = document.querySelector('[data-detail-panel]');
  const detailBackdrop = document.querySelector('[data-detail-backdrop]');
  const detailTriggers = [...document.querySelectorAll('[data-detail-open]')];
  const sidebar = document.querySelector('#project-sidebar');
  const sidebarScrim = document.querySelector('[data-sidebar-scrim]');
  const sidebarOpenButton = document.querySelector('[data-sidebar-open]');
  const projectList = document.querySelector('[data-project-list]');
  const projectCount = document.querySelector('[data-project-count]');
  const projectSearch = document.querySelector('[data-project-search]');
  const emptyProjects = document.querySelector('[data-empty-projects]');
  const newProjectModal = document.querySelector('[data-new-project-modal]');
  const settingsModal = document.querySelector('[data-settings-modal]');
  const deleteProjectModal = document.querySelector('[data-delete-project-modal]');
  const workspaceEmpty = document.querySelector('[data-workspace-empty]');
  const workspaceReady = document.querySelector('[data-workspace-ready]');
  const detailDescription = document.querySelector('[data-detail-description]');
  const deleteProjectName = document.querySelector('[data-delete-project-name]');
  const detailOpenButton = document.querySelector('[data-detail-open]');
  const addFileButton = document.querySelector('.composer-icon');
  const compactSidebar = window.matchMedia('(max-width: 720px)');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const desktopAPI = window.desktopAPI;
  let detailPriorFocus = null;
  let modalPriorFocus = null;
  let activeModal = null;
  let activeProjectKey = '';
  let pendingDeleteKey = '';
  let chatHistory = [];

  const storage = {
    get(key, fallback = null) {
      try {
        const value = window.localStorage.getItem(key);
        return value === null ? fallback : value;
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try { window.localStorage.setItem(key, value); } catch { /* Local persistence is optional in preview mode. */ }
    }
  };

  const template = (value, vars = {}) => Object.entries(vars).reduce(
    (text, [key, replacement]) => text.replaceAll(`{${key}}`, String(replacement)),
    value
  );

  let language = (() => {
    const queryLanguage = new URLSearchParams(window.location.search).get('lang');
    if (queryLanguage === 'en' || queryLanguage === 'zh-CN') return queryLanguage;
    return storage.get('dsh-language') === 'en' ? 'en' : 'zh-CN';
  })();

  const t = (key, vars) => template(locales[language]?.[key] || locales['zh-CN']?.[key] || key, vars);

  const announce = (message) => {
    if (!liveRegion) return;
    liveRegion.textContent = '';
    window.setTimeout(() => { liveRegion.textContent = message; }, 10);
  };

  const setAppShellInert = (inert) => {
    if (!appShell) return;
    if (inert) appShell.setAttribute('inert', '');
    else appShell.removeAttribute('inert');
  };

  const replaceQuery = (key, value) => {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set(key, value);
      window.history.replaceState(null, '', url);
    } catch { /* Packaged file URLs do not require query-state persistence. */ }
  };

  const projectName = (button) => {
    if (!button) return language === 'zh-CN' ? '未命名项目' : 'Untitled project';
    return button.dataset.projectNameKey ? t(button.dataset.projectNameKey) : button.dataset.projectName || '';
  };

  const translateProjectButtons = () => {
    document.querySelectorAll('[data-project]').forEach((button) => {
      const name = projectName(button);
      const meta = button.dataset.projectMetaKey ? t(button.dataset.projectMetaKey) : t('projects.custom.meta');
      button.querySelector('.project-name').textContent = name;
      button.querySelector('.project-meta').textContent = meta;
      button.setAttribute('aria-label', `${name}, ${meta}`);
      button.title = `${name} — ${meta}`;
      const quickDelete = button.closest('[data-project-row]')?.querySelector('[data-project-delete]');
      if (quickDelete) {
        quickDelete.setAttribute('aria-label', t('a11y.deleteProject', { name }));
        quickDelete.title = t('actions.deleteProject');
      }
    });
  };

  const projectRecord = (key) => customProjects.find((project) => project.id === key);

  const updateActiveProjectCopy = () => {
    const button = activeProjectKey ? document.querySelector(`[data-project-key="${CSS.escape(activeProjectKey)}"]`) : null;
    const hasProject = Boolean(button);
    const name = hasProject ? projectName(button) : t('workspace.noProjectHeader');
    const heading = document.querySelector('[data-project-title]');
    heading.textContent = name;
    heading.title = name;
    document.querySelector('[data-detail-project-name]').textContent = hasProject ? name : '';
    const record = hasProject ? projectRecord(activeProjectKey) : null;
    if (detailDescription) detailDescription.textContent = record?.description || t('detail.noDescription');
    if (workspaceEmpty) workspaceEmpty.hidden = hasProject;
    if (workspaceReady) workspaceReady.hidden = !hasProject;
    if (detailOpenButton) detailOpenButton.disabled = !hasProject;
    const composer = document.querySelector('[data-composer]');
    const textarea = composer?.querySelector('textarea');
    const submit = composer?.querySelector('[type="submit"]');
    if (textarea) {
      textarea.disabled = !hasProject;
      textarea.placeholder = t(hasProject ? 'composer.placeholder' : 'composer.disabledPlaceholder');
    }
    if (submit) submit.disabled = !hasProject;
    if (addFileButton) addFileButton.disabled = !hasProject;
  };

  const applyLanguage = (nextLanguage, announceChange = false) => {
    language = nextLanguage === 'en' ? 'en' : 'zh-CN';
    root.lang = language;
    document.title = t('app.title');
    document.querySelectorAll('[data-i18n]').forEach((element) => { element.textContent = t(element.dataset.i18n); });
    document.querySelectorAll('[data-i18n-html]').forEach((element) => { element.innerHTML = t(element.dataset.i18nHtml); });
    document.querySelectorAll('[data-i18n-placeholder]').forEach((element) => { element.placeholder = t(element.dataset.i18nPlaceholder); });
    document.querySelectorAll('[data-i18n-aria]').forEach((element) => { element.setAttribute('aria-label', t(element.dataset.i18nAria)); });
    if (languageButton) {
      languageButton.textContent = language === 'zh-CN' ? 'EN' : '中';
      languageButton.setAttribute('aria-label', t(language === 'zh-CN' ? 'a11y.switchEnglish' : 'a11y.switchChinese'));
    }
    translateProjectButtons();
    updateActiveProjectCopy();
    storage.set('dsh-language', language);
    replaceQuery('lang', language);
    if (announceChange) announce(language === 'zh-CN' ? '已切换到简体中文' : 'Switched to English');
  };

  const setTheme = (theme, announceChange = true) => {
    const selectedTheme = theme === 'dark' ? 'dark' : 'light';
    root.dataset.theme = selectedTheme;
    themeButtons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.themeOption === selectedTheme)));
    if (themeColor) themeColor.content = selectedTheme === 'dark' ? '#0d0d0d' : '#ffffff';
    storage.set('dsh-simple-theme', selectedTheme);
    replaceQuery('theme', selectedTheme);
    if (announceChange) announce(t(selectedTheme === 'dark' ? 'status.themeDark' : 'status.themeLight'));
  };

  let initialTheme = new URLSearchParams(window.location.search).get('theme');
  if (initialTheme !== 'light' && initialTheme !== 'dark') initialTheme = storage.get('dsh-simple-theme');
  setTheme(initialTheme === 'dark' ? 'dark' : 'light', false);
  themeButtons.forEach((button) => button.addEventListener('click', () => setTheme(button.dataset.themeOption)));
  languageButton?.addEventListener('click', () => applyLanguage(language === 'zh-CN' ? 'en' : 'zh-CN', true));

  const setSidebar = (open) => {
    document.body.classList.toggle('sidebar-open', open);
    if (sidebarScrim) sidebarScrim.hidden = !open;
    sidebarOpenButton?.setAttribute('aria-expanded', String(open));
    if (sidebar && compactSidebar.matches) {
      sidebar.inert = !open;
      sidebar.setAttribute('aria-hidden', String(!open));
      if (workspaceElement) {
        if (open) workspaceElement.setAttribute('inert', '');
        else workspaceElement.removeAttribute('inert');
      }
    } else if (sidebar) {
      sidebar.inert = false;
      sidebar.removeAttribute('aria-hidden');
      workspaceElement?.removeAttribute('inert');
    }
    if (open) sidebar?.querySelector('[data-sidebar-close]')?.focus();
  };

  sidebarOpenButton?.addEventListener('click', () => setSidebar(true));
  document.querySelector('[data-sidebar-close]')?.addEventListener('click', () => { setSidebar(false); sidebarOpenButton?.focus(); });
  sidebarScrim?.addEventListener('click', () => setSidebar(false));
  compactSidebar.addEventListener('change', () => setSidebar(false));
  setSidebar(false);

  const focusableWithin = (container) => [...container.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter((element) => !element.closest('[hidden]'));

  const trapFocus = (event, container) => {
    if (event.key !== 'Tab') return;
    const focusable = focusableWithin(container);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };

  sidebar?.addEventListener('keydown', (event) => {
    if (compactSidebar.matches && document.body.classList.contains('sidebar-open')) trapFocus(event, sidebar);
  });

  const setDetail = (open) => {
    if (!detailPanel || !detailBackdrop) return;
    if (open && !activeProjectKey) return;
    if (open) detailPriorFocus = document.activeElement;
    detailPanel.hidden = !open;
    detailBackdrop.hidden = !open;
    setAppShellInert(open);
    detailTriggers.forEach((button) => button.setAttribute('aria-expanded', String(open)));
    if (open) detailPanel.querySelector('[data-detail-close]')?.focus();
    else if (detailPriorFocus instanceof HTMLElement) detailPriorFocus.focus();
    announce(t(open ? 'status.detailOpened' : 'status.detailClosed'));
  };

  detailTriggers.forEach((button) => button.addEventListener('click', () => setDetail(true)));
  document.querySelector('[data-detail-close]')?.addEventListener('click', () => setDetail(false));
  detailBackdrop?.addEventListener('click', () => setDetail(false));
  detailPanel?.addEventListener('keydown', (event) => trapFocus(event, detailPanel));

  const setModal = (modal, open) => {
    if (!modal) return;
    if (open) {
      if (activeModal && activeModal !== modal) activeModal.hidden = true;
      modalPriorFocus = document.activeElement;
      activeModal = modal;
      modal.hidden = false;
      document.body.classList.add('modal-open');
      const modalCard = modal.querySelector('.modal-card') || modal;
      const firstField = modalCard.querySelector('input:not([disabled]), textarea:not([disabled]), select:not([disabled])');
      window.setTimeout(() => (firstField || focusableWithin(modalCard)[0])?.focus(), 0);
      setAppShellInert(true);
      if (detailPanel && !detailPanel.hidden) detailPanel.setAttribute('inert', '');
    } else {
      modal.hidden = true;
      document.body.classList.remove('modal-open');
      activeModal = null;
      const detailOpen = Boolean(detailPanel && !detailPanel.hidden);
      detailPanel?.removeAttribute('inert');
      setAppShellInert(detailOpen);
      if (modalPriorFocus instanceof HTMLElement) modalPriorFocus.focus();
    }
  };

  document.querySelectorAll('[data-modal-close]').forEach((button) => button.addEventListener('click', () => setModal(button.closest('.modal-layer'), false)));
  [newProjectModal, settingsModal, deleteProjectModal].forEach((modal) => modal?.addEventListener('keydown', (event) => trapFocus(event, modal.querySelector('.modal-card') || modal)));

  const loadCustomProjects = () => {
    try {
      const value = JSON.parse(storage.get('dsh-custom-projects', '[]'));
      return Array.isArray(value) ? value.filter((item) => item && typeof item.name === 'string') : [];
    } catch {
      return [];
    }
  };

  let customProjects = loadCustomProjects();

  const renderCustomProjects = () => {
    projectList?.querySelectorAll('[data-custom-project]').forEach((element) => element.remove());
    customProjects.forEach((project) => {
      const row = document.createElement('div');
      row.className = 'project-row';
      row.dataset.projectRow = '';
      row.dataset.customProject = '';
      const button = document.createElement('button');
      button.className = 'project-item';
      button.type = 'button';
      button.dataset.project = '';
      button.dataset.projectKey = project.id;
      button.dataset.projectName = project.name;
      button.innerHTML = '<span class="project-name"></span><span class="project-meta"></span>';
      const deleteButton = document.createElement('button');
      deleteButton.className = 'project-delete-button';
      deleteButton.type = 'button';
      deleteButton.dataset.projectDelete = project.id;
      deleteButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m-9 0 1 13h10l1-13M10 11v5m4-5v5"/></svg>';
      row.append(button, deleteButton);
      projectList?.append(row);
    });
    if (projectCount) projectCount.textContent = String(customProjects.length);
    translateProjectButtons();
  };

  const resetConversation = () => {
    document.querySelectorAll('[data-runtime-message]').forEach((message) => message.remove());
    chatHistory = [];
  };

  const clearActiveProject = () => {
    document.querySelectorAll('[data-project]').forEach((item) => { item.classList.remove('active'); item.removeAttribute('aria-current'); });
    activeProjectKey = '';
    storage.set('dsh-active-project', '');
    resetConversation();
    updateActiveProjectCopy();
  };

  const selectProject = (button, announceChange = true) => {
    if (!button) { clearActiveProject(); return; }
    document.querySelectorAll('[data-project]').forEach((item) => { item.classList.remove('active'); item.removeAttribute('aria-current'); });
    button.classList.add('active');
    button.setAttribute('aria-current', 'page');
    activeProjectKey = button.dataset.projectKey || 'launch';
    const name = projectName(button);
    const heading = document.querySelector('[data-project-title]');
    heading.textContent = name;
    heading.title = name;
    document.querySelector('[data-detail-project-name]').textContent = name;
    storage.set('dsh-active-project', activeProjectKey);
    resetConversation();
    updateActiveProjectCopy();
    setSidebar(false);
    if (announceChange) announce(t('status.projectChanged', { name }));
  };

  projectList?.addEventListener('click', (event) => {
    if (event.target.closest('[data-project-delete]')) return;
    const button = event.target.closest('[data-project]');
    if (button) selectProject(button);
  });

  const filterProjects = () => {
    const query = projectSearch?.value.trim().toLocaleLowerCase(language) || '';
    let visible = 0;
    document.querySelectorAll('[data-project]').forEach((button) => {
      const matches = !query || projectName(button).toLocaleLowerCase(language).includes(query);
      button.hidden = !matches;
      if (matches) visible += 1;
    });
    if (emptyProjects) {
      emptyProjects.textContent = t(customProjects.length ? 'sidebar.noResults' : 'sidebar.noProjects');
      emptyProjects.hidden = visible !== 0;
    }
  };
  projectSearch?.addEventListener('input', filterProjects);

  renderCustomProjects();
  const storedProject = storage.get('dsh-active-project', '');
  selectProject((storedProject && document.querySelector(`[data-project-key="${CSS.escape(storedProject)}"]`)) || document.querySelector('[data-project]'), false);
  filterProjects();

  document.querySelectorAll('[data-new-project], [data-empty-new-project]').forEach((button) => button.addEventListener('click', () => { setSidebar(false); setModal(newProjectModal, true); }));
  document.querySelector('[data-new-project-form]')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const name = String(formData.get('name') || '').trim();
    const status = form.querySelector('[data-new-project-status]');
    if (!name) { if (status) status.textContent = t('status.projectNameRequired'); form.querySelector('[name="name"]')?.focus(); return; }
    const project = { id: `project-${Date.now().toString(36)}`, name, description: String(formData.get('description') || '').trim(), createdAt: new Date().toISOString() };
    customProjects.push(project);
    storage.set('dsh-custom-projects', JSON.stringify(customProjects));
    renderCustomProjects();
    if (projectSearch) projectSearch.value = '';
    filterProjects();
    const button = document.querySelector(`[data-project-key="${CSS.escape(project.id)}"]`);
    selectProject(button, false);
    form.reset();
    if (status) status.textContent = '';
    setModal(newProjectModal, false);
    announce(t('status.projectCreated', { name }));
  });

  const openDeleteProject = (key) => {
    const button = key ? document.querySelector(`[data-project-key="${CSS.escape(key)}"]`) : null;
    if (!button) return;
    pendingDeleteKey = key;
    if (deleteProjectName) deleteProjectName.textContent = projectName(button);
    setModal(deleteProjectModal, true);
  };

  document.querySelector('[data-delete-project-open]')?.addEventListener('click', () => openDeleteProject(activeProjectKey));
  projectList?.addEventListener('click', (event) => {
    const deleteButton = event.target.closest('[data-project-delete]');
    if (!deleteButton) return;
    event.stopPropagation();
    openDeleteProject(deleteButton.dataset.projectDelete || '');
  });

  document.querySelector('[data-delete-project-confirm]')?.addEventListener('click', () => {
    if (!pendingDeleteKey) return;
    const record = projectRecord(pendingDeleteKey);
    const name = record?.name || t('workspace.noProjectHeader');
    customProjects = customProjects.filter((project) => project.id !== pendingDeleteKey);
    storage.set('dsh-custom-projects', JSON.stringify(customProjects));
    pendingDeleteKey = '';
    setModal(deleteProjectModal, false);
    if (detailPanel && !detailPanel.hidden) setDetail(false);
    renderCustomProjects();
    if (projectSearch) projectSearch.value = '';
    filterProjects();
    selectProject(document.querySelector('[data-project]'), false);
    announce(t('status.projectDeleted', { name }));
  });

  const settingsForm = document.querySelector('[data-settings-form]');
  const settingsStatus = document.querySelector('[data-settings-status]');

  const loadSettings = async () => {
    let settings = { endpoint: 'https://api.deepseek.com', model: 'deepseek-chat', hasApiKey: false };
    if (desktopAPI?.settings?.load) settings = await desktopAPI.settings.load();
    else {
      try { settings = { ...settings, ...JSON.parse(storage.get('dsh-browser-settings', '{}')) }; } catch { /* Keep defaults. */ }
    }
    settingsForm.elements.endpoint.value = settings.endpoint || 'https://api.deepseek.com';
    settingsForm.elements.model.value = settings.model || 'deepseek-chat';
    settingsForm.elements.apiKey.value = '';
    if (settingsStatus) settingsStatus.textContent = settings.hasApiKey ? t('status.settingsLoaded') : '';
  };

  document.querySelector('[data-settings-open]')?.addEventListener('click', async () => {
    setSidebar(false);
    setModal(settingsModal, true);
    try { await loadSettings(); } catch (error) { if (settingsStatus) settingsStatus.textContent = t('status.settingsSaveFailed', { message: error.message }); }
  });

  settingsForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submitButton = settingsForm.querySelector('[type="submit"]');
    submitButton.disabled = true;
    const payload = {
      endpoint: settingsForm.elements.endpoint.value.trim(),
      model: settingsForm.elements.model.value.trim(),
      apiKey: settingsForm.elements.apiKey.value.trim()
    };
    try {
      if (desktopAPI?.settings?.save) {
        const result = await desktopAPI.settings.save(payload);
        if (!result.ok) throw new Error(result.error?.message || 'Unknown error');
      } else {
        storage.set('dsh-browser-settings', JSON.stringify({ ...payload, hasApiKey: Boolean(payload.apiKey) }));
      }
      settingsForm.elements.apiKey.value = '';
      if (settingsStatus) settingsStatus.textContent = t('status.settingsSaved');
      announce(t('status.settingsSaved'));
    } catch (error) {
      if (settingsStatus) settingsStatus.textContent = t('status.settingsSaveFailed', { message: error.message });
    } finally {
      submitButton.disabled = false;
    }
  });

  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === ',') { event.preventDefault(); document.querySelector('[data-settings-open]')?.click(); return; }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n') { event.preventDefault(); document.querySelector('[data-new-project]')?.click(); return; }
    if (event.key !== 'Escape') return;
    if (activeModal) setModal(activeModal, false);
    else if (detailPanel && !detailPanel.hidden) setDetail(false);
    else if (document.body.classList.contains('sidebar-open')) { setSidebar(false); sidebarOpenButton?.focus(); }
  });

  const form = document.querySelector('[data-composer]');
  const textarea = form?.querySelector('textarea');
  const sendButton = form?.querySelector('[type="submit"]');
  const resizeComposer = () => {
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 140)}px`;
  };
  textarea?.addEventListener('input', resizeComposer);
  textarea?.addEventListener('keydown', (event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); form?.requestSubmit(); } });

  const appendMessage = (role, content) => {
    const stream = document.querySelector('[data-message-stream]');
    if (!stream) return null;
    const article = document.createElement('article');
    article.className = `message ${role === 'user' ? 'user-message' : 'assistant-message'}`;
    article.dataset.runtimeMessage = '';
    if (workspaceReady) workspaceReady.hidden = true;
    if (role === 'user') {
      const bubble = document.createElement('div');
      bubble.className = 'user-bubble';
      bubble.textContent = content;
      article.append(bubble);
    } else {
      const avatar = document.createElement('div');
      avatar.className = 'assistant-avatar';
      avatar.setAttribute('aria-hidden', 'true');
      avatar.textContent = 'D';
      const wrapper = document.createElement('div');
      wrapper.className = 'assistant-content';
      const paragraph = document.createElement('p');
      paragraph.textContent = content;
      wrapper.append(paragraph);
      article.append(avatar, wrapper);
    }
    stream.append(article);
    article.scrollIntoView({ block: 'end', behavior: reducedMotion.matches ? 'auto' : 'smooth' });
    return article.querySelector('p');
  };

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!activeProjectKey) return;
    const requestProjectKey = activeProjectKey;
    const value = textarea?.value.trim();
    if (!value) { textarea?.focus(); announce(t('status.inputRequired')); return; }
    appendMessage('user', value);
    chatHistory.push({ role: 'user', content: value });
    const reply = appendMessage('assistant', t('status.thinking'));
    if (textarea) { textarea.value = ''; resizeComposer(); }
    if (sendButton) sendButton.disabled = true;
    announce(t('status.messageAdded'));
    try {
      let content;
      if (desktopAPI?.chat?.complete) {
        const result = await desktopAPI.chat.complete({
          messages: [{ role: 'system', content: t('system.prompt') }, ...chatHistory.slice(-20)]
        });
        if (!result.ok) {
          const key = result.error?.code === 'API_KEY_MISSING' ? 'status.apiMissing' : 'status.chatFailed';
          throw Object.assign(new Error(result.error?.message || 'Unknown error'), { translationKey: key });
        }
        content = result.content;
      } else {
        await new Promise((resolve) => window.setTimeout(resolve, 350));
        content = t('status.previewReply');
      }
      if (activeProjectKey === requestProjectKey) {
        if (reply) reply.textContent = content;
        chatHistory.push({ role: 'assistant', content });
      }
    } catch (error) {
      const errorText = error.translationKey === 'status.apiMissing' ? t('status.apiMissing') : t('status.chatFailed', { message: error.message });
      if (activeProjectKey === requestProjectKey) {
        if (reply) reply.textContent = errorText;
        announce(errorText);
      }
    } finally {
      if (sendButton) sendButton.disabled = !activeProjectKey;
      if (activeProjectKey === requestProjectKey) textarea?.focus();
    }
  });

  applyLanguage(language, false);
  filterProjects();
})();
