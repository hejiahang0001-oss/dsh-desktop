const { execFile } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');

const { HarnessSupervisor, resolveHarnessRuntimePaths } = require('../electron/harness-supervisor.cjs');
const { synchronizeHarnessWorkspace } = require('../electron/harness-workspace-sync.cjs');
const { readZip } = require('../resources/skills/word-docx/scripts/word-docx.cjs');
const { authenticateHarnessSupervisor } = require('./harness-smoke-auth.cjs');

const execFileAsync = promisify(execFile);
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const redact = (value) => String(value || '')
  .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[已隐藏]')
  .replace(/\b(DEEPSEEK_API_KEY|API[_ -]?KEY|ACCESS[_ -]?TOKEN|PASSWORD|SECRET)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s;&|]+)/gi, '$1=[已隐藏]');

const readArgument = (name) => {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
};

const waitForPermission = async (apiCall, origin, sessionId) => {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const history = await apiCall(origin, 'session.history', { sessionId, maxMessages: 1 });
    if (history?.projections?.values?.permissions?.currentValue === 'workspace-write') return;
    await delay(200);
  }
  throw new Error('Harness 没有确认 workspace-write 权限。');
};

const waitForAgent = async (apiCall, origin, sessionId, outputPath) => {
  const deadline = Date.now() + 300_000;
  let sawRunning = false;
  let latest;
  while (Date.now() < deadline) {
    const list = await apiCall(origin, 'session.list', {}, { timeoutMs: 8000 });
    latest = Array.isArray(list?.items) ? list.items.find((item) => item?.sessionId === sessionId) : undefined;
    if (!latest) throw new Error('真实 PowerPoint 验收会话从 Harness 目录中消失。');
    if (latest.running === true) sawRunning = true;
    let outputReady = false;
    try {
      outputReady = (await fs.stat(outputPath)).isFile();
    } catch {
      outputReady = false;
    }
    if (latest.running === false && outputReady) return { sawRunning, summary: latest };
    if (sawRunning && latest.running === false && !outputReady) {
      const history = await apiCall(origin, 'session.history', { sessionId, maxMessages: 8 });
      const eventTypes = Array.isArray(history?.events) ? history.events.map((entry) => entry?.event?.type).filter(Boolean) : [];
      throw new Error(`真实 Harness 轮次结束但没有生成 PPTX；事件：${eventTypes.slice(-12).join(', ')}`);
    }
    await delay(1000);
  }
  throw new Error(`真实 Harness PowerPoint 验收超时；running=${latest?.running === true}。`);
};

