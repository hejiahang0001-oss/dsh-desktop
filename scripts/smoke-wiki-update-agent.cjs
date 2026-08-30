'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { HarnessSupervisor, resolveHarnessRuntimePaths } = require('../electron/harness-supervisor.cjs');
const { synchronizeHarnessWorkspace } = require('../electron/harness-workspace-sync.cjs');
const { authenticateHarnessSupervisor } = require('./harness-smoke-auth.cjs');

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const redact = (value) => String(value || '')
  .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[已隐藏]')
  .replace(/\b(DEEPSEEK_API_KEY|API[_ -]?KEY|ACCESS[_ -]?TOKEN|PASSWORD|SECRET)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s;&|]+)/gi, '$1=[已隐藏]');

const readArgument = (name) => {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
};

const waitForPermission = async (apiCall, origin, sessionId, expected) => {
  let actual = '';
  let projection = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const history = await apiCall(origin, 'session.history', { sessionId, maxMessages: 1 });
    projection = history?.projections?.values?.permissions || null;
    actual = projection?.currentValue || '';
    if (actual === expected) return;
    await delay(200);
  }
  throw new Error(`Harness 没有确认 ${expected} 权限；actual=${actual || 'missing'} status=${projection?.status || 'missing'} writable=${projection?.writable === true} options=${Array.isArray(projection?.options) ? projection.options.map((item) => item?.value).filter(Boolean).join(',') : 'missing'}。`);
};

const waitForAgent = async (apiCall, origin, sessionId, label) => {
  const deadline = Date.now() + 300_000;
  let sawRunning = false;
  let latest;
  while (Date.now() < deadline) {
    const list = await apiCall(origin, 'session.list', {}, { timeoutMs: 8000 });
    latest = Array.isArray(list?.items) ? list.items.find((item) => item?.sessionId === sessionId) : undefined;
    if (!latest) throw new Error(`${label} 会话从 Harness 目录中消失。`);
    if (latest.running === true) sawRunning = true;
    if (sawRunning && latest.running === false) return { sawRunning, summary: latest };
    await delay(500);
  }
  const history = await apiCall(origin, 'session.history', { sessionId, maxMessages: 40 }).catch(() => null);
  const eventTypes = Array.isArray(history?.events)
    ? history.events.map((entry) => entry?.event?.type).filter(Boolean).slice(-30)
    : [];
  const permission = history?.projections?.values?.permissions?.currentValue || 'missing';
  throw new Error(`${label} 超时；running=${latest?.running === true} permission=${permission} eventTypes=${eventTypes.join(',') || 'missing'}。`);
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
    arguments: JSON.stringify(entry.event.data?.arguments || {})
  }));

