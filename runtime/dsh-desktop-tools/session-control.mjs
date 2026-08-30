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
function summary(ctx, observation, control) {
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
    historyHash: digest(events), eventCount: events.length, agentPreset: header.agentPreset || null,
    running: agent?.status === 'running', pending: queue.length, queued: queue.filter((item) => item.placement === 'queued').length,
    steering: queue.filter((item) => item.placement === 'steering').length, approvals: pendingApprovals.size,
    liveJobs: jobs.filter((job) => ['running', 'stopping'].includes(job.status)).length, turnOpen, lastTurnReason };
}
export async function sessionControl(ctx, operation, request) {
  if (!['inspect', 'fork', 'resume-queue'].includes(operation) || !validId(request?.sessionId)) throw new Error('不支持此任务控制操作。');
  const sourcePath = await canonicalDirectory(request.workspacePath);
  const targetPath = operation === 'fork' ? await canonicalDirectory(request.targetPath) : null;
  const control = await baseline(ctx);
  const observation = await ctx.sessionQuery.observeSession(request.sessionId);
  try {
    if (observation.header.origin === 'subagent' || !observation.header.cwd || pathKey(observation.header.cwd) !== pathKey(sourcePath)) throw new Error('会话不属于指定的普通工作区。');
    const state = summary(ctx, observation, control);
    if (operation === 'inspect') return state;
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
    const handle = await ctx.agents.create({ sessionId: request.childId, seed: observation.events, meta: {
      cwd: targetPath, parentSession: request.sessionId, seedLength: observation.events.length,
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
      || verified.meta.seedLength !== observation.events.length || digest(inherited) !== state.historyHash
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