const main = async () => {
  const outputFile = readArgument('output');
  const credentialFile = readArgument('credential-file');
  const settingsFile = readArgument('settings-file');
  const workspaceArg = readArgument('workspace');
  if (!outputFile || !credentialFile || !workspaceArg) {
    throw new Error('用法：node scripts/smoke-powerpoint-pptx-agent.cjs --output=<json> --credential-file=<yaml> [--settings-file=<yaml>] --workspace=<目录>');
  }

  const rootDir = path.resolve(__dirname, '..');
  const workspacePath = path.resolve(workspaceArg);
  const pptxPath = path.join(workspacePath, 'real-harness-powerpoint.pptx');
  const specPath = path.join(workspacePath, 'real-harness-powerpoint-spec.json');
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-powerpoint-agent-smoke-'));
  const homeDir = path.join(tempRoot, 'harness');
  await fs.mkdir(homeDir, { recursive: true });
  await fs.mkdir(workspacePath, { recursive: true });
  for (const target of [pptxPath, specPath]) {
    try {
      await fs.access(target);
      throw new Error(`真实 Harness 验收拒绝覆盖既有文件：${target}`);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  await fs.copyFile(path.resolve(credentialFile), path.join(homeDir, '.credentials.yaml'));
  if (settingsFile) await fs.copyFile(path.resolve(settingsFile), path.join(homeDir, 'settings.yaml'));

  const runtime = resolveHarnessRuntimePaths({ rootDir, resourcesPath: rootDir, isPackaged: false, env: {} });
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
    const authentication = await authenticateHarnessSupervisor(supervisor);
    const { origin, fetchImpl, apiCall } = authentication;
    const workspace = await synchronizeHarnessWorkspace({
      origin,
      workspacePath,
      fallbackTitle: 'V1.0 Real PowerPoint Agent Acceptance',
      fetchImpl
    });
    const permission = await apiCall(origin, 'session.prompt', {
      sessionId: workspace.sessionId,
      mode: 'queue',
      content: [{ type: 'text', text: '/permission workspace-write' }]
    });
    if (permission?.accepted !== true) throw new Error('Harness 未接受 workspace-write 权限命令。');
    await waitForPermission(apiCall, origin, workspace.sessionId);

    const prompt = [
      '/powerpoint-pptx 请使用此 Skill 在当前工作区完成真实验收。',
      '创建 real-harness-powerpoint-spec.json，再生成可编辑的 real-harness-powerpoint.pptx。',
      '演示文稿必须恰好 3 页：封面、能力表格、区域计划与实际柱形图。每页都要有演讲者备注。',
      '第 2 页必须包含文本标记 REAL_HARNESS_POWERPOINT_VERIFIED 和至少一个表格；第 3 页必须包含 North/South 两个分类以及 Plan/Actual 两个系列的原生 column 图表。',
      '使用内置主题、真实母版和版式；不要使用在线服务，不要添加图片，不要生成其他文件。',
      '生成后必须调用 inspect --strict 做结构检查。'
    ].join('\n');
    const receipt = await apiCall(origin, 'session.prompt', {
      sessionId: workspace.sessionId,
      mode: 'queue',
      content: [{ type: 'text', text: prompt }],
      clientTimeZone: 'Asia/Shanghai'
    });
    if (receipt?.accepted !== true) throw new Error('Harness 未接受真实 PowerPoint 验收消息。');
    const run = await waitForAgent(apiCall, origin, workspace.sessionId, pptxPath);

    const { stdout } = await execFileAsync(runtime.nodePath, [
      runtime.pptxToolPath,
      'inspect',
      '--workspace', workspacePath,
      '--input', pptxPath,
      '--strict'
    ], { cwd: workspacePath, windowsHide: true, maxBuffer: 1024 * 1024 });
    const inspection = JSON.parse(stdout.trim());
    if (inspection?.ok !== true || inspection?.slides !== 3 || inspection?.tables < 1 || inspection?.charts < 1) {
      throw new Error('真实 Harness 生成的 PPTX 未通过独立结构检查。');
    }
    if (inspection.notes !== 3 || inspection.masters !== 1 || inspection.layouts < 2 || inspection.embeddedWorkbooks < 1) {
      throw new Error('真实 Harness 生成的 PPTX 缺少备注、母版、版式或内嵌图表数据。');
    }
    const bytes = await fs.readFile(pptxPath);
    const entries = readZip(bytes);
    const slideText = [...entries.entries()]
      .filter(([name]) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
      .map(([, data]) => data.toString('utf8'))
      .join('\n');
    if (!slideText.includes('REAL_HARNESS_POWERPOINT_VERIFIED')) {
      throw new Error('真实 Harness 生成的 PPTX 缺少验收标记。');
    }
    const history = await apiCall(origin, 'session.history', { sessionId: workspace.sessionId, maxMessages: 12 });
    result = {
      ok: true,
      session: {
        sawRunning: run.sawRunning,
        finished: run.summary?.running === false,
        eventTypes: Array.isArray(history?.events)
          ? history.events.map((entry) => entry?.event?.type).filter(Boolean).slice(-20)
          : []
      },
      output: {
        pptxPath,
        specPath,
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex').toUpperCase()
      },
      inspection
    };
  } catch (error) {
    result = { ok: false, error: redact(error.stack || error.message) };
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
  process.stderr.write(`${redact(error.stack || error.message)}\n`);
  process.exitCode = 1;
});