const main = async () => {
  const outputFile = readArgument('output');
  const credentialFile = readArgument('credential-file');
  const settingsFile = readArgument('settings-file');
  const packagedResources = readArgument('packaged-resources');
  if (!outputFile || !credentialFile) {
    throw new Error('用法：node scripts/smoke-wiki-update-agent.cjs --output=<json> --credential-file=<yaml> [--settings-file=<yaml>] [--packaged-resources=<目录>]');
  }

  const rootDir = path.resolve(__dirname, '..');
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-wiki-update-agent-'));
  const homeDir = path.join(tempRoot, 'harness');
  const workspacePath = path.join(tempRoot, '中文 项目知识 工作区');
  const vaultPath = path.join(tempRoot, '中文 Wiki 知识库');
  const wikiConfigPath = path.join(tempRoot, 'wiki-settings.json');
  const isPackaged = Boolean(packagedResources);
  const resourcesPath = isPackaged ? path.resolve(packagedResources) : rootDir;
  await Promise.all([
    fs.mkdir(homeDir, { recursive: true }),
    fs.mkdir(path.join(workspacePath, 'src'), { recursive: true }),
    fs.mkdir(vaultPath, { recursive: true })
  ]);
  await Promise.all([
    fs.writeFile(path.join(workspacePath, 'README.md'), '# WIKI_UPDATE_REAL_VERIFIED\n\nThis desktop project uses a fixed local Wiki synchronization boundary.\n', 'utf8'),
    fs.writeFile(path.join(workspacePath, 'src', 'app.js'), "module.exports = { mode: 'desktop-wiki-sync' };\n", 'utf8'),
    fs.writeFile(path.join(workspacePath, '.env'), 'DEEPSEEK_API_KEY=REAL_SMOKE_SECRET_MUST_NOT_LEAK\n', 'utf8')
  ]);
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

  const supervisor = new HarnessSupervisor({
    rootDir,
    resourcesPath,
    isPackaged,
    homeDir,
    launchDir: workspacePath,
    logFile: path.join(tempRoot, 'logs', 'harness.log'),
    wikiConfigPath,
    env: {}
  });
  let result;
  try {
    const authentication = await authenticateHarnessSupervisor(supervisor);
    const { origin, fetchImpl, apiCall } = authentication;
    const workspace = await synchronizeHarnessWorkspace({ origin, workspacePath, fallbackTitle: 'V1.0 Real Wiki Update Acceptance', fetchImpl });
    await waitForPermission(apiCall, origin, workspace.sessionId, 'danger-full-access');

    const previewReceipt = await apiCall(origin, 'session.prompt', {
      sessionId: workspace.sessionId,
      mode: 'queue',
      content: [{
        type: 'text',
        text: '/wiki-update 整理当前项目的架构和固定边界。必须使用 Skill 指定的固定工具完成 project-preview、生成工作区内临时规格并执行 project-validate；正文保留 WIKI_UPDATE_REAL_VERIFIED，并补充一条带 ^[inferred] 的合理推断。只完成预览和校验，向我报告页面路径后停止，不要执行 project-save。不要读取或保存 .env。'
      }],
      clientTimeZone: 'Asia/Shanghai'
    });
    if (previewReceipt?.accepted !== true) throw new Error('Harness 未接受真实 Wiki 项目预览消息。');
    const previewRun = await waitForAgent(apiCall, origin, workspace.sessionId, '真实 Wiki 项目预览');
    const manifestBefore = JSON.parse(await fs.readFile(path.join(vaultPath, '.manifest.json'), 'utf8'));
    if (Object.keys(manifestBefore.projects || {}).length !== 0) throw new Error('Agent 在确认前写入了项目知识。');
    const previewHistory = await apiCall(origin, 'session.history', { sessionId: workspace.sessionId, maxMessages: 24 });
    const previewTrace = JSON.stringify(previewHistory);
    const previewToolCalls = toolCallsOf(previewHistory);
    const firstFixedRuntimeCall = previewToolCalls.findIndex((call) => call.arguments.includes('$env:DSH_DESKTOP_NODE')
      && call.arguments.includes('project-preview'));
    const broadRuntimeSearchIndexes = previewToolCalls
      .slice(0, Math.max(firstFixedRuntimeCall, 0))
      .map((call, index) => (/(?:Get-ChildItem|where(?:\.exe)?|Resolve-Path|Test-Path)[\s\S]{0,320}(?:AppData|Programs|vendor|resources|dsh-desktop)/i.test(call.arguments) ? index : -1))
      .filter((index) => index >= 0);
    const sensitiveCallIndexes = previewToolCalls
      .map((call, index) => (/(?:^|[\\/])\.env(?:[\\/]|\b)/i.test(call.arguments) ? index : -1))
      .filter((index) => index >= 0);
    if (!previewTrace.includes('project-preview') || !previewTrace.includes('project-validate')) {
      throw new Error('真实 Agent 没有完成固定项目预览与校验。');
    }
    if (firstFixedRuntimeCall < 0
      || firstFixedRuntimeCall > 2
      || broadRuntimeSearchIndexes.length > 0
      || previewToolCalls.length > 12
      || sensitiveCallIndexes.length > 0) {
      throw new Error(`真实 Agent 没有及时使用固定桌面工具环境，或执行步骤超出上限；toolCalls=${previewToolCalls.length} firstFixedRuntimeCall=${firstFixedRuntimeCall} broadRuntimeSearchIndexes=${broadRuntimeSearchIndexes.join(',') || 'none'} sensitiveCallIndexes=${sensitiveCallIndexes.join(',') || 'none'} names=${previewToolCalls.map((call) => call.name).join(',')}。`);
    }

    const confirmReceipt = await apiCall(origin, 'session.prompt', {
      sessionId: workspace.sessionId,
      mode: 'queue',
      content: [{
        type: 'text',
        text: '我已查看并明确确认你上一步展示的项目同步页面、来源和推断比例。现在继续使用原规格执行固定 project-save；没有发现敏感内容时不添加 confirm-sensitive。完成后回复 WIKI_UPDATE_SAVED。'
      }],
      clientTimeZone: 'Asia/Shanghai'
    });
    if (confirmReceipt?.accepted !== true) throw new Error('Harness 未接受真实 Wiki 项目保存确认。');
    const saveRun = await waitForAgent(apiCall, origin, workspace.sessionId, '真实 Wiki 项目保存');
    const history = await apiCall(origin, 'session.history', { sessionId: workspace.sessionId, maxMessages: 40 });
    const trace = JSON.stringify(history);
    const reply = assistantTexts(history).join('\n');
    const manifest = JSON.parse(await fs.readFile(path.join(vaultPath, '.manifest.json'), 'utf8'));
    const projects = Object.values(manifest.projects || {});
    if (projects.length !== 1 || !Array.isArray(projects[0].pages_in_vault) || projects[0].pages_in_vault.length < 1) {
      throw new Error('真实 Agent 没有写入一个受跟踪项目。');
    }
    const overviewPath = projects[0].pages_in_vault.find((item) => item.endsWith(`/${projects[0].id}.md`)) || projects[0].pages_in_vault[0];
    const [page, log, index, hot] = await Promise.all([
      fs.readFile(path.join(vaultPath, overviewPath), 'utf8'),
      fs.readFile(path.join(vaultPath, 'log.md'), 'utf8'),
      fs.readFile(path.join(vaultPath, 'index.md'), 'utf8'),
      fs.readFile(path.join(vaultPath, 'hot.md'), 'utf8')
    ]);
    const combined = `${JSON.stringify(manifest)}\n${page}\n${log}\n${index}\n${hot}`;
    const saved = trace.includes('project-save') && /WIKI_UPDATE project=/.test(log);
    if (!saved || !page.includes('WIKI_UPDATE_REAL_VERIFIED') || !page.includes('^[inferred]') || !reply.includes('WIKI_UPDATE_SAVED')) {
      throw new Error('真实 Agent 没有完成固定保存、来源页面或确认回复。');
    }
    if (combined.includes('REAL_SMOKE_SECRET_MUST_NOT_LEAK') || projects[0].files.some((item) => item.path === '.env' || item.path.startsWith('.dsh-wiki-'))) {
      throw new Error('项目同步包含了凭据文件或临时同步规格。');
    }
    const unchanged = await wiki.previewProjectSync(vaultPath, workspacePath);
    if (!unchanged.unchanged) throw new Error('真实 Agent 保存后项目清单仍显示未同步。');
    result = {
      ok: true,
      mode: isPackaged ? 'installed' : 'source',
      session: {
        previewSawRunning: previewRun.sawRunning,
        saveSawRunning: saveRun.sawRunning,
        finished: saveRun.summary?.running === false,
        eventTypes: Array.isArray(history?.events) ? history.events.map((entry) => entry?.event?.type).filter(Boolean).slice(-24) : []
      },
      skill: 'wiki-update',
      fixedPreviewCalled: true,
      fixedValidateCalled: true,
      fixedSaveCalled: true,
      fixedRuntimeEnvironmentUsed: true,
      firstFixedRuntimeCall,
      previewToolCalls: previewToolCalls.length,
      confirmationSeparated: true,
      projectPath: overviewPath,
      provenanceMarked: true,
      sensitiveSourceExcluded: true,
      unchangedAfterSave: true,
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
