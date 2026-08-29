'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  MANIFEST_NAME,
  collectSupportBackupFiles,
  createRedactedDiagnosticReport,
  createSupportBackup,
  safeRelativePath,
  validateSupportBackup
} = require('../electron/support-backup.cjs');

const fixture = async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-support-backup-'));
  const dataRoot = path.join(root, 'user-data');
  const destinationRoot = path.join(root, 'backups');
  await Promise.all([
    fs.mkdir(path.join(dataRoot, 'harness', 'sessions', 'workspace', 'session-one'), { recursive: true }),
    fs.mkdir(path.join(dataRoot, 'harness', 'profiles', 'web'), { recursive: true }),
    fs.mkdir(path.join(dataRoot, 'Local Storage', 'leveldb'), { recursive: true }),
    fs.mkdir(destinationRoot, { recursive: true })
  ]);
  await Promise.all([
    fs.writeFile(path.join(dataRoot, 'desktop-state.json'), '{"workspace":"C:/secret/repo"}\n'),
    fs.writeFile(path.join(dataRoot, 'network-state.json'), '{"proxyUrl":"https://user:pass@proxy.example"}\n'),
    fs.writeFile(path.join(dataRoot, 'harness', '.credentials.yaml'), 'apiKey: sk-real-secret-value-123456\n'),
    fs.writeFile(path.join(dataRoot, 'harness', 'sessions', 'workspace', 'session-one', 'session.jsonl.zstd'), 'session bytes with sk-user-entered-secret-123456'),
    fs.writeFile(path.join(dataRoot, 'harness', 'profiles', 'web', 'package.json'), '{"name":"profile"}\n'),
    fs.writeFile(path.join(dataRoot, 'Local Storage', 'leveldb', 'CURRENT'), 'MANIFEST-000001\n'),
    fs.writeFile(path.join(dataRoot, 'Local Storage', 'leveldb', 'LOG'), 'transient log must not enter backup')
  ]);
  return { root, dataRoot, destinationRoot };
};

test('support backup copies only verified semantic data and excludes credential files, proxy settings, and transient logs', async (context) => {
  const setup = await fixture();
  context.after(() => fs.rm(setup.root, { recursive: true, force: true }));
  const snapshot = await collectSupportBackupFiles(setup.dataRoot);
  assert.equal(snapshot.counts.sessions, 1);
  assert.equal(snapshot.files.some((file) => file.path.includes('.credentials')), false);
  assert.equal(snapshot.files.some((file) => file.path === 'network-state.json'), false);
  assert.equal(snapshot.files.some((file) => file.path.endsWith('/LOG')), false);

  const created = await createSupportBackup({
    dataRoot: setup.dataRoot,
    destinationRoot: setup.destinationRoot,
    appVersion: '0.7.0',
    clock: () => new Date('2026-08-30T05:00:00.000Z')
  });
  assert.equal(created.valid, true);
  assert.equal(created.includesCredentialFiles, false);
  assert.equal(created.contentRedacted, false);
  assert.equal(created.counts.sessions, 1);
  const manifestText = await fs.readFile(path.join(created.backupRoot, MANIFEST_NAME), 'utf8');
  assert.equal(manifestText.includes('sk-real-secret-value-123456'), false);
  assert.equal(manifestText.includes('.credentials.yaml'), false);
  assert.equal(manifestText.includes('proxy.example'), false);
  assert.equal(await fs.readFile(path.join(created.backupRoot, 'harness', 'sessions', 'workspace', 'session-one', 'session.jsonl.zstd'), 'utf8'), 'session bytes with sk-user-entered-secret-123456');
  assert.equal((await validateSupportBackup(created.backupRoot)).fileCount, snapshot.files.length);
});

