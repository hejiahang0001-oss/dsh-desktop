(() => {
  const api = window.pluginHealthAPI;
  if (!api) return;
  const root = document.getElementById('profiles-root');
  const extensionSurfaces = document.getElementById('extension-surfaces');
  const extensionIssues = document.getElementById('extension-issues');
  const runtime = document.getElementById('runtime');
  const issues = document.getElementById('issues');
  const catalog = document.getElementById('catalog');
  const profiles = document.getElementById('profiles');
  const summary = document.getElementById('profiles-summary');
  const status = document.getElementById('status');
  const refreshButton = document.getElementById('refresh');
  const closeButton = document.getElementById('close');

  const empty = (node) => { while (node.firstChild) node.firstChild.remove(); };
  const label = (value) => ({ healthy: '正常', degraded: '需修复', invalid: '清单异常', unavailable: '实时未连接', unsupported: '上游未提供', ready: '已就绪', installed: '已安装', missing: '缺失', misdirected: '指向异常', blocked: '已阻止', verified: '兼容已验证', review: '需要审查', disabled: '已禁用', pending: '等待加载', loading: '加载中', unloading: '卸载中', failed: '加载失败', 'not-bundle': '不是扩展层' }[value] || '未知');
  const makeBadge = (value) => {
    const node = document.createElement('span');
    node.className = `badge ${value || ''}`;
    node.textContent = label(value);
    return node;
  };
  const compatibilityText = (value) => {
    if (!value) return '';
    const source = {
      'registry-exact': '固定 registry',
      'registry-range': '浮动 registry',
      'registry-tag': 'registry 标签',
      local: '本地来源',
      git: 'Git 来源'
    }[value.sourceType] || '来源待确认';
    const platform = { web: 'Web', host: 'Host', unsupported: '平台不支持' }[value.clientPlatform] || '平台待确认';
    const patch = value.bundlePatch === 'ready' ? 'Patch 正常' : value.bundlePatch === 'missing' ? 'Patch 缺失' : 'Patch 已阻止';
    const peer = value.peers || {};
    return `${source} · ${platform} · ${patch} · Peer ${peer.healthy || 0}/${peer.expected || 0}`;
  };
  const extensionSurfaceCard = (item) => {
    const card = document.createElement('article');
    card.className = `surface-card ${item.id || ''}`;
    const header = document.createElement('div');
    header.className = 'surface-header';
    const identity = document.createElement('div');
    const title = document.createElement('h3'); title.textContent = item.title || '未命名能力';
    const subtitle = document.createElement('p'); subtitle.textContent = item.subtitle || '';
    identity.append(title, subtitle); header.append(identity, makeBadge(item.status));
    const metrics = document.createElement('div'); metrics.className = 'surface-metrics';
    for (const [number, caption] of [[item.active || 0, '活动'], [item.disabled || 0, '禁用'], [item.failed || 0, '失败']]) {
      const node = document.createElement('div');
      const value = document.createElement('strong'); value.textContent = String(number);
      const text = document.createElement('span'); text.textContent = caption;
      node.append(value, text); metrics.append(node);
    }
    const facts = document.createElement('dl'); facts.className = 'surface-facts';
    for (const [term, value] of [['来源', item.source], ['范围', item.scope], ['权限', item.permission], ['版本', item.version || '跟随 Harness']]) {
      const dt = document.createElement('dt'); dt.textContent = term;
      const dd = document.createElement('dd'); dd.textContent = value || '未确认';
      facts.append(dt, dd);
    }
    const message = document.createElement('p'); message.className = 'surface-message'; message.textContent = item.message || '';
    card.append(header, metrics, facts, message);
    return card;
  };

  const renderExtensionCenter = (center = {}) => {
    empty(extensionSurfaces); empty(extensionIssues);
    for (const item of center.surfaces || []) extensionSurfaces.append(extensionSurfaceCard(item));
    if ((center.surfaces || []).length === 0) {
      const node = document.createElement('p'); node.className = 'empty-state'; node.textContent = '扩展能力状态尚未初始化。'; extensionSurfaces.append(node);
    }
    for (const issue of center.issues || []) {
      const row = document.createElement('div'); row.className = 'extension-issue-row';
      const category = document.createElement('span'); category.textContent = ({ skills: 'Skills', plugins: 'Plugins', mcp: 'MCP' })[issue.category] || '扩展';
      const name = document.createElement('code'); name.textContent = issue.moduleName || '未知加载项';
      row.append(category, name, makeBadge(issue.status)); extensionIssues.append(row);
    }
    if ((center.issues || []).length === 0 && center.available) {
      const node = document.createElement('p'); node.className = 'inventory-ok'; node.textContent = '官方实时清单没有报告禁用、过渡中或失败的加载项。'; extensionIssues.append(node);
    }
  };
  const packageRow = (item, kind, profile) => {
    const row = document.createElement('li');
    const body = document.createElement('div');
    const name = document.createElement('strong');
    name.textContent = item.name || '未命名包';
    const detail = document.createElement('span');
    const source = { runtime: '软件随附', profile: 'Profile 安装', none: '未解析', outside: '边界外' }[item.source] || '未知来源';
    detail.textContent = `${kind} · ${source}${item.version ? ` · ${item.version}` : ''}`;
    body.append(name, detail);
    if (item.compatibility) {
      const compatibility = document.createElement('span');
      compatibility.className = 'compatibility-detail';
      compatibility.textContent = compatibilityText(item.compatibility);
      body.append(compatibility);
    }
    const actions = document.createElement('div');
    actions.className = 'package-actions';
    actions.append(makeBadge(item.status));
    if (item.compatibility) actions.append(makeBadge(item.compatibility.status));
    if (kind === 'pnpm 管理' && item.toggleable) {
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'toggle-button';
      toggle.textContent = item.enabled ? '关闭' : '启用';
      toggle.addEventListener('click', async () => {
        toggle.disabled = true;
        status.textContent = `正在${item.enabled ? '关闭' : '启用'} ${item.name}…`;
        try {
          const result = await api.toggle(profile.id, item.name, !item.enabled);
          if (result?.state) render(result.state);
          status.textContent = result?.message || (result?.ok ? '扩展状态已更新。' : '扩展状态未更改。');
        } catch {
          status.textContent = '扩展变更失败；Profile 保持或恢复为原状态。';
        } finally { toggle.disabled = false; }
      });
      actions.append(toggle);
    }
    row.append(body, actions);
    return row;
  };

  const catalogCard = (item, pnpm) => {
    const card = document.createElement('article');
    card.className = 'catalog-card';
    const header = document.createElement('div');
    header.className = 'catalog-header';
    const identity = document.createElement('div');
    const name = document.createElement('h3');
    name.textContent = item.displayName || item.name || '未命名扩展';
    const packageName = document.createElement('code');
    packageName.textContent = `${item.name || ''}@${item.version || ''}`;
    identity.append(name, packageName);
    header.append(identity, makeBadge(pnpm.status));
    const detail = document.createElement('p');
    detail.textContent = `固定 ${item.registry || 'registry'} · pnpm ${pnpm.version || '不可用'} · ${item.scriptsIgnored ? '安装脚本已禁止' : '安装策略未知'}`;
    card.append(header, detail);
    const targets = document.createElement('div');
    targets.className = 'catalog-targets';
    for (const target of item.targets || []) {
      const row = document.createElement('div');
      const text = document.createElement('span');
      text.textContent = target.available ? `Profile：${target.profileName}` : `Profile：${target.profileName}（尚未初始化）`;
      row.append(text);
      const actions = document.createElement('div');
      actions.className = 'catalog-actions';
      if (target.installed) actions.append(makeBadge('installed'));
      let actionCount = 0;
      const addLifecycleButton = (action, caption, className = '') => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `lifecycle-button ${className}`.trim();
        button.dataset.action = action;
        button.textContent = caption;
        button.addEventListener('click', async () => {
          button.disabled = true;
          status.textContent = `正在${caption} ${item.name}；请勿关闭软件…`;
          try {
            const result = await api.lifecycle(target.profileId, item.id, action);
            if (result?.state) render(result.state);
            status.textContent = result?.message || (result?.ok ? '插件生命周期操作完成。' : '插件状态未更改。');
          } catch {
            status.textContent = '受控插件生命周期操作失败；将按持久事务保持或恢复原状态。';
          } finally { button.disabled = false; }
        });
        actions.append(button);
        actionCount += 1;
      };
      if (target.canInstall) addLifecycleButton('install', `安装到 ${target.profileName}`, 'install-button');
      if (target.canUpgrade) addLifecycleButton('upgrade', `升级到 ${item.version}`, 'upgrade-button');
      if (target.canUninstall) addLifecycleButton('uninstall', '卸载', 'uninstall-button');
      if (target.canRollback) addLifecycleButton('rollback', '回退', 'rollback-button');
      if (actionCount === 0) actions.append(makeBadge(target.available ? 'blocked' : 'unavailable'));
      row.append(actions);
      targets.append(row);
    }
    card.append(targets);
    return card;
  };

  const render = (state = {}) => {
    root.textContent = state.profilesRoot || '本机 Harness 配置 / profiles';
    renderExtensionCenter(state.extensionCenter || {});
    empty(runtime); empty(issues); empty(catalog); empty(profiles);
    const rt = state.runtime || {};
    const title = document.createElement('div');
    title.className = 'runtime-title';
    const heading = document.createElement('h3');
    heading.textContent = `DeepSeek Harness ${rt.version || '版本未知'}`;
    title.append(heading, makeBadge(rt.status));
    const metrics = document.createElement('div');
    metrics.className = 'metrics';
    for (const [number, text] of [[rt.expected || 0, '预期包'], [rt.healthy || 0, '链接正常'], [rt.missing || 0, '缺失'], [rt.misdirected || 0, '指向异常']]) {
      const metric = document.createElement('div');
      const value = document.createElement('strong'); value.textContent = String(number);
      const caption = document.createElement('span'); caption.textContent = text;
      metric.append(value, caption); metrics.append(metric);
    }
    const note = document.createElement('p');
    note.textContent = '共享回退由 Harness 启动时维护；pnpm 只管理 Profile 自己声明的外部依赖。';
    runtime.append(title, metrics, note);
    for (const issue of rt.issues || []) {
      const row = document.createElement('div');
      row.className = 'issue-row';
      const name = document.createElement('code'); name.textContent = issue.name || '未知包';
      row.append(name, makeBadge(issue.status)); issues.append(row);
    }
    const pnpm = state.pnpm || { status: 'unavailable', version: '' };
    const catalogItems = state.catalog || [];
    for (const item of catalogItems) catalog.append(catalogCard(item, pnpm));
    if (catalogItems.length === 0) {
      const node = document.createElement('p'); node.className = 'empty-state'; node.textContent = '当前版本没有可安装的已验证扩展。'; catalog.append(node);
    }

    const profileList = state.profiles || [];
    summary.textContent = profileList.length > 0
      ? `检测到 ${profileList.length} 个 Profile${state.profileLimitReached ? '（已达展示上限）' : ''}；仅显示扩展包元数据。`
      : '尚未发现已初始化的 Profile。';
    for (const profile of profileList) {
      const card = document.createElement('article'); card.className = 'profile-card';
      const header = document.createElement('div'); header.className = 'profile-header';
      const identity = document.createElement('div');
      const name = document.createElement('h3'); name.textContent = profile.name || '未命名 Profile';
      const manifest = document.createElement('p');
      manifest.textContent = `${profile.manifestName || '清单未命名'} · pnpm Profile 配置${profile.workspaceReady ? '完整' : '缺失'}`;
      identity.append(name, manifest);
      const actions = document.createElement('div'); actions.className = 'profile-actions';
      actions.append(makeBadge(profile.status));
      const reveal = document.createElement('button'); reveal.type = 'button'; reveal.textContent = '在文件夹中显示';
      reveal.addEventListener('click', async () => {
        reveal.disabled = true;
        const result = await api.reveal(profile.id);
        status.textContent = result?.ok ? '已定位 Profile 目录。' : (result?.message || 'Profile 已变化，请刷新。');
        reveal.disabled = false;
      });
      actions.append(reveal); header.append(identity, actions); card.append(header);
      const columns = document.createElement('div'); columns.className = 'package-columns';
      for (const [titleText, list, kind] of [['扩展层', profile.bundles || [], '按顺序加载'], ['外部依赖', profile.dependencies || [], 'pnpm 管理']]) {
        const column = document.createElement('div');
        const titleNode = document.createElement('h4'); titleNode.textContent = `${titleText} · ${list.length}`;
        const ul = document.createElement('ul');
        if (list.length === 0) {
          const li = document.createElement('li'); li.className = 'empty-package'; li.textContent = titleText === '外部依赖' ? '未声明外部插件' : '未声明扩展层'; ul.append(li);
        } else for (const item of list) ul.append(packageRow(item, kind, profile));
        column.append(titleNode, ul); columns.append(column);
      }
      card.append(columns);
      const message = document.createElement('p'); message.className = 'profile-message'; message.textContent = profile.message || ''; card.append(message);
      profiles.append(card);
    }
    if (profileList.length === 0) {
      const node = document.createElement('p'); node.className = 'empty-state'; node.textContent = '首次启动 Web 或 Headless Profile 后，这里会显示实际启用的扩展层。'; profiles.append(node);
    }
    const recovery = state.recovery || [];
    const recoveryMessage = recovery.find((item) => item.status === 'rolled-back')
      ? '已恢复一次中断的插件事务；Profile 已回到变更前状态。'
      : recovery.find((item) => item.status === 'committed')
        ? '已完成一次提交阶段中断的插件事务；最近可用回退点保持有效。'
      : recovery.find((item) => ['failed', 'conflict'].includes(item.status))
        ? '检测到无法安全自动处理的插件事务；该 Profile 已封锁，请先检查事务记录。'
        : '';
    status.textContent = recoveryMessage || (state.available === false
      ? (state.message || '扩展中心暂时不可用。')
      : pnpm.status !== 'ready'
        ? '扩展状态检查完成；软件随附 pnpm 暂不可用，安装入口已关闭。'
        : (state.extensionCenter?.message || state.message || '扩展状态检查完成。'));
  };

  const refresh = async () => {
    refreshButton.disabled = true; status.textContent = '正在从 Harness 重新核对扩展状态…';
    try { render(await api.refresh()); } catch { status.textContent = '刷新失败；没有放宽文件或 IPC 边界。'; }
    finally { refreshButton.disabled = false; }
  };
  refreshButton.addEventListener('click', () => void refresh());
  closeButton.addEventListener('click', () => window.close());
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') window.close();
    if (event.key === 'F5') { event.preventDefault(); void refresh(); }
  });
  api.getState().then(render).catch(() => { status.textContent = '扩展中心暂时不可用。'; });
})();
