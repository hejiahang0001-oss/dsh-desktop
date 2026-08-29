'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { HarnessSupervisor, resolveHarnessRuntimePaths } = require('../electron/harness-supervisor.cjs');
const { callHarnessApi, synchronizeHarnessWorkspace } = require('../electron/harness-workspace-sync.cjs');
const { prepareDshHistorySource } = require('../electron/wiki-history-ingest.cjs');

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const redact = (value) => String(value || '')
  .replace(/\b(?:sk|ds)-[A-Za-z0-9_-]{8,}\b/g, '[已隐藏]')
  .replace(/\b(DEEPSEEK_API_KEY|API[_ -]?KEY|ACCESS[_ -]?TOKEN|PASSWORD|SECRET)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s;&|]+)/gi, '$1=[已隐藏]');

const readArgument = (name) => {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
};

const waitForPermission = async (origin, sessionId, expected) => {
  let actual = '';
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const history = await callHarnessApi(origin, 'session.history', { sessionId, maxMessages: 1 });
    actual = history?.projections?.values?.permissions?.currentValue || '';
    if (actual === expected) return;
    await delay(200);
  }
  throw new Error(`Harness 没有确认 ${expected} 权限；actual=${actual || 'missing'}。`);
};

const waitForAgent = async (origin, sessionId, label) => {
  const deadline = Date.now() + 300_000;
  let sawRunning = false;
  let latest;
  while (Date.now() < deadline) {
    const list = await callHarnessApi(origin, 'session.list', {}, { timeoutMs: 8000 });
    latest = Array.isArray(list?.items) ? list.items.find((item) => item?.sessionId === sessionId) : undefined;
    if (!latest) throw new Error(`${label} 会话从 Harness 目录中消失。`);
    if (latest.running === true) sawRunning = true;
    if (sawRunning && latest.running === false) return { sawRunning, summary: latest };
    await delay(500);
  }
  throw new Error(`${label} 超时；running=${latest?.running === true}。`);
};

const assistantTexts = (history) => (Array.isArray(history?.events) ? history.events : [])
  .filter((entry) => entry?.event?.type === 'assistant/message')
  .flatMap((entry) => Array.isArray(entry.event.data?.message?.content) ? entry.event.data.message.content : [])
  .filter((block) => block?.type === 'text')
  .map((block) => String(block.text || ''));

const toolCallsOf = (history) => (Array.isArray(history?.events) ? history.events : [])
  .filter((entry) => entry?.event?.type === 'tool/call')
  .map((entry) => ({
    name: String(entry.event.data?.name || ''),
    arguments: JSON.stringify(entry.event.data?.arguments || {}),
    rawArguments: entry.event.data?.arguments || {}
  }));

