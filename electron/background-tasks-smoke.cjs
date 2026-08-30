const fs = require('node:fs/promises');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { dialog } = require('electron');
const { readHarnessSessionSelection } = require('./harness-workspace-sync.cjs');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, label, timeout = 240000) { const end = Date.now() + timeout; while (Date.now() < end) { if (await check()) return; await delay(1000); } throw new Error(`Background acceptance timeout: ${label}`); }
async function runBackgroundSmoke({ window, dock, supervisor, selected, workspacePath, version, target, service, realModel, origin, api, reload }) {
  const checks = {}, originalDialog = dialog.showMessageBox, notices = [], originalNotify = service.notify;
  const marker = `DSH_BG_${randomBytes(6).toString('hex')}`, startedAt = Date.now(); let confirmations = 0;
  const control = (op, request) => supervisor.credentialHost.sessionControl.request(op, request);
  service.notify = (notice) => { notices.push({ taskId: notice.task.id, runId: notice.run.id, status: notice.run.status }); originalNotify(notice); };
  dialog.showMessageBox = async (...args) => {
    if (['建立独立后台任务', '立即执行后台任务', '启用定时任务', '归档已完成记录', '释放任务名额'].includes(args.at(-1)?.title)) { confirmations++; return { response: 1 }; }
    return originalDialog(...args);
  };
  try {
    await dock.act('select', 'tasks'); const surface = dock.surfaces.get('tasks'), ui = (code) => surface.webContents.executeJavaScript(code, true);
    window.show(); window.focus(); surface.focus();
    await until(() => ui('Boolean(document.getElementById("task-tab-background"))'), 'native task tab', 15000);
    await ui('document.getElementById("task-tab-background").click()');
    checks.nativeSandbox = surface.webContents.getLastWebPreferences().sandbox === true;
    checks.foregroundCannotControl = await window.webContents.executeJavaScript('typeof window.tasksSubagentsAPI === "undefined"', true);
    const prompt = `这是本机隔离验收。只操作当前工作区中的 task-result.txt。若文件不存在写入一行 ${marker}；若已存在则再追加一行相同标记，其他文件不动。优先使用文件读写工具，不执行 shell、不安装依赖、不联网。写完后只回复完成。`;
    await ui(`(()=>{document.getElementById('background-create').open=true;document.getElementById('background-name').value='连续运行验收';document.getElementById('background-prompt').value=${JSON.stringify(prompt)};document.getElementById('background-form').requestSubmit()})()`);
    await until(() => service.state.tasks.length === 1, 'native create');
    const task = service.state.tasks[0]; checks.isolatedDirectory = task.workspacePath !== workspacePath && service.protects(task.workspacePath);
    checks.committedBaseOnly = (await fs.readFile(path.join(task.workspacePath, 'data.txt'), 'utf8')) === 'baseline\n'
      && !await fs.stat(path.join(task.workspacePath, 'new.txt')).then(() => true, () => false);
    checks.noImplicitRun = service.state.runs.length === 0;
    await fs.writeFile(`${target}.form.png`, (await surface.webContents.capturePage()).toPNG());
    if (!realModel) return { ok: Object.values(checks).every(Boolean), version, realModel, checks, confirmations };
    const execute = async (operation, id) => {
      const result = await ui(`tasksSubagentsAPI.backgroundAction(${JSON.stringify({ operation, id })})`);
      if (!result.ok) throw new Error(result.message); return result;
    };
    service.start();
    await execute('run', task.id);
    const first = service.state.runs[0];
    checks.foregroundStillSelected = await readHarnessSessionSelection(window.webContents) === selected.sessionId;
    const firstStatus = await control('task-status', { workspacePath: task.workspacePath, sessionId: first.sessionId, requestId: first.requestId });
    checks.backgroundAdmitted = firstStatus.running || firstStatus.pending || firstStatus.admitted;
    const foreground = await api(origin, 'session.prompt', { sessionId: selected.sessionId, mode: 'queue', content: [{ type: 'text', text: '前台隔离验收：只回复 FRONT_OK，不要调用任何工具。' }] });
    checks.foregroundAccepted = foreground.accepted === true;
    await until(async () => { await service.tick(); const run = service.state.runs.find((r) => r.id === first.id); if (['review', 'failed', 'waiting'].includes(run.status)) throw new Error(`${run.status}: ${run.message}`); return run.status === 'completed'; }, 'first real background run');
    checks.firstOutput = (await fs.readFile(path.join(task.workspacePath, 'task-result.txt'), 'utf8')).trim() === marker;
    await execute('run', task.id); const second = service.state.runs.at(-1);
    await until(async () => { await service.tick(); const r = service.state.runs.find((r) => r.id === second.id); if (['review', 'failed', 'waiting'].includes(r.status)) throw new Error(`${r.status}: ${r.message}`); return r.status === 'completed'; }, 'second fresh conversation');
    checks.secondOutput = (await fs.readFile(path.join(task.workspacePath, 'task-result.txt'), 'utf8')).trim().split(/\r?\n/).filter((s) => s === marker).length === 2;
    checks.distinctConversations = first.sessionId !== second.sessionId && first.requestId !== second.requestId;
    const scheduleInput = { name: '真实定时验收', prompt: `只使用文件写入工具，在当前工作区的 scheduled-result.txt 写入 SCHEDULE_${marker}。不要执行 shell、不联网、不修改其他文件，写完只回复完成。`, dailyLimit: 1, schedule: { kind: 'once', at: Date.now() + 15000 } };
    const scheduled = await ui(`tasksSubagentsAPI.backgroundAction(${JSON.stringify({ operation: 'create', input: scheduleInput })})`);
    if (!scheduled.ok) throw new Error(scheduled.message); const planned = service.state.tasks.at(-1);
    await until(() => service.state.runs.some((r) => r.taskId === planned.id), 'real wall-clock timer', 60000);
    await until(async () => { await service.tick(); const r = service.state.runs.find((r) => r.taskId === planned.id); if (['review', 'failed', 'waiting'].includes(r.status)) throw new Error(`${r.status}: ${r.message}`); return r.status === 'completed'; }, 'scheduled completion');
    checks.timerExecutedOnce = service.state.runs.filter((r) => r.taskId === planned.id).length === 1 && service.state.runs.at(-1).scheduled && !service.task(planned.id).enabled;
    checks.scheduledOutput = planned.workspacePath !== task.workspacePath && (await fs.readFile(path.join(planned.workspacePath, 'scheduled-result.txt'), 'utf8')).trim() === `SCHEDULE_${marker}`;
    await service.stop();
    const originalPid = supervisor.child.pid;
    const restored = await reload(); await restored.tick();
    checks.durableRecoveryNoDuplicate = restored.state.runs.length === 3 && restored.state.runs.every((r) => r.status === 'completed');
    checks.kernelRestarted = supervisor.child.pid !== originalPid;
    const recovered = await control('task-status', { workspacePath: task.workspacePath, sessionId: first.sessionId, requestId: first.requestId });
    checks.coldHistoryMatchesReceipt = recovered.outcome === 'completed' && recovered.admitted;
    await restored.stop();
    checks.completionNotices = notices.filter((n) => n.status === 'completed').length === 3;
    const foregroundState = await control('status', { workspacePath, sessionId: selected.sessionId });
    checks.foregroundSurvived = !foregroundState.running && foregroundState.lastTurnReason === 'completed';
    checks.sourceUntouched = (await fs.readFile(path.join(workspacePath, 'data.txt'), 'utf8')) === 'staged\nunstaged\n'
      && !await fs.stat(path.join(workspacePath, 'task-result.txt')).then(() => true, () => false);
    await ui('tasksSubagentsAPI.refresh().then(r=>window.dispatchEvent(new CustomEvent("dsh-background-state",{detail:r.background})))');
    checks.historyRendered = await ui('document.querySelectorAll("#background-history [data-run-id]").length === 3 && document.getElementById("background-history").textContent.includes("回合完成")');
    await ui('document.querySelector("#background-history article:last-child button").scrollIntoView({block:"end"})');
    await delay(100);
    const layout = await ui('(()=>{const b=document.querySelector("#background-history article:last-child button").getBoundingClientRect();return {buttonBottom:b.bottom,footerTop:document.querySelector("footer").getBoundingClientRect().top,width:innerWidth,scrollWidth:document.documentElement.scrollWidth}})()');
    checks.historyActionReachable = await ui('(()=>{const b=document.querySelector("#background-history article:last-child button").getBoundingClientRect();return b.bottom<=document.querySelector("footer").getBoundingClientRect().top && document.documentElement.scrollWidth<=innerWidth+1})()');
    await fs.writeFile(`${target}.history.png`, (await surface.webContents.capturePage()).toPNG());
    await ui(`document.querySelector('[data-run-id="${first.id}"] button[data-operation="open"]').click(); true`);
    await until(async () => await readHarnessSessionSelection(window.webContents).catch(() => '') === first.sessionId, 'open exact task conversation', 30000);
    checks.openedExactConversation = true;
    return { ok: Object.values(checks).every(Boolean), version, realModel, checks, confirmations, layout, elapsedSeconds: Math.round((Date.now() - startedAt) / 1000), notices,
      evidence: 'Real native task form and fixed IPC confirmations in an isolated test profile; real Git worktrees; two paid file-producing runs and one actual wall-clock scheduled run alongside a foreground turn; actual Harness process restart and durable scheduler reload without resubmission. Not a 24-hour soak.' };
  } catch (error) {
    await fs.writeFile(`${target}.partial.json`, JSON.stringify({ checks, confirmations, error: error.message, notices, elapsedSeconds: Math.round((Date.now() - startedAt) / 1000) }, null, 2)); throw error;
  } finally { await service.stop(); service.notify = originalNotify; dialog.showMessageBox = originalDialog; }
}
module.exports = { runBackgroundSmoke };
