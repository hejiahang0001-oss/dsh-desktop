'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { HarnessSupervisor, resolveHarnessRuntimePaths } = require('../electron/harness-supervisor.cjs');
const { callHarnessApi, synchronizeHarnessWorkspace } = require('../electron/harness-workspace-sync.cjs');

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const redact = (value) => String(value || '')
  .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[已隐藏]')
  .replace(/\b(DEEPSEEK_API_KEY|API[_ -]?KEY|ACCESS[_ -]?TOKEN|PASSWORD|SECRET)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s;&|]+)/gi, '$1=[已隐藏]');

const readArgument = (name) => {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
};

const waitForPermission = async (origin, sessionId) => {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const history = await callHarnessApi(origin, 'session.history', { sessionId, maxMessages: 1 });
    if (history?.projections?.values?.permissions?.currentValue === 'workspace-write') return;
    await delay(200);
  }
  throw new Error('Harness 没有确认 workspace-write 权限。');
};

const waitForAgent = async (origin, sessionId) => {
  const deadline = Date.now() + 300_000;
  let sawRunning = false;
  let latest;
  while (Date.now() < deadline) {
    const list = await callHarnessApi(origin, 'session.list', {}, { timeoutMs: 8000 });
    latest = Array.isArray(list?.items) ? list.items.find((item) => item?.sessionId === sessionId) : undefined;
    if (!latest) throw new Error('真实 Wiki 验收会话从 Harness 目录中消失。');
    if (latest.running === true) sawRunning = true;
    if (sawRunning && latest.running === false) return { sawRunning, summary: latest };
    await delay(500);
  }
  throw new Error(`真实 Harness Wiki 查询超时；running=${latest?.running === true}。`);
};

const assistantTexts = (history) => (Array.isArray(history?.events) ? history.events : [])
  .filter((entry) => entry?.event?.type === 'assistant/message')
  .flatMap((entry) => Array.isArray(entry.event.data?.message?.content) ? entry.event.data.message.content : [])
  .filter((block) => block?.type === 'text')
  .map((block) => String(block.text || ''));

const main = async () => {
  const outputFile = readArgument('output');
  const credentialFile = readArgument('credential-file');
  const settingsFile = readArgument('settings-file');
  if (!outputFile || !credentialFile) {
    throw new Error('用法：node scripts/smoke-wiki-query-agent.cjs --output=<json> --credential-file=<yaml> [--settings-file=<yaml>]');
  }

  const rootDir = path.resolve(__dirname, '..');
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-wiki-agent-smoke-'));
  const homeDir = path.join(tempRoot, 'harness');
  const workspacePath = path.join(tempRoot, '中文 Wiki Agent 工作区');
  const vaultPath = path.join(workspacePath, 'Wiki 知识库');
  const wikiConfigPath = path.join(tempRoot, 'wiki-settings.json');
  await Promise.all([
    fs.mkdir(homeDir, { recursive: true }),
    fs.mkdir(vaultPath, { recursive: true })
  ]);
  await fs.copyFile(path.resolve(credentialFile), path.join(homeDir, '.credentials.yaml'));
  if (settingsFile) await fs.copyFile(path.resolve(settingsFile), path.join(homeDir, 'settings.yaml'));
  const runtime = resolveHarnessRuntimePaths({ rootDir, resourcesPath: rootDir, isPackaged: false, env: {} });
  const wiki = require(runtime.wikiToolPath);
  const settings = new wiki.WikiSettingsStore({ filePath: wikiConfigPath });
  await settings.init();
  await settings.setVault(vaultPath);
  await wiki.initializeWikiVault(vaultPath);
  await fs.writeFile(path.join(vaultPath, 'concepts', 'real-agent.md'), [
    '---',
    'title: "WIKI_REAL_QUERY_VERIFIED"',
    'summary: "真实 Harness Agent 已调用固定 Wiki 查询工具。"',
    'sources:',
    '  - "dsh-real-agent:v0.6.4"',
    'lifecycle: verified',
    '---',
    '',
    '# WIKI_REAL_QUERY_VERIFIED',
    '',
    '返回页面路径 concepts/real-agent.md 和记录来源。',
    ''
  ].join('\n'), 'utf8');

  const supervisor = new HarnessSupervisor({
    rootDir,
    resourcesPath: rootDir,
    isPackaged: false,
    homeDir,
    launchDir: workspacePath,
    logFile: path.join(tempRoot, 'logs', 'harness.log'),
    wikiConfigPath,
    env: {}
  });
  let result;
  try {
    const origin = await supervisor.start();
    const workspace = await synchronizeHarnessWorkspace({ origin, workspacePath, fallbackTitle: 'V0.6.4 Real Wiki Agent Acceptance' });
    const permission = await callHarnessApi(origin, 'session.prompt', {
      sessionId: workspace.sessionId,
      mode: 'queue',
      content: [{ type: 'text', text: '/permission workspace-write' }]
    });
    if (permission?.accepted !== true) throw new Error('Harness 未接受 workspace-write 权限命令。');
    await waitForPermission(origin, workspace.sessionId);
    const receipt = await callHarnessApi(origin, 'session.prompt', {
      sessionId: workspace.sessionId,
      mode: 'queue',
      content: [{
        type: 'text',
        text: '/wiki-query 查询 WIKI_REAL_QUERY_VERIFIED。必须调用 Skill 指定的固定离线 Wiki 工具；回答必须包含页面路径 concepts/real-agent.md 和来源 dsh-real-agent:v0.6.4，不要调用网络或修改知识页面。'
      }],
      clientTimeZone: 'Asia/Shanghai'
    });
    if (receipt?.accepted !== true) throw new Error('Harness 未接受真实 Wiki 查询消息。');
    const run = await waitForAgent(origin, workspace.sessionId);
    const history = await callHarnessApi(origin, 'session.history', { sessionId: workspace.sessionId, maxMessages: 16 });
    const reply = assistantTexts(history).join('\n');
    const log = await fs.readFile(path.join(vaultPath, 'log.md'), 'utf8');
    const toolCalled = /QUERY query=.*WIKI_REAL_QUERY_VERIFIED/i.test(log);
    if (!toolCalled || !reply.includes('concepts/real-agent.md') || !reply.includes('dsh-real-agent:v0.6.4')) {
      throw new Error('真实 Agent 没有完成固定 Wiki 工具查询或没有返回来源。');
    }
    result = {
      ok: true,
      session: {
        sawRunning: run.sawRunning,
        finished: run.summary?.running === false,
        eventTypes: Array.isArray(history?.events) ? history.events.map((entry) => entry?.event?.type).filter(Boolean).slice(-20) : []
      },
      skill: 'wiki-query',
      fixedToolCalled: toolCalled,
      pagePathReturned: true,
      sourceReturned: true,
      credentialCopiedOnlyToTemporaryHome: true,
      temporaryHomeRemoved: true
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
