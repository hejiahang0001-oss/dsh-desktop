// Isolated integration instrumentation only. No tools or public RPCs.
export const name = 'dsh-cold-read-probe';
export const inject = ['agents', 'sessions'];
export function apply(ctx) {
  let createdAgents = 0;
  ctx.on('agent/created', () => { createdAgents++; });
  const terminalPending = new Set();
  const listener = (request) => {
    if (request?.channel === 'dsh-terminal-read-v1' && terminalPending.delete(request.requestId)) {
      process.send({ channel: 'dsh-cold-read-probe', requestId: request.requestId,
        value: { terminalDenied: request.ok === false, error: request.error } });
      return;
    }
    if (request?.channel !== 'dsh-cold-read-probe' || !/^[a-f0-9-]{36}$/i.test(request.requestId || '')) return;
    if (request.operation === 'terminal-check') {
      terminalPending.add(request.requestId);
      process.send({ channel: 'dsh-terminal-read-v1', requestId: request.requestId, operation: 'read',
        sessionId: request.sessionId, workspacePath: request.workspacePath, maxChars: 200 });
      return;
    }
    if (request.operation !== 'inspect') return;
    process.send({ channel: 'dsh-cold-read-probe', requestId: request.requestId,
      value: { createdAgents, liveAgent: Boolean(ctx.agents.get(request.sessionId)),
        liveSession: Boolean(ctx.sessions.get(request.sessionId)) } });
  };
  process.on('message', listener);
  ctx.on('dispose', () => process.off('message', listener));
}
