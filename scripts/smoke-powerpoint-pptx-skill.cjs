const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { HarnessSupervisor } = require('../electron/harness-supervisor.cjs');
const { synchronizeHarnessWorkspace } = require('../electron/harness-workspace-sync.cjs');
const { authenticateHarnessSupervisor } = require('./harness-smoke-auth.cjs');

const readArgument = (name) => {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
};

const main = async () => {
  const outputFile = readArgument('output');
  const packagedResources = readArgument('packaged-resources');
  if (!outputFile) {
    throw new Error('用法：node scripts/smoke-powerpoint-pptx-skill.cjs --output=<json> [--packaged-resources=<目录>]');
  }

  const rootDir = path.resolve(__dirname, '..');
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-powerpoint-skill-smoke-'));
  const workspacePath = path.join(tempRoot, 'workspace');
  const isPackaged = Boolean(packagedResources);
  const resourcesPath = isPackaged ? path.resolve(packagedResources) : rootDir;
  await fs.mkdir(workspacePath, { recursive: true });

  const supervisor = new HarnessSupervisor({
    rootDir,
    resourcesPath,
    isPackaged,
    homeDir: path.join(tempRoot, 'harness'),
    launchDir: workspacePath,
    logFile: path.join(tempRoot, 'logs', 'harness.log')
  });

  let result;
  try {
    const authentication = await authenticateHarnessSupervisor(supervisor);
    const { origin, probe, fetchImpl, apiCall } = authentication;
    const workspace = await synchronizeHarnessWorkspace({
      origin,
      workspacePath,
      fallbackTitle: 'V1.0 PowerPoint Skill Smoke',
      fetchImpl
    });
    const catalog = await apiCall(origin, 'skill.list', { sessionId: workspace.sessionId });
    const entries = Array.isArray(catalog?.skills) ? catalog.skills : [];
    const powerpointSkill = entries.find((entry) => entry?.name === 'powerpoint-pptx');
    if (!powerpointSkill) throw new Error('Harness skill.list 未发现内置 powerpoint-pptx。');
    if (powerpointSkill.modelInvocable !== true) throw new Error('内置 powerpoint-pptx 没有开放给 Harness Agent 调用。');
    result = {
      ok: true,
      mode: isPackaged ? 'packaged' : 'source',
      harness: { status: probe.status, title: probe.title },
      workspace: {
        workspaceCreated: workspace.workspaceCreated,
        sessionCreated: workspace.sessionCreated
      },
      skill: {
        name: powerpointSkill.name,
        description: powerpointSkill.description,
        whenToUse: powerpointSkill.whenToUse || '',
        modelInvocable: powerpointSkill.modelInvocable
      },
      catalogSize: entries.length
    };
  } catch (error) {
    result = {
      ok: false,
      mode: isPackaged ? 'packaged' : 'source',
      error: error.stack || error.message
    };
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
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
