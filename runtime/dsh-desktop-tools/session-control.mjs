import path from 'node:path';
import { realpath, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const CHANNEL = 'dsh-session-control-v1';
const validId = (id) => /^session-[a-f0-9-]{36}$/i.test(id || '');
const pathKey = (value) => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
const digest = (events) => createHash('sha256').update(JSON.stringify(events)).digest('hex');
async function canonicalDirectory(value) {
  if (typeof value !== 'string' || value.length > 2048 || !path.isAbsolute(value) || /[\0-\x1f]/.test(value)) throw new Error('无效的任务工作区。');
  const stat = await lstat(value), resolved = await realpath(value);
  if (!stat.isDirectory() || stat.isSymbolicLink() || pathKey(resolved) !== pathKey(value)) throw new Error('任务目录不能经过文件链接。');
  return resolved;
}
async function baseline(ctx) {
  const abort = new AbortController(), iterator = ctx.sessionController.control(abort.signal)[Symbol.asyncIterator]();
  try { const first = await iterator.next(); if (first.value?.type !== 'baseline') throw new Error('任务状态基线不可用。'); return first.value.value; }
  finally { abort.abort(); await iterator.return?.(); }
}
async function workspaceActivity(ctx, directory, exceptId = '') {
  const catalog = await ctx.sessionController.list({}), state = await baseline(ctx);
  const ids = catalog.items.filter((row) => row.sessionId !== exceptId && row.cwd && pathKey(row.cwd) === pathKey(directory));
  const running = ids.filter((row) => row.running).length;
  const pending = ids.reduce((sum, row) => sum + (state.queues[row.sessionId]?.length || 0), 0);
  const jobs = ids.reduce((sum, row) => sum + (state.jobs[row.sessionId] || []).filter((j) => ['running', 'stopping'].includes(j.status)).length, 0);
  return { idle: !running && !pending && !jobs, running, pending, jobs };
}
function summary(ctx, observation, control, withHistory = true) {
  const { header, events } = observation, agent = ctx.agents.get(header.id);
  const pendingApprovals = new Set(); let turnOpen = false, lastTurnReason = null;
  for (const event of events) {
    if (event.type === 'approval/asked') pendingApprovals.add(event.data.id);
    if (event.type === 'approval/decided') pendingApprovals.delete(event.data.id);
    if (event.type === 'turn/start') turnOpen = true;
    if (event.type === 'turn/end') { turnOpen = false; pendingApprovals.clear(); lastTurnReason = event.data.reason?.kind || null; }
  }
  const queue = control.queues[header.id] || [], jobs = control.jobs[header.id] || [];
  return { sessionId: header.id, workspacePath: header.cwd, cursor: observation.cursor,
    ...(withHistory ? { historyHash: digest(events) } : {}), eventCount: events.length, agentPreset: header.agentPreset || null,
    running: agent?.status === 'running', pending: queue.length, queued: queue.filter((item) => item.placement === 'queued').length,
    steering: queue.filter((item) => item.placement === 'steering').length, approvals: pendingApprovals.size,
    liveJobs: jobs.filter((job) => ['running', 'stopping'].includes(job.status)).length, turnOpen, lastTurnReason };
}
export async function sessionControl(ctx, operation, request) {
  if (!['inspect', 'status', 'workspace-status', 'fork', 'resume-queue', 'task-create', 'task-prompt', 'task-status', 'task-cancel'].includes(operation) || !validId(request?.sessionId)) throw new Error('不支持此任务控制操作。');
  const sourcePath = await canonicalDirectory(request.workspacePath);
  if (operation === 'workspace-status') return workspaceActivity(ctx, sourcePath);
  if (operation === 'task-create') {
    if (!(await workspaceActivity(ctx, sourcePath)).idle) throw new Error('这个任务目录还有其他会话、排队消息或后台命令，未并发开工。');
    if (ctx.sessions.get(request.sessionId)) throw new Error('任务会话已存在；未重复创建。');
    const created = await ctx.sessionController.create({ sessionId: request.sessionId, cwd: sourcePath, agentPreset: 'standard' });
    // Agent-local optional service: public strict lookup, not an undeclared
    // property injection on the desktop plugin's composition context.
    const agent = ctx.agents.get(created.sessionId), permissions = agent?.ctx.get('permissionPresets');
    const preset = permissions?.resolve('workspace-write');
    if (!agent || preset?.sandbox !== 'workspace-write' || preset?.approval !== 'ask') throw new Error('后台权限预设不满足工作区写入和逐项审批要求，未发送任务。');
    permissions.set(agent.session, 'workspace-write');
    if (permissions.current(agent.session) !== 'workspace-write') throw new Error('后台权限设置未通过校验。');
    await ctx.sessionPersistence.ensureMaterialized(agent.session);
    const workspace = await ctx.workspaceRegistry.create(sourcePath);
    await workspace.attachSession(created.sessionId);
    return { sessionId: created.sessionId, workspacePath: sourcePath, permission: 'workspace-write', approval: 'ask' };
  }
  const targetPath = operation === 'fork' ? await canonicalDirectory(request.targetPath) : null;
  const control = await baseline(ctx);
  const observation = await ctx.sessionQuery.observeSession(request.sessionId);
  try {
    if (observation.header.origin === 'subagent' || !observation.header.cwd || pathKey(observation.header.cwd) !== pathKey(sourcePath)) throw new Error('会话不属于指定的普通工作区。');
    const state = summary(ctx, observation, control, ['inspect', 'fork'].includes(operation));
    if (['inspect', 'status'].includes(operation)) return state;
    if (operation === 'task-prompt') {
      if (!(await workspaceActivity(ctx, sourcePath, request.sessionId)).idle) throw new Error('任务目录的另一会话已经开始工作，未提交任务。');
      const agent = ctx.agents.get(request.sessionId), permissions = agent?.ctx.get('permissionPresets');
      const preset = permissions?.resolve('workspace-write');
      if (!agent || preset?.sandbox !== 'workspace-write' || preset?.approval !== 'ask' || permissions.current(agent.session) !== 'workspace-write') throw new Error('后台会话权限发生变化；未提交任务。');
      if (state.running || state.pending || observation.events.some((e) => e.type === 'user/message' && e.data.source?.kind === 'user')) throw new Error('后台会话已有工作；未重复提交。');
      if (!/^[a-f0-9-]{36}$/i.test(request.requestId || '') || typeof request.text !== 'string' || !request.text.trim() || request.text.length > 8000 || request.text.includes('\0')) throw new Error('后台任务输入无效。');
      return await ctx.sessionController.prompt({ sessionId: request.sessionId, requestId: request.requestId, mode: 'queue', clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        content: [{ type: 'text', text: request.text }] }, AbortSignal.timeout(45000));
    }
    if (operation === 'task-status') {
      if (!/^[a-f0-9-]{36}$/i.test(request.requestId || '')) throw new Error('运行身份无效。');
      let turn = null, acceptedTurn = null, admitted = false, outcome = null;
      for (const event of observation.events) {
        if (event.type === 'turn/start') turn = event.data.turn;
        if (event.type === 'user/message' && event.data.source?.rpcId === request.requestId) { admitted = true; acceptedTurn = turn; }
        if (event.type === 'turn/end' && acceptedTurn !== null && event.data.turn === acceptedTurn) outcome = event.data.reason?.kind || null;
      }
      return { ...state, admitted, outcome };
    }
    if (operation === 'task-cancel') {
      const agent = ctx.agents.get(request.sessionId); if (!agent) throw new Error('任务没有活动实例；请先核对上次运行。');
      // Native user action on a dedicated task session; never other sessions.
      agent.cancel({ kind: 'user' }, { keepInbox: false });
      return { accepted: true };
    }
    if (operation === 'resume-queue') {
      const agent = ctx.agents.get(request.sessionId);
      if (!agent || !agent.inbox.nextTurn.some((item) => item.id === request.itemId)) throw new Error('排队消息已离开队列；未重复发送。');
      if (agent.status === 'running') throw new Error('当前回合尚未停止，请稍后继续队列。');
      // Public Agent/Inbox APIs, one synchronous host operation: reinsert the
      // last existing item in the same position and wake FIFO processing.
      // No text reconstruction, new message identity or transport gap.
      const tail = agent.inbox.nextTurn.at(-1);
      agent.inbox.remove(tail.id);
      agent.followup(tail);
      return { accepted: true, sessionId: request.sessionId };
    }
    if (state.running || state.pending || state.liveJobs || state.approvals || state.turnOpen || ctx.agents.get(request.sessionId)?.inbox?.hasPending) throw new Error('请先结束执行、排队消息、审批和后台命令，再交接会话。');
    if (request.historyHash !== state.historyHash || !validId(request.childId) || request.childId === request.sessionId || pathKey(sourcePath) === pathKey(targetPath)) throw new Error('会话或交接目标已变化，请重新确认。');
    if (observation.events.length > 20000 || Buffer.byteLength(JSON.stringify(observation.events)) > 8 * 1024 * 1024) throw new Error('会话历史超过安全交接上限，请先压缩上下文。');
    if (ctx.sessions.get(request.childId)) throw new Error('交接目标会话已存在，请打开已有恢复记录，不能重复创建。');
    // Publish a fully composed Agent+Session transaction. A bare live Session
    // cannot be resumed by the Web controller while it lacks its live Agent.
    const sourceAgent = ctx.agents.get(request.sessionId);
    const preset = sourceAgent ? ctx.agentPresets.composedPreset(sourceAgent.ctx)
      : observation.projections?.values?.agentPreset || observation.header.agentPreset;
    if (typeof preset !== 'string' || !preset) throw new Error('源会话的 Agent 预设尚不可确认。');
    const handle = await ctx.agents.create({ sessionId: request.childId, seed: observation.events,
      inheritedEventCount: observation.events.length, meta: {
      cwd: targetPath, parentSession: request.sessionId, isSeeded: true,
      agentPreset: preset
    }, agentOptions: ctx.agentDefaultModel.currentSelection(),
    setup: (agentCtx) => sourceAgent ? void ctx.agentPresets.composeFrom(agentCtx, sourceAgent.ctx) : ctx.agentPresets.mount(agentCtx, preset).then(() => {}) });
    const child = handle.agent.session;
    await ctx.sessionPersistence.ensureMaterialized(child);
    const workspace = await ctx.workspaceRegistry.create(targetPath);
    await workspace.attachSession(child.id);
    const verified = await ctx.sessionController.inspect(child.id);
    const inherited = verified.events.slice(0, observation.events.length), appended = verified.events.slice(observation.events.length);
    // Public Session.create appends one empty end-seed boundary when needed.
    // Validate the exact inherited prefix, metadata AND the allowed boundary.
    if (pathKey(verified.meta.cwd) !== pathKey(targetPath) || verified.meta.parentSession !== request.sessionId
      || verified.meta.isSeeded !== true || verified.inheritedEventCount !== observation.events.length || digest(inherited) !== state.historyHash
      || appended.length > 1 || appended.some((event) => event.type !== 'session/end-seed' || Object.keys(event.data).length)) throw new Error('交接持久化校验失败；原会话和目标目录均保留。');
    return { ...state, sessionId: child.id, sourceSessionId: request.sessionId, workspacePath: targetPath, workspaceId: workspace.id, inheritedEvents: observation.events.length };
  } finally { observation[Symbol.dispose](); }
}
export function attachSessionControl(ctx, peer = process) {
  let busy = false;
  const listener = async (request) => {
    if (request?.channel !== CHANNEL || !/^[a-f0-9-]{36}$/i.test(request.requestId || '')) return;
    const reply = (value) => { if (peer.connected) peer.send({ channel: CHANNEL, requestId: request.requestId, ...value }, () => {}); };
    if (busy) { reply({ ok: false, error: '另一项会话检查或交接尚未完成。' }); return; }
    busy = true;
    try { reply({ ok: true, value: await sessionControl(ctx, request.operation, request.payload) }); }
    catch (error) { reply({ ok: false, error: error.message || '会话控制失败。' }); }
    finally { busy = false; }
  };
  peer.on('message', listener); return () => peer.off('message', listener);
}