test('support backup validation rejects tampering and unsafe destinations', async (context) => {
  const setup = await fixture();
  context.after(() => fs.rm(setup.root, { recursive: true, force: true }));
  await assert.rejects(() => createSupportBackup({
    dataRoot: setup.dataRoot,
    destinationRoot: path.join(setup.dataRoot, 'harness', 'sessions'),
    appVersion: '0.7.0'
  }), /不能位于 DSH 数据目录内部/);
  const created = await createSupportBackup({
    dataRoot: setup.dataRoot,
    destinationRoot: setup.destinationRoot,
    appVersion: '0.7.0',
    clock: () => new Date('2026-08-30T05:01:00.000Z')
  });
  const sessionPath = path.join(created.backupRoot, 'harness', 'sessions', 'workspace', 'session-one', 'session.jsonl.zstd');
  await fs.writeFile(sessionPath, 'tampered');
  await assert.rejects(() => validateSupportBackup(created.backupRoot), /缺失或校验失败/);
  const clean = await createSupportBackup({
    dataRoot: setup.dataRoot,
    destinationRoot: setup.destinationRoot,
    appVersion: '0.7.0',
    clock: () => new Date('2026-08-30T05:02:00.000Z')
  });
  await fs.writeFile(path.join(clean.backupRoot, 'unexpected.txt'), 'not in manifest');
  await assert.rejects(() => validateSupportBackup(clean.backupRoot), /清单之外/);
  const unsupported = await createSupportBackup({
    dataRoot: setup.dataRoot,
    destinationRoot: setup.destinationRoot,
    appVersion: '0.7.0',
    clock: () => new Date('2026-08-30T05:03:00.000Z')
  });
  const unsupportedManifestPath = path.join(unsupported.backupRoot, MANIFEST_NAME);
  const unsupportedManifest = JSON.parse(await fs.readFile(unsupportedManifestPath, 'utf8'));
  const replaced = unsupportedManifest.files.find((file) => file.path === 'desktop-state.json');
  await fs.rename(path.join(unsupported.backupRoot, 'desktop-state.json'), path.join(unsupported.backupRoot, 'unapproved-state.json'));
  replaced.path = 'unapproved-state.json';
  await fs.writeFile(unsupportedManifestPath, `${JSON.stringify(unsupportedManifest, null, 2)}\n`, 'utf8');
  await assert.rejects(() => validateSupportBackup(unsupported.backupRoot), /无效文件记录/);
  assert.equal(safeRelativePath('../escape.json'), '');
  assert.equal(safeRelativePath('state.json:stream'), '');
  assert.equal(safeRelativePath('CON/report.json'), '');
});

test('diagnostic report omits raw paths, credentials, proxy values, session text, and logs', () => {
  const report = createRedactedDiagnosticReport({
    appInfo: { version: '0.7.0', platform: 'win32', packaged: true },
    runtime: { electron: '43.4.1', node: '24.19.0', harness: '0.1.1-rc.2', pnpm: '11.19.0' },
    workspace: { displayName: 'C:\\Users\\secret\\project-sk-folder-secret-1234567890', activePath: 'C:\\Users\\secret\\repo', isFallback: false },
    diagnostics: {
      harnessStatus: 'https://user:pass@status.example',
      sessions: { count: 15, available: true, raw: 'session transcript' },
      credential: { status: 'configured', value: 'sk-real-secret-value-123456' },
      agent: { status: 'ready', pendingCount: 0, queuedCount: 0 },
      workspaceSync: { status: 'synced', path: 'C:\\Users\\secret\\repo' }
    },
    network: { mode: 'custom', status: 'proxied', proxyUrl: 'https://user:pass@proxy.example' },
    backup: { fileCount: 28, totalBytes: 1000, counts: { state: 7, sessions: 15, pluginProfiles: 2, localStorage: 4 } }
  });
  const text = JSON.stringify(report);
  for (const secret of ['C:\\Users\\secret\\repo', 'sk-real-secret-value-123456', 'sk-folder-secret-1234567890', 'user:pass', 'session transcript']) {
    assert.equal(text.includes(secret), false);
  }
  assert.equal(report.network.proxyConfigured, true);
  assert.equal(report.credential.valueIncluded, false);
  assert.equal(report.backup.credentialFilesIncluded, false);
  assert.equal(report.backup.contentRedacted, false);
});

test('support actions use native selection, guarded IPC, fixed command entries, and packaged smoke', () => {
  const root = path.resolve(__dirname, '..');
  const main = require('node:fs').readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
  const preload = require('node:fs').readFileSync(path.join(root, 'electron', 'preload.cjs'), 'utf8');
  const commands = require('node:fs').readFileSync(path.join(root, 'assets', 'workbench-command.js'), 'utf8');
  for (const channel of ['support:export-diagnostics', 'support:create-backup', 'support:validate-backup']) {
    assert.match(main, new RegExp(`ipcMain\\.handle\\('${channel}'`));
    assert.match(preload, new RegExp(channel));
  }
  assert.match(main, /defaultId: 0,\s*cancelId: 0/);
  assert.match(main, /--support-smoke-file=/);
  assert.match(main, /软件 Key 文件、代理设置、缓存、日志和运行时依赖不会进入备份/);
  assert.match(main, /会话正文按原样保存/);
  assert.match(main, /let supportBackupOperationPromise = null/);
  assert.match(main, /await refreshAgentDiagnostics\(\{ rebuildMenu: false \}\)/);
  assert.match(main, /未能启动 DSH 数据备份/);
  assert.match(commands, /id: 'support\.diagnostics'/);
  assert.match(commands, /id: 'support\.backup'/);
  assert.match(commands, /id: 'support\.validate-backup'/);
  assert.doesNotMatch(preload, /support:[^']+',\s*[^)]/);
});
