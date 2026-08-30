const path = require('node:path');
const fs = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const { AtomicJsonFile } = require('./atomic-json-store.cjs');
const { isSessionId, pathKey } = require('./harness-workspace-sync.cjs');
const MAX_TASKS = 12, MAX_RUNS = 300, MAX_ACTIVE = 2;
const ID = /^[a-f0-9-]{36}$/i;
const ACTIVE = new Set(['preparing', 'submitting', 'running', 'waiting', 'stopping', 'reconciling']);
const STATES = new Set([...ACTIVE, 'completed', 'failed', 'canceled', 'review', 'reviewed']);
const absolute = (value) => typeof value === 'string' && value.length <= 2048 && path.isAbsolute(value) && !/[\0-\x1f]/.test(value);
const boundedText = (value, min, max) => typeof value === 'string' && value.trim().length >= min && value.length <= max && !value.includes('\0');
function scheduleValid(schedule) {
  return schedule?.kind === 'manual'
    || schedule?.kind === 'once' && Number.isSafeInteger(schedule.at) && schedule.at > 0
    || schedule?.kind === 'interval' && Number.isSafeInteger(schedule.minutes) && schedule.minutes >= 15 && schedule.minutes <= 1440
    || schedule?.kind === 'daily' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(schedule.time || '');
}
function nextDue(schedule, now) {
  if (schedule.kind === 'manual') return null;
  if (schedule.kind === 'once') return schedule.at;
  if (schedule.kind === 'interval') return now + schedule.minutes * 60000;
  const [hour, minute] = schedule.time.split(':').map(Number), date = new Date(now);
  date.setHours(hour, minute, 0, 0); if (+date <= now) date.setDate(date.getDate() + 1);
  return +date;
}
function validState(value) {
  return value?.version === 1 && Array.isArray(value.tasks) && value.tasks.length <= MAX_TASKS
    && Array.isArray(value.runs) && value.runs.length <= MAX_RUNS
    && new Set(value.tasks.map((t) => t.id)).size === value.tasks.length
    && new Set(value.tasks.map((t) => pathKey(t.workspacePath))).size === value.tasks.length
    && new Set(value.runs.map((r) => r.id)).size === value.runs.length
    && new Set(value.runs.map((r) => r.sessionId)).size === value.runs.length
    && new Set(value.runs.map((r) => r.requestId)).size === value.runs.length
    && value.tasks.every((t) => ID.test(t.id) && boundedText(t.name, 1, 80) && boundedText(t.prompt, 1, 8000)
      && absolute(t.sourcePath) && absolute(t.workspacePath) && /^[a-f0-9]{24}$/.test(t.worktreeId)
      && boundedText(t.branch, 1, 256) && /^[a-f0-9]{40,64}$/.test(t.baseHead) && scheduleValid(t.schedule)
      && typeof t.enabled === 'boolean' && Number.isInteger(t.dailyLimit) && t.dailyLimit >= 1 && t.dailyLimit <= 96
      && typeof t.usageDay === 'string' && Number.isInteger(t.runsToday) && t.runsToday >= 0 && t.runsToday <= 96
      && (t.nextAt === null || Number.isSafeInteger(t.nextAt)))
    && value.runs.every((r) => ID.test(r.id) && value.tasks.some((t) => t.id === r.taskId) && isSessionId(r.sessionId)
      && ID.test(r.requestId) && STATES.has(r.status) && Number.isSafeInteger(r.createdAt));
}
class BackgroundTasks {
  constructor({ filePath, manager, control, prompt, cancel, ready = () => true, notify = () => {}, now = Date.now }) {
    Object.assign(this, { manager, control, prompt, cancel, ready, notify, now });
    this.file = new AtomicJsonFile({ filePath, validator: validState }); this.state = { version: 1, tasks: [], runs: [] };
    this.queue = Promise.resolve(); this.tickPromise = null; this.creating = false; this.timer = null; this.stopping = false;
    this.warning = ''; this.pending = new Set();
  }
  async init() {
    const saved = await this.file.read({ fallback: this.state }); this.state = saved.value;
    const exists = await fs.stat(this.file.filePath).then(() => true, () => false);
    const uncertain = saved.source === 'backup' || saved.source === 'fallback' && exists;
    if (uncertain) {
      this.warning = '任务记录从备用状态恢复或主记录损坏，全部定时计划已暂停；请先核对旧会话。';
      if (exists) {
        const archiveRoot = path.join(path.dirname(this.file.filePath), 'task-archives'); await fs.mkdir(archiveRoot, { recursive: true });
        await fs.copyFile(this.file.filePath, path.join(archiveRoot, `recovered-${this.now()}-${randomUUID()}.json`), require('node:fs').constants.COPYFILE_EXCL);
      }
    }
    await this.edit((s) => {
      if (uncertain) for (const task of s.tasks) task.enabled = false;
      for (const run of s.runs) if (ACTIVE.has(run.status)) { run.status = 'reconciling'; run.message = '正在核对上次记录；不会自动重新提交。'; }
    });
  }
  edit(change) {
    const task = this.queue.then(async () => { const copy = structuredClone(this.state); change(copy); await this.file.write(copy); this.state = copy; });
    this.queue = task.catch(() => {}); return task;
  }
  snapshot() { return { ...structuredClone(this.state), warning: this.warning, active: this.state.runs.filter((r) => ACTIVE.has(r.status)).length, limits: { tasks: MAX_TASKS, active: MAX_ACTIVE, runs: MAX_RUNS }, available: this.ready() }; }
  requiresBackground() { return this.creating || this.pending.size > 0 || this.state.tasks.some((t) => t.enabled) || this.state.runs.some((r) => ACTIVE.has(r.status)); }
  protects(directory) { return this.state.tasks.some((t) => pathKey(t.workspacePath) === pathKey(directory)); }
  start() { if (!this.timer) { this.stopping = false; this.timer = setInterval(() => void this.tick().catch((e) => { this.warning = `后台检查失败：${e.message}`; }), 5000); this.timer.unref?.(); } }
  async stop() { this.stopping = true; clearInterval(this.timer); this.timer = null; await this.tickPromise?.catch(() => {}); await this.queue; }
  task(id) { const task = this.state.tasks.find((t) => t.id === id); if (!task) throw new Error('任务不存在，请刷新列表。'); return task; }
  async verify(task) {
    const { item } = await this.manager.resolve({ workspacePath: task.sourcePath, id: task.worktreeId });
    if (!item.managed || !item.pathSafe || item.branch !== task.branch || pathKey(item.path) !== pathKey(task.workspacePath)) throw new Error('任务目录或分支已变化，已停止自动运行。');
    return item;
  }
  async create(input, sourcePath, confirm) {
    if (this.creating) throw new Error('另一项任务正在创建。');
    if (!boundedText(input?.name, 1, 80) || !boundedText(input?.prompt, 1, 8000) || !scheduleValid(input.schedule)
      || !Number.isInteger(input.dailyLimit) || input.dailyLimit < 1 || input.dailyLimit > 96 || !absolute(sourcePath)) throw new Error('任务名称、内容、时间或每日上限无效。');
    if (input.schedule.kind === 'once' && input.schedule.at <= this.now()) throw new Error('一次性计划必须选择未来时间。');
    if (this.state.tasks.length >= MAX_TASKS) throw new Error('独立任务已达到 12 项上限，请先释放不再需要的任务。');
    this.creating = true;
    try {
      const before = await this.manager.inspect(sourcePath);
      if (!before.available || before.status !== 'ready' || !before.repository.head) throw new Error(before.message || '需要具有提交记录的 Git 工作区。');
      if (!await confirm({ input, sourcePath, repository: before.repository })) return { canceled: true };
      const after = await this.manager.inspect(sourcePath);
      if (!after.available || after.repository.head !== before.repository.head || after.repository.root !== before.repository.root) throw new Error('确认期间源仓库已变化，请重试。');
      const created = await this.manager.create({ workspacePath: sourcePath });
      const verified = await this.manager.resolve({ workspacePath: sourcePath, id: created.createdId });
      if (verified.item.head !== before.repository.head) throw new Error('创建期间源提交发生变化；新目录已保留，但未启用计划。');
      const task = { id: randomUUID(), name: input.name.trim(), prompt: input.prompt.trim(), schedule: structuredClone(input.schedule), dailyLimit: input.dailyLimit,
        sourcePath, workspacePath: created.path, worktreeId: created.createdId, branch: created.branch, baseHead: before.repository.head,
        enabled: input.schedule.kind !== 'manual', nextAt: nextDue(input.schedule, this.now()), createdAt: this.now(), usageDay: '', runsToday: 0 };
      await this.edit((s) => s.tasks.push(task)); return { task: structuredClone(task) };
    } finally { this.creating = false; }
  }
  async setEnabled(id, enabled) {
    if (typeof enabled !== 'boolean') throw new Error('无效的计划状态。');
    const task = this.task(id); if (enabled) {
      await this.verify(task);
      if (this.state.runs.some((r) => r.taskId === id && r.status === 'review')) throw new Error('请先核对上次执行结果。');
      if (task.schedule.kind === 'manual') throw new Error('手动任务请使用立即运行。');
    }
    await this.edit((s) => { const t = s.tasks.find((t) => t.id === id); t.enabled = enabled; if (enabled) t.nextAt = nextDue(t.schedule, this.now()); });
  }
  async patchRun(id, patch, expectedStatus = null) {
    let changed = false;
    await this.edit((s) => { const run = s.runs.find((r) => r.id === id); if (!run || expectedStatus && run.status !== expectedStatus) return;
      Object.assign(run, patch, { updatedAt: this.now() }); changed = true; });
    return changed;
  }
  async run(id, { scheduled = false } = {}) {
    const task = this.task(id);
    if (this.stopping || !this.ready()) throw new Error('Harness 尚未就绪；任务没有提交。');
    if (this.pending.has(id)) throw new Error('任务正在提交，请不要重复点击。');
    this.pending.add(id); let run;
    try {
      await this.verify(task);
      await this.edit((s) => {
        if (this.stopping || !this.ready()) throw new Error('运行环境正在切换，未提交任务。');
        if (s.runs.some((r) => r.taskId === id && (ACTIVE.has(r.status) || r.status === 'review'))) throw new Error('此任务仍有执行或待核对记录，不能重复运行。');
        if (s.runs.filter((r) => ACTIVE.has(r.status)).length >= MAX_ACTIVE) throw new Error('已有两项后台执行，请稍后运行。');
        const current = s.tasks.find((t) => t.id === id), day = new Date(this.now()).toDateString();
        if (!current || scheduled && (!current.enabled || current.nextAt === null || current.nextAt > this.now())) throw new Error('计划已暂停或时间已变化，未提交任务。');
        if (current.usageDay !== day) { current.usageDay = day; current.runsToday = 0; }
        if (current.runsToday >= task.dailyLimit) throw new Error('已达到此任务今天的运行上限。');
        if (s.runs.length >= MAX_RUNS) throw new Error('运行记录已到 300 条上限，请先归档已完成记录。');
        run = { id: randomUUID(), taskId: id, sessionId: `session-${randomUUID()}`, requestId: randomUUID(), status: 'preparing', createdAt: this.now(), updatedAt: this.now(), scheduled, message: '准备独立会话，尚未提交。' };
        s.runs.push(run);
        current.runsToday++;
        if (scheduled) { current.nextAt = current.schedule.kind === 'once' ? null : nextDue(current.schedule, this.now()); if (current.schedule.kind === 'once') current.enabled = false; }
      });
      await this.control('task-create', { workspacePath: task.workspacePath, sessionId: run.sessionId });
      await this.patchRun(run.id, { status: 'submitting', message: '已记录提交身份，正在请求执行。' });
      const receipt = await this.prompt({ workspacePath: task.workspacePath, sessionId: run.sessionId, requestId: run.requestId, text: task.prompt });
      if (!receipt?.accepted) throw new Error('内核未确认任务受理。');
      await this.patchRun(run.id, { status: 'running', message: '已受理，等待真实执行结果。' });
      return { runId: run.id, sessionId: run.sessionId };
    } catch (error) {
      if (run && this.state.runs.some((r) => r.id === run.id)) { await this.patchRun(run.id, { status: 'review', message: `提交结果需核对：${error.message} 不会自动重复。` }); await this.setEnabled(id, false); this.notify({ task, run: this.state.runs.find((r) => r.id === run.id) }); }
      throw error;
    } finally { this.pending.delete(id); }
  }
  tick() {
    if (this.tickPromise) return this.tickPromise;
    if (this.stopping || !this.ready()) return Promise.resolve();
    this.tickPromise = this.poll().finally(() => { this.tickPromise = null; }); return this.tickPromise;
  }
  async poll() {
    for (const entry of this.state.runs.filter((r) => ACTIVE.has(r.status) || r.status === 'review')) {
      if (this.pending.has(entry.taskId)) continue;
      const task = this.task(entry.taskId);
      try {
        await this.verify(task);
        const state = await this.control('task-status', { workspacePath: task.workspacePath, sessionId: entry.sessionId, requestId: entry.requestId });
        let status = state.approvals ? 'waiting' : state.running || state.pending || state.liveJobs ? entry.status === 'stopping' ? 'stopping' : 'running'
          : state.outcome === 'completed' ? 'completed' : ['aborted', 'interrupted'].includes(state.outcome) ? 'canceled' : state.outcome ? 'failed' : 'review';
        const message = { waiting: '等待你确认；打开会话处理。', running: '正在执行。', stopping: '正在停止；后台命令以实际状态为准。', completed: '内核确认本次回合完成，请打开会话检查结果。', canceled: '本次回合已停止。', failed: '本次回合失败，请打开会话查看原因。', review: '上次执行结果不明，需要人工核对；不会自动重跑。' }[status];
        if (status !== entry.status || message !== entry.message) {
          if (!await this.patchRun(entry.id, { status, message }, entry.status)) continue;
          if (['waiting', 'completed', 'failed', 'review'].includes(status)) this.notify({ task, run: this.state.runs.find((r) => r.id === entry.id) });
          if (['failed', 'review'].includes(status)) await this.setEnabled(task.id, false);
        }
      } catch (error) {
        if (this.ready() && entry.status !== 'review') {
          if (!await this.patchRun(entry.id, { status: 'review', message: `状态不能确认：${error.message} 计划已暂停，未自动重跑。` }, entry.status)) continue;
          await this.setEnabled(task.id, false);
          this.notify({ task, run: this.state.runs.find((r) => r.id === entry.id) });
        }
      }
    }
    for (const task of this.state.tasks.filter((t) => t.enabled && t.nextAt !== null && t.nextAt <= this.now())) {
      if (this.stopping || this.state.runs.filter((r) => ACTIVE.has(r.status)).length >= MAX_ACTIVE) break;
      if (this.state.runs.some((r) => r.taskId === task.id && (ACTIVE.has(r.status) || r.status === 'review'))) continue;
      try { await this.run(task.id, { scheduled: true }); } catch (error) {
        this.warning = error.message;
        if (error.message.includes('今天的运行上限')) {
          const tomorrow = new Date(this.now()); tomorrow.setHours(24, 0, 0, 0);
          await this.edit((s) => { s.tasks.find((t) => t.id === task.id).nextAt = +tomorrow; });
        }
        else await this.setEnabled(task.id, false);
      }
    }
  }
  async cancelRun(id) {
    const run = this.state.runs.find((r) => r.id === id);
    if (!run || !ACTIVE.has(run.status) || this.pending.has(run.taskId)) throw new Error('此运行不可停止或仍在提交，请稍后刷新。');
    const task = this.task(run.taskId); await this.verify(task);
    const receipt = await this.cancel({ workspacePath: task.workspacePath, sessionId: run.sessionId });
    if (!receipt?.accepted) throw new Error('未确认停止请求。');
    await this.patchRun(id, { status: 'stopping', message: '停止已申请，尚未确认全部操作结束。' }); await this.setEnabled(task.id, false);
  }
  async acknowledge(id) {
    const run = this.state.runs.find((r) => r.id === id); if (!run || run.status !== 'review') throw new Error('没有待核对记录。');
    await this.patchRun(id, { status: 'reviewed', message: '用户已核对并结束此记录；旧会话保留，未重新发送。' });
  }
  async archiveCompleted() {
    const removed = this.state.runs.filter((r) => ['completed', 'canceled', 'reviewed'].includes(r.status));
    if (!removed.length) return 0;
    const archive = new AtomicJsonFile({ filePath: path.join(path.dirname(this.file.filePath), 'task-archives', `${this.now()}-${randomUUID()}.json`) });
    await archive.write({ version: 1, tasks: this.state.tasks, runs: removed });
    const ids = new Set(removed.map((r) => r.id)); await this.edit((s) => { s.runs = s.runs.filter((r) => !ids.has(r.id)); }); return removed.length;
  }
  async release(id) {
    const task = this.task(id);
    if (task.enabled || this.pending.has(id) || this.state.runs.some((r) => r.taskId === id && (ACTIVE.has(r.status) || r.status === 'review'))) throw new Error('请先暂停计划并核对或结束当前运行。');
    const archive = new AtomicJsonFile({ filePath: path.join(path.dirname(this.file.filePath), 'task-archives', `released-${this.now()}-${randomUUID()}.json`) });
    await archive.write({ version: 1, tasks: [task], runs: this.state.runs.filter((r) => r.taskId === id) });
    await this.edit((s) => { s.tasks = s.tasks.filter((t) => t.id !== id); s.runs = s.runs.filter((r) => r.taskId !== id); });
    return { workspacePath: task.workspacePath, retained: true };
  }
}
module.exports = { BackgroundTasks, nextDue, scheduleValid, validState, ACTIVE, MAX_TASKS, MAX_RUNS, MAX_ACTIVE };
