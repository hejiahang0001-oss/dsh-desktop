const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { ReliableInterruptController } = require('../electron/harness-reliable-interrupt.cjs');
const { HarnessSupervisor } = require('../electron/harness-supervisor.cjs');
const { callHarnessApi, synchronizeHarnessWorkspace } = require('../electron/harness-workspace-sync.cjs');

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const redact = (value) => String(value || '')
  .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[已隐藏]')
  .replace(/\b(DEEPSEEK_API_KEY|API[_ -]?KEY|ACCESS[_ -]?TOKEN|PASSWORD|SECRET)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s;&|]+)/gi, '$1=[已隐藏]');

const readArgument = (name) => {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
};

const sessionSummary = async (origin, sessionId) => {
  const list = await callHarnessApi(origin, 'session.list', {}, { timeoutMs: 8000 });
  return Array.isArray(list?.items) ? list.items.find((item) => item?.sessionId === sessionId) : undefined;
};

const waitForRunning = async (origin, sessionId) => {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const summary = await sessionSummary(origin, sessionId);
    if (!summary) throw new Error('可靠插话验收会话从 Harness 目录中消失。');
    if (summary.running === true) return summary;
    await delay(100);
  }
  throw new Error('初始长回复没有进入运行态，无法验证运行中插话。');
};

const waitForFinished = async (origin, sessionId) => {
  const deadline = Date.now() + 180_000;
  let sawRunning = false;
  while (Date.now() < deadline) {
    const summary = await sessionSummary(origin, sessionId);
    if (!summary) throw new Error('可靠插话验收会话从 Harness 目录中消失。');
    if (summary.running === true) sawRunning = true;
    if (sawRunning && summary.running === false) return summary;
    await delay(250);
  }
  throw new Error('插话后的 Harness 回复超时。');
};

const textBlocks = (history) => (Array.isArray(history?.events) ? history.events : [])
  .filter((entry) => entry?.event?.type === 'assistant/message')
  .flatMap((entry) => Array.isArray(entry.event.data?.message?.content) ? entry.event.data.message.content : [])
  .filter((block) => block?.type === 'text' || block?.type === 'thinking')
  .map((block) => String(block.text || block.thinking || ''));

