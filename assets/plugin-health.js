(() => {
  const api = window.pluginHealthAPI;
  if (!api) return;
  const root = document.getElementById('profiles-root');
  const runtime = document.getElementById('runtime');
  const issues = document.getElementById('issues');
  const profiles = document.getElementById('profiles');
  const summary = document.getElementById('profiles-summary');
  const status = document.getElementById('status');
  const refreshButton = document.getElementById('refresh');
  const closeButton = document.getElementById('close');

  const empty = (node) => { while (node.firstChild) node.firstChild.remove(); };
  const label = (value) => ({ healthy: '正常', degraded: '需修复', invalid: '清单异常', unavailable: '不可用', ready: '可解析', missing: '缺失', misdirected: '指向异常', blocked: '已阻止', verified: '兼容已验证', review: '需要审查', 'not-bundle': '不是扩展层' }[value] || '未知');
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

  const render = (state = {}) => {
    root.textContent = state.profilesRoot || '$DSH_HOME/profiles';
    empty(runtime); empty(issues); empty(profiles);
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
      ? '已恢复一次中断的扩展变更；Profile 已回到变更前状态。'
      : recovery.find((item) => ['failed', 'conflict'].includes(item.status))
        ? '检测到无法自动处理的扩展变更，请先检查 Profile 备份。'
        : '';
    status.textContent = recoveryMessage || (state.available === false ? (state.message || '扩展健康暂时不可用。') : (state.message || '扩展健康检查完成。'));
  };

  const refresh = async () => {
    refreshButton.disabled = true; status.textContent = '正在重新核对扩展依赖…';
    try { render(await api.refresh()); } catch { status.textContent = '刷新失败；没有放宽文件或 IPC 边界。'; }
    finally { refreshButton.disabled = false; }
  };
  refreshButton.addEventListener('click', () => void refresh());
  closeButton.addEventListener('click', () => window.close());
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') window.close();
    if (event.key === 'F5') { event.preventDefault(); void refresh(); }
  });
  api.getState().then(render).catch(() => { status.textContent = '扩展健康暂时不可用。'; });
})();
