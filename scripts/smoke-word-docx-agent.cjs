const { execFile } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');

const { HarnessSupervisor, resolveHarnessRuntimePaths } = require('../electron/harness-supervisor.cjs');
const { callHarnessApi, synchronizeHarnessWorkspace } = require('../electron/harness-workspace-sync.cjs');

const execFileAsync = promisify(execFile);
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

const waitForAgent = async (origin, sessionId, outputPath) => {
  const deadline = Date.now() + 240_000;
  let sawRunning = false;
  let latest;
  while (Date.now() < deadline) {
    const list = await callHarnessApi(origin, 'session.list', {}, { timeoutMs: 8000 });
    latest = Array.isArray(list?.items) ? list.items.find((item) => item?.sessionId === sessionId) : undefined;
    if (!latest) throw new Error('真实 Word 验收会话从 Harness 目录中消失。');
    if (latest.running === true) sawRunning = true;
    let outputReady = false;
    try {
      outputReady = (await fs.stat(outputPath)).isFile();
    } catch {
      outputReady = false;
    }
    if (latest.running === false && outputReady) return { sawRunning, summary: latest };
    if (sawRunning && latest.running === false && !outputReady) {
      const history = await callHarnessApi(origin, 'session.history', { sessionId, maxMessages: 8 });
      const eventTypes = Array.isArray(history?.events) ? history.events.map((entry) => entry?.event?.type).filter(Boolean) : [];
      throw new Error(`真实 Harness 轮次结束但没有生成 DOCX；事件：${eventTypes.slice(-12).join(', ')}`);
    }
    await delay(1000);
  }
  throw new Error(`真实 Harness Word 验收超时；running=${latest?.running === true}。`);
};

const main = async () => {
  const outputFile = readArgument('output');
  const credentialFile = readArgument('credential-file');
  const settingsFile = readArgument('settings-file');
  const workspaceArg = readArgument('workspace');
  if (!outputFile || !credentialFile || !workspaceArg) {
    throw new Error('用法：node scripts/smoke-word-docx-agent.cjs --output=<json> --credential-file=<yaml> [--settings-file=<yaml>] --workspace=<目录>');
  }

  const rootDir = path.resolve(__dirname, '..');
  const workspacePath = path.resolve(workspaceArg);
  const docxPath = path.join(workspacePath, 'real-harness-word.docx');
  const specPath = path.join(workspacePath, 'real-harness-word-spec.json');
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-word-agent-smoke-'));
  const homeDir = path.join(tempRoot, 'harness');
  await fs.mkdir(homeDir, { recursive: true });
  await fs.mkdir(workspacePath, { recursive: true });
  for (const target of [docxPath, specPath]) {
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
    const origin = await supervisor.start();
    const workspace = await synchronizeHarnessWorkspace({
      origin,
      workspacePath,
      fallbackTitle: 'V0.5.20 Real Word Agent Acceptance'
    });
    const permission = await callHarnessApi(origin, 'session.prompt', {
      sessionId: workspace.sessionId,
      mode: 'queue',
      content: [{ type: 'text', text: '/permission workspace-write' }]
    });
    if (permission?.accepted !== true) throw new Error('Harness 未接受 workspace-write 权限命令。');
    await waitForPermission(origin, workspace.sessionId);

    const prompt = [
      '/word-docx 请使用此 Skill 在当前工作区完成真实验收。',
      '创建 real-harness-word-spec.json，再生成可编辑的 real-harness-word.docx。',
      '文档标题为“DSH Desktop V0.5.20 真实 Harness 验收”，必须包含二级标题“端到端结果”、正文标记“REAL_HARNESS_WORD_VERIFIED”、两个项目符号、一张两列表格、页眉“DSH Desktop · Word 验收”和页脚“V0.5.20”。',
      '生成后必须调用 inspect 做结构检查；不要使用在线服务，不要生成其他文件。'
    ].join('\n');
    const receipt = await callHarnessApi(origin, 'session.prompt', {
      sessionId: workspace.sessionId,
      mode: 'queue',
      content: [{ type: 'text', text: prompt }],
      clientTimeZone: 'Asia/Shanghai'
    });
    if (receipt?.accepted !== true) throw new Error('Harness 未接受真实 Word 验收消息。');
    const run = await waitForAgent(origin, workspace.sessionId, docxPath);

    const { stdout } = await execFileAsync(runtime.nodePath, [
      runtime.docxToolPath,
      'inspect',
      '--workspace', workspacePath,
      '--input', docxPath
    ], { cwd: workspacePath, windowsHide: true, maxBuffer: 1024 * 1024 });
    const inspection = JSON.parse(stdout.trim());
    if (inspection?.ok !== true || inspection?.valid !== true) throw new Error('真实 Harness 生成的 DOCX 未通过独立结构检查。');
    const bytes = await fs.readFile(docxPath);
    const history = await callHarnessApi(origin, 'session.history', { sessionId: workspace.sessionId, maxMessages: 12 });
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
        docxPath,
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