const main = async () => {
  const outputFile = readArgument('output');
  const credentialFile = readArgument('credential-file');
  const settingsFile = readArgument('settings-file');
  const workspaceArg = readArgument('workspace');
  if (!outputFile || !credentialFile || !workspaceArg) {
    throw new Error('用法：node scripts/smoke-reliable-interrupt-agent.cjs --output=<json> --credential-file=<yaml> [--settings-file=<yaml>] --workspace=<目录>');
  }

  const rootDir = path.resolve(__dirname, '..');
  const workspacePath = path.resolve(workspaceArg);
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-interrupt-smoke-'));
  const homeDir = path.join(tempRoot, 'harness');
  await fs.mkdir(homeDir, { recursive: true });
  await fs.mkdir(workspacePath, { recursive: true });
  await fs.copyFile(path.resolve(credentialFile), path.join(homeDir, '.credentials.yaml'));
  if (settingsFile) await fs.copyFile(path.resolve(settingsFile), path.join(homeDir, 'settings.yaml'));

  const supervisor = new HarnessSupervisor({
    rootDir,
    resourcesPath: rootDir,
    isPackaged: false,
    homeDir,
    launchDir: workspacePath,
    logFile: path.join(tempRoot, 'logs', 'harness.log'),
    env: {}
  });

  let result;
  try {
    const origin = await supervisor.start();
    const workspace = await synchronizeHarnessWorkspace({
      origin,
      workspacePath,
      fallbackTitle: 'V0.6.1 Reliable Interrupt Acceptance'
    });
    const initial = await callHarnessApi(origin, 'session.prompt', {
      sessionId: workspace.sessionId,
      mode: 'queue',
      content: [{
        type: 'text',
        text: '请不要调用工具，直接写一篇至少六千字的中文长文，逐段分析桌面软件可靠性的各个方面；在全部内容写完前不要提前总结。'
      }],
      clientTimeZone: 'Asia/Shanghai'
    });
    if (initial?.accepted !== true) throw new Error('Harness 未接受初始长回复消息。');
    await waitForRunning(origin, workspace.sessionId);

    const controller = new ReliableInterruptController({
      getOrigin: () => origin,
      getWebContents: () => ({}),
      getWorkspacePath: () => workspacePath,
      readSelection: async () => workspace.sessionId
    });
    const directReceipt = await controller.interruptAndPrompt('请立即停止上一个长文任务，只回复一行：RELIABLE_INTERRUPT_VERIFIED');
    await waitForFinished(origin, workspace.sessionId);

    const secondInitial = await callHarnessApi(origin, 'session.prompt', {
      sessionId: workspace.sessionId,
      mode: 'queue',
      content: [{
        type: 'text',
        text: '再次不要调用工具，直接写一篇至少六千字的中文长文，分析软件测试的不同层次；完成前不要提前总结。'
      }],
      clientTimeZone: 'Asia/Shanghai'
    });
    if (secondInitial?.accepted !== true) throw new Error('Harness 未接受第二个初始长回复消息。');
    await waitForRunning(origin, workspace.sessionId);
    const queued = await callHarnessApi(origin, 'session.prompt', {
      sessionId: workspace.sessionId,
      mode: 'queue',
      content: [{ type: 'text', text: '请中断长文，只回复一行：QUEUED_INTERRUPT_VERIFIED' }],
      clientTimeZone: 'Asia/Shanghai'
    });
    if (queued?.accepted !== true) throw new Error('Harness 未接受排队插话验收消息。');
    const queuedReceipt = await controller.interruptQueued();
    await waitForFinished(origin, workspace.sessionId);

    const history = await callHarnessApi(origin, 'session.history', {
      sessionId: workspace.sessionId,
      maxMessages: 64
    });
    const assistantTexts = textBlocks(history);
    const eventTypes = Array.isArray(history?.events)
      ? history.events.map((entry) => entry?.event?.type).filter(Boolean)
      : [];
    const markerReply = assistantTexts.some((text) => text.includes('RELIABLE_INTERRUPT_VERIFIED'));
    const queuedMarkerReply = assistantTexts.some((text) => text.includes('QUEUED_INTERRUPT_VERIFIED'));
    const abortedTurns = Array.isArray(history?.events) ? history.events.filter((entry) => (
      entry?.event?.type === 'turn/end' && entry.event.data?.reason?.kind === 'aborted'
    )).length : 0;
    const turnEndKinds = Array.isArray(history?.events) ? history.events
      .filter((entry) => entry?.event?.type === 'turn/end')
      .map((entry) => entry.event.data?.reason?.kind || 'unknown') : [];
    if (!markerReply) throw new Error(`插话后没有收到标记回复；事件：${eventTypes.slice(-20).join(', ')}`);
    if (!queuedMarkerReply) throw new Error(`排队插话后没有收到标记回复；事件：${eventTypes.slice(-20).join(', ')}`);
    if (abortedTurns < 1) throw new Error('真实会话没有记录被中断的原回合。');
    if (turnEndKinds.length < 3) throw new Error(`真实会话缺少完整回合记录；回合结束原因=${turnEndKinds.join(',') || 'none'}。`);

    result = {
      ok: true,
      directReceipt,
      queuedReceipt,
      session: {
        idSuffix: workspace.sessionId.slice(-8),
        abortedTurns,
        turnEndKinds,
        markerReply,
        queuedMarkerReply,
        eventTypes: eventTypes.slice(-24)
      }
    };
  } catch (error) {
    result = { ok: false, error: redact(error?.stack || error?.message || String(error)) };
    process.exitCode = 1;
  } finally {
    await supervisor.stop();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }

  const resolvedOutput = path.resolve(outputFile);
  await fs.mkdir(path.dirname(resolvedOutput), { recursive: true });
  await fs.writeFile(resolvedOutput, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(result)}\n`);
};

void main().catch((error) => {
  process.stderr.write(`${redact(error?.stack || error?.message || String(error))}\n`);
  process.exitCode = 1;
});
