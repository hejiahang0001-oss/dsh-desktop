'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { HarnessSupervisor, resolveHarnessRuntimePaths } = require('../electron/harness-supervisor.cjs');
const { synchronizeHarnessWorkspace } = require('../electron/harness-workspace-sync.cjs');
const { authenticateHarnessSupervisor } = require('./harness-smoke-auth.cjs');

const readArgument = (name) => {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
};

const main = async () => {
  const outputFile = readArgument('output');
  const packagedResources = readArgument('packaged-resources');
  if (!outputFile) throw new Error('用法：node scripts/smoke-wiki-basic.cjs --output=<json> [--packaged-resources=<目录>]');

  const rootDir = path.resolve(__dirname, '..');
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-wiki-smoke-'));
  const workspacePath = path.join(tempRoot, '中文 工作区');
  const vaultPath = path.join(tempRoot, '中文 Wiki 知识库');
  const wikiConfigPath = path.join(tempRoot, 'wiki-settings.json');
  const isPackaged = Boolean(packagedResources);
  const resourcesPath = isPackaged ? path.resolve(packagedResources) : rootDir;
  await Promise.all([
    fs.mkdir(workspacePath, { recursive: true }),
    fs.mkdir(vaultPath, { recursive: true })
  ]);
  const runtime = resolveHarnessRuntimePaths({ rootDir, resourcesPath, isPackaged });
  const wiki = require(runtime.wikiToolPath);
  const settings = new wiki.WikiSettingsStore({ filePath: wikiConfigPath });
  await settings.init();
  await settings.setVault(vaultPath);
  const supervisor = new HarnessSupervisor({
    rootDir,
    resourcesPath,
    isPackaged,
    homeDir: path.join(tempRoot, 'harness'),
    launchDir: workspacePath,
    logFile: path.join(tempRoot, 'logs', 'harness.log'),
    wikiConfigPath
  });

  let result;
  try {
    const authentication = await authenticateHarnessSupervisor(supervisor);
    const { origin, probe, fetchImpl, apiCall } = authentication;
    const workspace = await synchronizeHarnessWorkspace({
      origin,
      workspacePath,
      fallbackTitle: 'V1.0 Wiki Basic Smoke',
      fetchImpl
    });
    const catalog = await apiCall(origin, 'skill.list', { sessionId: workspace.sessionId });
    const entries = Array.isArray(catalog?.skills) ? catalog.skills : [];
    const expectedSkills = ['wiki-setup', 'wiki-query', 'wiki-capture', 'wiki-update', 'wiki-history-ingest'];
    const discovered = expectedSkills.map((name) => entries.find((entry) => entry?.name === name));
    if (discovered.some((entry) => !entry || entry.modelInvocable !== true)) throw new Error('Harness skill.list 没有确认五个 Wiki 用户 Skill。');

    await wiki.initializeWikiVault(vaultPath);
    await fs.writeFile(path.join(vaultPath, 'concepts', 'release-boundary.md'), [
      '---',
      'title: "V0.6.5 发布边界"',
      'summary: "Stable 保持 V0.5.4，Wiki 历史导入作为 Latest 候选。"',
      'sources:',
      '  - "DSH_DESKTOP_ITERATION_PLAN.md"',
      'lifecycle: verified',
      '---',
      '',
      '# V0.6.5 发布边界',
      '',
      '无 Git 时仍可查询与保存知识。',
      ''
    ].join('\n'), 'utf8');
    const query = await wiki.queryWiki(vaultPath, '无 Git Wiki', { limit: 4 });
    if (query.results[0]?.path !== 'concepts/release-boundary.md') throw new Error('固定 Wiki 查询没有返回预期页面。');
    const capture = await wiki.saveCapture(vaultPath, {
      title: 'Wiki 基础验收结论',
      content: 'Harness 已发现固定 Wiki Skills；无 Git 中文空格路径查询和保存通过。',
      sourceSessionId: workspace.sessionId,
      sourceSeq: 1,
      sourceTime: Date.now()
    }, { workspaceName: '中文 工作区' });
    const [page, index, log] = await Promise.all([
      fs.readFile(path.join(vaultPath, capture.path), 'utf8'),
      fs.readFile(path.join(vaultPath, 'index.md'), 'utf8'),
      fs.readFile(path.join(vaultPath, 'log.md'), 'utf8')
    ]);
    const gitMissing = await fs.access(path.join(vaultPath, '.git')).then(() => false, () => true);
    if (!page.includes(`#seq=1`) || !index.includes('Wiki 基础验收结论') || !log.includes('CAPTURE type=synthesis') || !gitMissing) {
      throw new Error('Wiki 查询/保存闭环或无 Git 边界未通过。');
    }
    await fs.writeFile(path.join(workspacePath, 'README.md'), '# Wiki Sync Smoke\n\nProject knowledge source.\n', 'utf8');
    const projectPreview = await wiki.previewProjectSync(vaultPath, workspacePath);
    const projectSpec = {
      previewToken: projectPreview.previewToken,
      pages: [{
        path: projectPreview.project.overviewPath,
        expectedSha256: null,
        title: 'Wiki Sync Smoke',
        summary: 'Packaged project sync smoke.',
        content: '# Wiki Sync Smoke\n\nProject knowledge source.',
        sources: ['README.md'],
        provenance: { extracted: 1, inferred: 0, ambiguous: 0 }
      }]
    };
    const projectSave = await wiki.saveProjectSync(vaultPath, workspacePath, projectSpec, { confirmed: true });
    const projectUnchanged = await wiki.previewProjectSync(vaultPath, workspacePath);
    if (!projectUnchanged.unchanged || projectSave.pagesCreated[0] !== projectPreview.project.overviewPath) {
      throw new Error('Wiki 项目增量同步或幂等检查未通过。');
    }
    result = {
      ok: true,
      mode: isPackaged ? 'packaged' : 'source',
      harness: { status: probe.status, title: probe.title },
      workspace: { workspaceCreated: workspace.workspaceCreated, sessionCreated: workspace.sessionCreated },
      skills: discovered.map((entry) => ({ name: entry.name, modelInvocable: entry.modelInvocable })),
      catalogSize: entries.length,
      query: { results: query.results.length, path: query.results[0].path, sources: query.results[0].sources },
      capture: { path: capture.path, pageIndexed: true, logged: true },
      projectSync: { mode: projectPreview.mode, path: projectSave.pagesCreated[0], unchangedAfterSave: projectUnchanged.unchanged },
      noGit: gitMissing,
      pathCase: 'Chinese and spaces'
    };
  } catch (error) {
    result = { ok: false, mode: isPackaged ? 'packaged' : 'source', error: error?.stack || error?.message || String(error) };
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
  process.stderr.write(`${error?.stack || error?.message || String(error)}\n`);
  process.exitCode = 1;
});
