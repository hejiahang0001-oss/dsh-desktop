(() => {
  const api = window.tasksSubagentsAPI;
  if (!api?.backgroundAction) return;
  const $ = (id) => document.getElementById(id), form = $('background-form');
  let busy = false, state = { tasks: [], runs: [] }, activeTab = 'current', lastRender = '';
  const active = new Set(['preparing', 'submitting', 'running', 'waiting', 'stopping', 'reconciling']);
  const labels = { preparing: '准备中', submitting: '正在提交', running: '运行中', waiting: '等待确认', stopping: '正在停止', reconciling: '核对上次状态', completed: '回合完成', failed: '执行失败', canceled: '已停止', review: '结果待核对', reviewed: '已人工核对' };
  const date = (value) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '无';
  const schedule = (s) => s.kind === 'manual' ? '仅手动' : s.kind === 'once' ? `一次 · ${date(s.at)}` : s.kind === 'daily' ? `每天 ${s.time}` : `每 ${s.minutes} 分钟`;
  const node = (tag, text, cls) => { const n = document.createElement(tag); n.textContent = text; if (cls) n.className = cls; return n; };
  function tab(value) {
    activeTab = value;
    for (const name of ['current', 'background']) { $(`task-tab-${name}`).setAttribute('aria-pressed', String(name === value)); $(`${name}-task-panel`).hidden = name !== value; }
    if (value === 'background') render(true);
  }
  for (const name of ['current', 'background']) $(`task-tab-${name}`).addEventListener('click', () => tab(name));
  function addAction(parent, text, operation, id, disabled = false) {
    const b = node('button', text); b.type = 'button'; b.dataset.operation = operation; b.dataset.id = id; b.disabled = busy || disabled;
    b.addEventListener('click', () => void action({ operation, id })); parent.append(b);
  }
  async function action(request) {
    if (busy) return; busy = true;
    $('status').textContent = '正在处理，请留意本机确认窗口…';
    for (const b of $('background-task-panel').querySelectorAll('button')) b.disabled = true;
    try {
      const result = await api.backgroundAction(request);
      if (result?.state?.background) state = result.state.background;
      $('status').textContent = !result?.ok ? result?.message || '未完成操作。' : result.result?.canceled ? '已取消，未改变计划。' : '操作已记录；执行结果以运行记录为准。';
      if (result?.ok && request.operation === 'create' && !result.result?.canceled) { form.reset(); scheduleInputs(); $('background-create').open = false; }
    } catch { $('status').textContent = '未确认操作结果，请刷新核对，不要重复提交。'; }
    finally { busy = false; $('background-submit').disabled = false; $('background-archive').disabled = false; render(true); }
  }
  function render(force = false) {
    $('background-summary').textContent = `${state.tasks.length} / ${state.limits?.tasks || 12} 项任务 · ${state.active || 0} / 2 项正在执行 · 本机时区 ${Intl.DateTimeFormat().resolvedOptions().timeZone}`;
    $('background-warning').hidden = !state.warning; $('background-warning').textContent = state.warning || '';
    const fingerprint = JSON.stringify(state);
    if (activeTab !== 'background' || busy || !force && fingerprint === lastRender) return;
    const focused = document.activeElement?.dataset, focusKey = focused?.operation ? { operation: focused.operation, id: focused.id } : null;
    const expanded = new Set(Array.from($('background-list').querySelectorAll('article:has(details[open])')).map((n) => n.dataset.taskId));
    lastRender = fingerprint;
    $('background-list').replaceChildren(); $('background-history').replaceChildren();
    if (!state.tasks.length) $('background-list').append(node('p', '还没有独立任务。先打开一个 Git 工作区，再新建任务。', 'empty-state'));
    for (const task of state.tasks) {
      const card = node('article', '', 'background-card'); card.dataset.taskId = task.id;
      const running = state.runs.some((r) => r.taskId === task.id && (active.has(r.status) || r.status === 'review'));
      card.append(node('h3', task.name), node('p', `${schedule(task.schedule)} · ${task.enabled ? '计划已启用' : '计划未启用'} · 下次 ${task.enabled ? date(task.nextAt) : '无'} · 每日上限 ${task.dailyLimit}`, 'background-meta'), node('p', task.workspacePath, 'background-meta'));
      const detail = document.createElement('details'); detail.open = expanded.has(task.id); detail.append(node('summary', '查看任务内容与分支'), node('pre', `${task.prompt}\n\n分支：${task.branch}\n基础提交：${task.baseHead}`)); card.append(detail);
      const actions = node('div', '', 'background-actions');
      addAction(actions, '立即运行', 'run', task.id, running || !state.available || state.active >= 2);
      if (task.schedule.kind !== 'manual') addAction(actions, task.enabled ? '暂停计划' : '启用计划', task.enabled ? 'pause' : 'resume', task.id);
      addAction(actions, '释放任务名额', 'release', task.id, task.enabled || running);
      card.append(actions); $('background-list').append(card);
    }
    if (!state.runs.length) $('background-history').append(node('p', '尚无运行记录。归档不会删除原会话或产出文件。', 'empty-state'));
    for (const run of [...state.runs].reverse()) {
      const task = state.tasks.find((t) => t.id === run.taskId), card = node('article', '', 'background-card'); card.dataset.runId = run.id;
      if (['waiting', 'review', 'failed'].includes(run.status)) card.classList.add(`is-${run.status}`);
      card.append(node('h3', `${task?.name || '任务'} · ${labels[run.status] || run.status}`), node('p', `${date(run.createdAt)} · ${run.scheduled ? '计划触发' : '手动触发'} · …${run.sessionId.slice(-8)}`, 'background-meta'), node('p', run.message, 'background-meta'));
      const actions = node('div', '', 'background-actions'); addAction(actions, run.status === 'waiting' ? '打开会话处理确认' : '打开会话', 'open', run.id);
      if (active.has(run.status)) addAction(actions, '停止本次并暂停计划', 'stop', run.id, ['preparing', 'submitting', 'stopping'].includes(run.status));
      if (run.status === 'review') addAction(actions, '已核对旧会话', 'acknowledge', run.id);
      card.append(actions); $('background-history').append(card);
    }
    if (focusKey) Array.from($('background-task-panel').querySelectorAll('button')).find((b) => b.dataset.operation === focusKey.operation && b.dataset.id === focusKey.id)?.focus();
  }
  function scheduleInputs() {
    for (const type of ['once', 'daily', 'interval']) { $(`background-${type}-label`).hidden = $('background-schedule').value !== type; $(`background-${type}`).required = $('background-schedule').value === type; }
  }
  $('background-schedule').addEventListener('change', scheduleInputs);
  $('background-template').addEventListener('change', () => {
    if ($('background-prompt').value.trim()) { $('status').textContent = '已有任务内容，未覆盖。需要示例时先清空内容。'; return; }
    const examples = {
      review: ['周期代码审查', '审查当前独立工作区的代码与测试，按严重程度列出有文件和行号依据的问题、影响与建议，写入 review-report.md。不要修改业务代码，不自动提交或合并，不安装依赖。不能运行的测试应明确记录原因。只使用本任务目录，不宣称已同步远端。'],
      pr: ['PR 状态检查', '检查当前仓库相关 GitHub PR 的检查结果和待处理审查意见，输出带链接和检查时间的摘要到 pr-status.md。只读查询远端，不发表评论、不修改 PR、不推送或合并。需要本机 gh 与登录时先检查可用性；不可用则明确报告，不读取、索取或输出凭据。']
    };
    const selected = examples[$('background-template').value];
    if (selected) { if (!$('background-name').value.trim()) $('background-name').value = selected[0]; $('background-prompt').value = selected[1]; }
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault(); if (!form.reportValidity()) return;
    const kind = $('background-schedule').value, schedule = { kind };
    if (kind === 'once') { schedule.at = +new Date($('background-once').value); if (!Number.isFinite(schedule.at) || schedule.at <= Date.now()) { $('status').textContent = '请选择未来的本机时间。'; return; } }
    if (kind === 'daily') schedule.time = $('background-daily').value;
    if (kind === 'interval') schedule.minutes = Number($('background-interval').value);
    void action({ operation: 'create', input: { name: $('background-name').value, prompt: $('background-prompt').value, schedule, dailyLimit: Number($('background-limit').value) } });
  });
  $('background-archive').addEventListener('click', () => void action({ operation: 'archive' }));
  window.addEventListener('dsh-background-state', (event) => { if (event.detail) { state = event.detail; render(); } });
  api.getState().then((s) => { if (s.background) { state = s.background; render(); } }).catch(() => {});
  scheduleInputs();
})();
