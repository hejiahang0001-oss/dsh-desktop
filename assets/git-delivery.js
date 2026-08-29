(() => {
  const api = window.gitDeliveryAPI;
  if (!api) return;

  const byId = (id) => document.getElementById(id);
  const nodes = Object.freeze({
    unavailable: byId('unavailable'), unavailableMessage: byId('unavailable-message'), content: byId('delivery-content'),
    repositoryPath: byId('repository-path'), branch: byId('branch'), upstream: byId('upstream'), head: byId('head'),
    staged: byId('staged'), unstaged: byId('unstaged'), untracked: byId('untracked'), sync: byId('sync'),
    conflictBadge: byId('conflict-badge'), message: byId('commit-message'), messageCount: byId('message-count'),
    commit: byId('commit'), refresh: byId('refresh'), refreshRemote: byId('refresh-remote'), close: byId('close'),
    remoteMessage: byId('remote-message'), pullRequests: byId('pull-requests'), createPr: byId('create-pr'),
    history: byId('commit-history'), changeTotal: byId('change-total'), status: byId('status')
  });
  let currentState = null;
  let busy = false;

  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (typeof text === 'string') node.textContent = text;
    return node;
  };
  const replace = (node) => { while (node.firstChild) node.firstChild.remove(); };
  const formatTime = (value) => {
    if (!value || Number.isNaN(Date.parse(value))) return '时间未知';
    return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
  };
  const stateLabel = (value) => ({ passed: '通过', pending: '进行中', failed: '失败', neutral: '其他' }[value] || '未知');
  const setBusy = (next, message = '') => {
    busy = next;
    nodes.refresh.disabled = next;
    nodes.refreshRemote.disabled = next;
    nodes.message.disabled = next || !currentState?.available;
    if (message) nodes.status.textContent = message;
    updateCommitAvailability();
  };
  const updateCommitAvailability = () => {
    const ready = currentState?.available
      && currentState.status?.staged > 0
      && currentState.status?.conflicted === 0
      && nodes.message.value.trim().length > 0
      && nodes.message.value.length <= 200
      && !/[\u0000-\u001f\u007f]/u.test(nodes.message.value)
      && !busy;
    nodes.commit.disabled = !ready;
    nodes.messageCount.textContent = `${nodes.message.value.length} / 200`;
  };
  const linkButton = (text, id, className = 'link-button') => {
    const button = element('button', className, text);
    button.type = 'button';
    button.disabled = !id;
    button.addEventListener('click', async () => {
      if (!id || busy) return;
      const result = await api.openLink(id).catch(() => ({ ok: false, message: '链接已失效，请刷新后重试。' }));
      nodes.status.textContent = result?.message || (result?.ok ? '已在默认浏览器中打开。' : '未能打开交付链接。');
    });
    return button;
  };
  const renderChecks = (checks = {}) => {
    const container = element('div', 'checks');
    const counts = checks.counts || {};
    const summary = element('div', 'check-summary');
    for (const [key, label] of [['passed', '通过'], ['pending', '进行中'], ['failed', '失败'], ['neutral', '其他']]) {
      const count = Number(counts[key] || 0);
      if (count > 0) summary.append(element('span', `check-count ${key}`, `${label} ${count}`));
    }
    if (!summary.childElementCount) summary.append(element('span', 'muted', '暂无检查结果'));
    container.append(summary);
    if ((checks.items || []).length) {
      const list = element('ul', 'check-list');
      for (const item of checks.items) {
        const row = element('li', `check-item ${item.state || 'neutral'}`);
        row.append(element('span', 'check-dot', stateLabel(item.state)), element('span', 'check-name', item.name || '未命名检查'));
        if (item.linkId) row.append(linkButton('查看', item.linkId, 'mini-link'));
        list.append(row);
      }
      container.append(list);
    }
    return container;
  };
  const renderRemote = (remote = {}) => {
    nodes.remoteMessage.textContent = remote.message || 'GitHub PR 状态不可用。';
    replace(nodes.pullRequests);
    for (const pull of remote.pullRequests || []) {
      const card = element('article', 'pr-card');
      const heading = element('div', 'pr-heading');
      const title = element('div', 'pr-title');
      title.append(element('strong', '', `#${pull.number} ${pull.title || ''}`), element('small', '', `${pull.draft ? '草稿' : (pull.state === 'open' ? '开放' : '已关闭')} · ${formatTime(pull.updatedAt)}`));
      heading.append(title, linkButton('在 GitHub 查看', pull.id, 'mini-link'));
      card.append(heading, renderChecks(pull.checks));
      nodes.pullRequests.append(card);
    }
    if (!(remote.pullRequests || []).length) nodes.pullRequests.append(element('p', 'empty-state', remote.available ? '当前分支还没有 PR。' : 'PR 状态暂不可用，本地 Git 仍可使用。'));
    nodes.createPr.hidden = !remote.canCreate || !remote.createLinkId;
    nodes.createPr.dataset.linkId = remote.createLinkId || '';
  };
  const renderHistory = (items = []) => {
    replace(nodes.history);
    for (const item of items) {
      const row = element('li', 'history-row');
      row.append(element('code', '', item.shortHash || '—'));
      const copy = element('span', 'history-copy');
      copy.append(element('strong', '', item.subject || '未命名提交'), element('small', '', `${item.author || '未知作者'} · ${formatTime(item.authoredAt)}`));
      row.append(copy);
      nodes.history.append(row);
    }
    if (!items.length) nodes.history.append(element('li', 'empty-state', '还没有可显示的提交记录。'));
  };
  const render = (state = {}) => {
    currentState = state;
    const available = state.available === true;
    nodes.unavailable.hidden = available;
    nodes.content.hidden = !available;
    nodes.repositoryPath.textContent = state.repository?.root || '当前工作区';
    if (!available) {
      nodes.unavailableMessage.textContent = `${state.message || 'Git 交付当前不可用。'} 这不会影响聊天、Office、Excel 或 Wiki。`;
      nodes.status.textContent = state.message || 'Git 交付当前不可用。';
      nodes.message.disabled = true;
      nodes.commit.disabled = true;
      return;
    }
    const status = state.status || {};
    const repository = state.repository || {};
    nodes.branch.textContent = repository.detached ? 'detached HEAD' : (repository.branch || '—');
    nodes.upstream.textContent = repository.upstream || '未设置上游';
    nodes.head.textContent = repository.headShort || '—';
    nodes.staged.textContent = String(status.staged || 0);
    nodes.unstaged.textContent = String(status.unstaged || 0);
    nodes.untracked.textContent = String(status.untracked || 0);
    nodes.sync.textContent = `${repository.ahead || 0} / ${repository.behind || 0}`;
    nodes.conflictBadge.hidden = !(status.conflicted > 0);
    nodes.changeTotal.textContent = status.clean ? '工作区干净' : `${status.changed || 0} 项改动`;
    nodes.changeTotal.className = `badge${status.conflicted > 0 ? ' danger' : ''}`;
    nodes.message.disabled = busy;
    renderRemote(state.remote);
    renderHistory(state.recentCommits || []);
    nodes.status.textContent = state.message || 'Git 状态已刷新。';
    updateCommitAvailability();
  };
  const refresh = async (includeRemote = false) => {
    if (busy) return;
    setBusy(true, includeRemote ? '正在读取本地 Git 与 GitHub PR 状态…' : '正在读取本地 Git 状态…');
    try {
      render(await api.refresh(includeRemote));
    } catch {
      nodes.status.textContent = 'Git 状态读取失败；没有执行任何修改。';
    } finally { setBusy(false); }
  };
  const commit = async () => {
    if (nodes.commit.disabled || !currentState?.status?.fingerprint) return;
    setBusy(true, '正在等待确认并创建本地提交…');
    try {
      const result = await api.commit(nodes.message.value, currentState.status.fingerprint);
      if (result?.state) render(result.state);
      nodes.status.textContent = result?.message || (result?.ok ? '本地提交已创建。' : '没有创建提交。');
      if (result?.ok) nodes.message.value = '';
    } catch {
      nodes.status.textContent = '没有创建提交；请刷新状态后重试。';
    } finally { setBusy(false); }
  };

  nodes.message.addEventListener('input', updateCommitAvailability);
  nodes.commit.addEventListener('click', () => void commit());
  nodes.refresh.addEventListener('click', () => void refresh(false));
  nodes.refreshRemote.addEventListener('click', () => void refresh(true));
  nodes.createPr.addEventListener('click', () => {
    const id = nodes.createPr.dataset.linkId || '';
    if (id) void api.openLink(id)
      .then((result) => { nodes.status.textContent = result?.message || '已打开 GitHub 新建 PR 页面。'; })
      .catch(() => { nodes.status.textContent = '链接已失效，请刷新后重试。'; });
  });
  nodes.close.addEventListener('click', () => window.close());
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') window.close();
    else if (event.key === 'F5') { event.preventDefault(); void refresh(event.shiftKey); }
    else if (event.ctrlKey && event.key === 'Enter') { event.preventDefault(); void commit(); }
  });
  api.onState(render);
  api.getState().then(render).catch(() => { nodes.status.textContent = 'Git 交付中心状态不可用。'; });
})();