const main = async () => {
  const outputFile = readArgument('output');
  const credentialFile = readArgument('credential-file');
  const settingsFile = readArgument('settings-file');
  const packagedResources = readArgument('packaged-resources');
  if (!outputFile || !credentialFile) {
    throw new Error('用法：node scripts/smoke-wiki-history-agent.cjs --output=<json> --credential-file=<yaml> [--settings-file=<yaml>] [--packaged-resources=<目录>]');
  }

  const rootDir = path.resolve(__dirname, '..');
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-wiki-history-agent-'));
  const homeDir = path.join(tempRoot, 'harness');
  const workspacePath = path.join(tempRoot, '中文 历史导入 工作区');
  const vaultPath = path.join(tempRoot, '中文 Wiki 知识库');
  const wikiConfigPath = path.join(tempRoot, 'wiki-settings.json');
  const historySourcePath = path.join(tempRoot, 'wiki-history-source.json');
  const rawSecret = 'sk-REAL_HISTORY_SECRET_MUST_NOT_LEAK_1234567890';
  const isPackaged = Boolean(packagedResources);
  const resourcesPath = isPackaged ? path.resolve(packagedResources) : rootDir;
  await Promise.all([fs.mkdir(homeDir, { recursive: true }), fs.mkdir(workspacePath, { recursive: true }), fs.mkdir(vaultPath, { recursive: true })]);
  await fs.writeFile(path.join(workspacePath, 'README.md'), '# History ingest smoke\n', 'utf8');
  await fs.copyFile(path.resolve(credentialFile), path.join(homeDir, '.credentials.yaml'));
  const temporarySettings = path.join(homeDir, 'settings.yaml');
  if (settingsFile) await fs.copyFile(path.resolve(settingsFile), temporarySettings);
  const existingSettings = await fs.readFile(temporarySettings, 'utf8').catch(() => '');
  if (/^permission:\s*$/m.test(existingSettings)) throw new Error('临时验收设置已有 permission 节，拒绝不透明改写。');
  await fs.writeFile(temporarySettings, `${existingSettings.trimEnd()}\npermission:\n  defaultPreset: danger-full-access\n`, 'utf8');

  const runtime = resolveHarnessRuntimePaths({ rootDir, resourcesPath, isPackaged, env: {} });
  const wiki = require(runtime.wikiToolPath);
  const settings = new wiki.WikiSettingsStore({ filePath: wikiConfigPath });
  await settings.init();
  await settings.setVault(vaultPath);
  await wiki.initializeWikiVault(vaultPath);

  const summary = {
    sessionId: 'real-source-session-not-written',
    updatedAt: Date.now(),
    running: false,
    blank: false,
    cwd: workspacePath,
    projections: { values: { title: 'DSH 历史真实验收' } }
  };
  const sourcePrepared = await prepareDshHistorySource({
    apiCall: async (_origin, method) => {
      if (method !== 'session.history') throw new Error(`unexpected method ${method}`);
      return {
        hasMore: false,
        events: [
          { event: { seq: 1, time: Date.now() - 1000, type: 'user/message', data: { message: { role: 'user', content: [{ type: 'text', text: `请记住 DSH_HISTORY_REAL_VERIFIED。DEEPSEEK_API_KEY=${rawSecret}` }] } } } },
          { event: { seq: 2, time: Date.now(), type: 'assistant/message', data: { message: { role: 'assistant', content: [{ type: 'text', text: '历史导入必须保持原始会话只读，并先预览再确认。' }] } } } }
        ]
      };
    },
    origin: 'http://127.0.0.1:1',
    summaries: [summary],
    workspacePath,
    sourcePath: historySourcePath
  });
  if (!sourcePrepared.redactions.some((item) => item.count > 0)) throw new Error('桌面历史源没有在 Agent 前遮蔽测试凭据。');

  const supervisor = new HarnessSupervisor({
    rootDir,
    resourcesPath,
    isPackaged,
    homeDir,
    launchDir: workspacePath,
    logFile: path.join(tempRoot, 'logs', 'harness.log'),
    wikiConfigPath,
    wikiHistorySourcePath: historySourcePath,
    env: {}
  });
  let result;
  try {
    const origin = await supervisor.start();
    const workspace = await synchronizeHarnessWorkspace({ origin, workspacePath, fallbackTitle: 'V0.6.5 Real Wiki History Acceptance' });
    await waitForPermission(origin, workspace.sessionId, 'danger-full-access');

    const previewReceipt = await callHarnessApi(origin, 'session.prompt', {
      sessionId: workspace.sessionId,
      mode: 'queue',
      content: [{
        type: 'text',
        text: '/wiki-history-ingest dsh 请把已准备历史整理为一个主题页面。第一项工具调用必须直接执行固定 history-preview，之前不要调用 todo、计划或其他工具；随后使用固定工具完成 history-session、生成唯一临时规格和 history-validate。页面保留 DSH_HISTORY_REAL_VERIFIED，并带 ^[extracted]。只预览和校验，报告页面与敏感遮蔽后停止，不要执行 history-save。'
      }],
      clientTimeZone: 'Asia/Shanghai'
    });
    if (previewReceipt?.accepted !== true) throw new Error('Harness 未接受真实 DSH 历史预览消息。');
    const previewRun = await waitForAgent(origin, workspace.sessionId, '真实 DSH 历史预览');
    const manifestBefore = JSON.parse(await fs.readFile(path.join(vaultPath, '.manifest.json'), 'utf8'));
    if (Object.keys(manifestBefore.history?.dsh || {}).length !== 0) throw new Error('Agent 在确认前写入了历史知识。');
    const previewHistory = await callHarnessApi(origin, 'session.history', { sessionId: workspace.sessionId, maxMessages: 28 });
    const previewTrace = JSON.stringify(previewHistory);
    const previewToolCalls = toolCallsOf(previewHistory);
    const previewSaveCalled = previewToolCalls.some((call) => (
      call.name === 'pwsh' && /(?:^|\s)history-save(?:\s|$)/u.test(String(call.rawArguments?.command || ''))
    ));
    if (!previewTrace.includes('history-preview') || !previewTrace.includes('history-session') || !previewTrace.includes('history-validate') || previewSaveCalled) {
      const replies = assistantTexts(previewHistory).join(' | ').slice(-1600);
      throw new Error(`真实 Agent 没有完成固定历史预览/校验边界；preview=${previewTrace.includes('history-preview')} session=${previewTrace.includes('history-session')} validate=${previewTrace.includes('history-validate')} save=${previewSaveCalled} tools=${previewToolCalls.map((call) => `${call.name}:${call.arguments}`).join(' | ').slice(-2400)} replies=${replies}。`);
    }
    const firstFixedRuntimeCall = previewToolCalls.findIndex((call) => call.arguments.includes('$env:DSH_DESKTOP_NODE') && call.arguments.includes('history-preview'));
    const sensitiveCall = previewToolCalls.find((call) => call.arguments.includes(rawSecret));
    if (firstFixedRuntimeCall !== 0 || previewToolCalls.length > 12 || sensitiveCall) {
      throw new Error(`真实 Agent 没有及时使用固定工具，或执行步骤超出上限；toolCalls=${previewToolCalls.length} firstFixedRuntimeCall=${firstFixedRuntimeCall}。`);
    }
    if (previewTrace.includes(rawSecret)) throw new Error('真实 Agent 历史轨迹泄露了遮蔽前凭据。');

    const confirmReceipt = await callHarnessApi(origin, 'session.prompt', {
      sessionId: workspace.sessionId,
      mode: 'queue',
      content: [{
        type: 'text',
        text: '我已查看并明确确认上一步展示的历史导入页面、来源和推断比例，也明确确认源中发生过凭据遮蔽。现在使用原规格执行固定 history-save，同时添加历史确认和敏感确认；完成后回复 DSH_HISTORY_SAVED。'
      }],
      clientTimeZone: 'Asia/Shanghai'
    });
    if (confirmReceipt?.accepted !== true) throw new Error('Harness 未接受真实 DSH 历史保存确认。');
    const saveRun = await waitForAgent(origin, workspace.sessionId, '真实 DSH 历史保存');
    const history = await callHarnessApi(origin, 'session.history', { sessionId: workspace.sessionId, maxMessages: 44 });
    const trace = JSON.stringify(history);
    const reply = assistantTexts(history).join('\n');
    const manifest = JSON.parse(await fs.readFile(path.join(vaultPath, '.manifest.json'), 'utf8'));
    const projects = Object.values(manifest.history?.dsh || {});
    if (projects.length !== 1 || !Array.isArray(projects[0].pages_in_vault) || projects[0].pages_in_vault.length !== 1) {
      throw new Error('真实 Agent 没有写入一个受跟踪历史项目页面。');
    }
    const pagePath = projects[0].pages_in_vault[0];
    const [page, log, index, hot] = await Promise.all([
      fs.readFile(path.join(vaultPath, pagePath), 'utf8'),
      fs.readFile(path.join(vaultPath, 'log.md'), 'utf8'),
      fs.readFile(path.join(vaultPath, 'index.md'), 'utf8'),
      fs.readFile(path.join(vaultPath, 'hot.md'), 'utf8')
    ]);
    const combined = `${JSON.stringify(manifest)}\n${page}\n${log}\n${index}\n${hot}\n${trace}`;
    if (!trace.includes('history-save') || !/DSH_HISTORY_INGEST project=/.test(log) || !page.includes('DSH_HISTORY_REAL_VERIFIED') || !page.includes('^[extracted]') || !reply.includes('DSH_HISTORY_SAVED')) {
      throw new Error('真实 Agent 没有完成固定历史保存、来源页面或确认回复。');
    }
    if (combined.includes(rawSecret) || !combined.includes('[已遮蔽凭据]') || await fs.access(historySourcePath).then(() => true, () => false)) {
      throw new Error('真实历史导入凭据遮蔽或短期源清理未通过。');
    }
    result = {
      ok: true,
      mode: isPackaged ? 'installed' : 'source',
      session: { previewSawRunning: previewRun.sawRunning, saveSawRunning: saveRun.sawRunning, finished: saveRun.summary?.running === false },
      skill: 'wiki-history-ingest',
      fixedPreviewCalled: true,
      fixedSessionReadCalled: true,
      fixedValidateCalled: true,
      fixedSaveCalled: true,
      confirmationSeparated: true,
      sensitiveConfirmationUsed: true,
      redactedBeforeAgent: true,
      sourceCleared: true,
      pagePath,
      credentialCopiedOnlyToTemporaryHome: true,
      temporaryHomeRemoved: true
    };
  } catch (error) {
    result = { ok: false, mode: isPackaged ? 'installed' : 'source', error: redact(error?.stack || error?.message || String(error)) };
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
