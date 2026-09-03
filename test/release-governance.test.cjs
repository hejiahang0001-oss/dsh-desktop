const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const zlib = require('node:zlib');
const { createPackage } = require('@electron/asar');
const { inspectHarnessRuntimePayload } = require('../scripts/harness-runtime-integrity.cjs');

const {
  assessAutomaticUpdate,
  compareBlockmaps,
  decodeBlockmap,
  inspectPackageLayout,
  parsePeCertificateTable
} = require('../scripts/release-governance.cjs');

const writeFile = (target, bytes = 'x') => {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes);
};

const HARNESS_VENDOR_PACKAGES = [
  'cordis',
  'cordis-plugin-group',
  'cordis-plugin-hmr',
  'cordis-plugin-include',
  'cordis-plugin-loader',
  'cordis-plugin-logger-console',
  'cordis-plugin-timer',
  'cosmokit',
  'schemastery'
];

const writeHarnessFixture = (root, { driftedPackage = '', build = {}, harness = {} } = {}) => {
  const harnessRoot = path.join(root, 'resources', 'harness');
  const inventory = fs.readFileSync(path.resolve(__dirname, '..', 'docs', 'THIRD_PARTY_LICENSES.md'), 'utf8');
  const releasePackages = [...inventory.matchAll(/^\| (@deepseek-ai\/[^ |]+) \| ([^ |]+) \|$/gm)]
    .map(([, name, version]) => ({ name, version }))
    .filter(({ name }) => name === '@deepseek-ai/dsh'
      || name.startsWith('@deepseek-ai/dsh-')
      || HARNESS_VENDOR_PACKAGES.includes(name.slice('@deepseek-ai/'.length)));
  assert.equal(releasePackages.length, 251);
  for (const { name, version } of releasePackages) {
    const localName = name.slice('@deepseek-ai/'.length);
    writeFile(path.join(harnessRoot, 'node_modules', '@deepseek-ai', localName, 'package.json'), JSON.stringify({
      name,
      version: localName === driftedPackage ? '0.1.2-alpha.5' : version
    }));
  }
  for (const name of ['node-addon-landlock-run', 'node-addon-landlock-run-linux-arm64', 'node-addon-landlock-run-linux-x64']) {
    writeFile(path.join(harnessRoot, 'node_modules', '@deepseek-ai', name, 'package.json'), JSON.stringify({
      name: `@deepseek-ai/${name}`,
      version: '0.1.1'
    }));
  }
  const runtimePayload = inspectHarnessRuntimePayload(path.join(harnessRoot, 'node_modules'));
  writeFile(path.join(harnessRoot, 'harness-runtime.json'), JSON.stringify({
    version: 1,
    harness: {
      name: '@deepseek-ai/dsh',
      version: '0.1.2-rc.1',
      repository: 'https://github.com/deepseek-ai/deepseek-harness.git',
      tag: 'dsh-v0.1.2-rc.1',
      commit: 'a66e4702047846cdaa10c66c9d3df3951f5ea70d',
      ...harness
    },
    build: {
      node: 'v24.19.0',
      pnpm: '11.7.0',
      packageCount: 251,
      packageInventorySha256: '98c1d04821a504c85c480e563b9629b1556189cb95becf0796c2f4eccc8e62dd',
      dependencyResolution: 'upstream-frozen-lockfile',
      packagePayload: 'upstream-pnpm-pack',
      installScripts: ['koffi', 'node-pty', '@deepseek-ai/dsh-subprocess-local'],
      runtimePayload,
      ...build
    }
  }));
};

test('blockmap comparison counts duplicate chunks once and reports bounded differential bytes', () => {
  const previous = { version: '2', files: [{ name: 'file', offset: 0, checksums: ['a', 'a', 'b'], sizes: [10, 20, 30] }] };
  const current = { version: '2', files: [{ name: 'file', offset: 0, checksums: ['a', 'a', 'a', 'c'], sizes: [10, 20, 20, 40] }] };
  assert.deepEqual(compareBlockmaps(previous, current), {
    previousBytes: 60,
    currentBytes: 90,
    previousChunks: 3,
    currentChunks: 4,
    reusableChunks: 2,
    reusableBytes: 30,
    downloadBytes: 60,
    reuseRatio: 0.333333
  });
});

test('gzip blockmap decoder validates format and refuses oversized or inconsistent data', () => {
  const valid = { version: '2', files: [{ name: 'file', offset: 0, checksums: ['a'], sizes: [7] }] };
  assert.deepEqual(decodeBlockmap(zlib.gzipSync(JSON.stringify(valid))), valid);
  assert.throws(() => decodeBlockmap(zlib.gzipSync(JSON.stringify({ ...valid, files: [{ ...valid.files[0], sizes: [] }] }))), /invalid/i);
  assert.throws(() => decodeBlockmap(Buffer.alloc(9 * 1024 * 1024)), /compressed/i);
});

test('PE certificate parser distinguishes unsigned and structurally signed executables', () => {
  const makePe = ({ certificateOffset = 0, certificateSize = 0 } = {}) => {
    const buffer = Buffer.alloc(1024);
    buffer.writeUInt16LE(0x5a4d, 0);
    buffer.writeUInt32LE(0x80, 0x3c);
    buffer.writeUInt32LE(0x00004550, 0x80);
    buffer.writeUInt16LE(0x20b, 0x80 + 24);
    const security = 0x80 + 24 + 112 + (4 * 8);
    buffer.writeUInt32LE(certificateOffset, security);
    buffer.writeUInt32LE(certificateSize, security + 4);
    return buffer;
  };
  assert.deepEqual(parsePeCertificateTable(makePe()), { status: 'unsigned', certificateBytes: 0 });
  assert.deepEqual(parsePeCertificateTable(makePe({ certificateOffset: 800, certificateSize: 64 })), { status: 'embedded', certificateBytes: 64 });
  assert.throws(() => parsePeCertificateTable(makePe({ certificateOffset: 1000, certificateSize: 64 })), /certificate/i);
});

test('automatic update stays blocked until trust, publisher, and feed evidence are explicit', () => {
  assert.deepEqual(assessAutomaticUpdate({
    signatureStatus: 'embedded',
    verifyUpdateCodeSignature: true
  }), {
    trustedSignatureVerified: false,
    expectedPublisherVerified: false,
    updateFeedsSeparated: false,
    automaticUpdateReady: false,
    blockers: [
      'signature-trust-not-verified',
      'expected-publisher-not-verified',
      'update-feeds-not-separated'
    ]
  });
  assert.equal(assessAutomaticUpdate({
    signatureStatus: 'embedded',
    verifyUpdateCodeSignature: true,
    trustedSignatureVerified: true,
    expectedPublisherVerified: true,
    updateFeedsSeparated: true
  }).automaticUpdateReady, true);
});

test('package layout reports redundant app PTY files and keeps the isolated Win-x64 runtime bounded', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-release-governance-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeFile(path.join(root, 'resources', 'app.asar.unpacked', 'node_modules', 'node-pty', 'prebuilds', 'linux-x64', 'pty.node'), Buffer.alloc(9));
  writeFile(path.join(root, 'resources', 'app.asar.unpacked', 'node_modules', 'node-addon-api', 'index.js'), Buffer.alloc(4));
  writeFile(path.join(root, 'resources', 'terminal', 'node_modules', 'node-pty', 'package.json'), Buffer.alloc(3));
  writeFile(path.join(root, 'resources', 'terminal', 'node_modules', 'node-pty', 'prebuilds', 'win32-x64', 'conpty.node'), Buffer.alloc(7));

  const report = await inspectPackageLayout(root);
  assert.deepEqual(report.redundantAppRuntime, { files: 2, bytes: 13 });
  assert.deepEqual(report.terminalRuntime, { files: 2, bytes: 10, foreignPlatformFiles: 0, pdbFiles: 0 });
  assert.equal(report.reparsePoints, 0);
  assert.equal(report.requiredPnpmFilesReady, false);
  assert.equal(report.requiredPnpmVersionReady, false);
  assert.equal(report.pnpmRuntime.wrapperValid, false);
});

test('package layout binds the inspected app.asar to the V1.1.7 desktop manifest', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-app-version-governance-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const appRoot = path.join(root, 'app-source');
  writeFile(path.join(appRoot, 'package.json'), JSON.stringify({ name: 'dsh-desktop', version: '1.1.7' }));
  fs.mkdirSync(path.join(root, 'resources'), { recursive: true });
  await createPackage(appRoot, path.join(root, 'resources', 'app.asar'));
  const ready = await inspectPackageLayout(root);
  assert.deepEqual(ready.packagedApp, { name: 'dsh-desktop', version: '1.1.7' });
  assert.equal(ready.requiredPackagedAppReady, true);

  writeFile(path.join(appRoot, 'package.json'), JSON.stringify({ name: 'dsh-desktop', version: '1.1.5' }));
  await createPackage(appRoot, path.join(root, 'resources', 'app.asar'));
  assert.equal((await inspectPackageLayout(root)).requiredPackagedAppReady, false);
});

test('package layout requires the exact bundled Harness watchdog host', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-harness-host-governance-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.resolve(__dirname, '..', 'electron', 'harness-process-host.cjs');
  const target = path.join(root, 'resources', 'harness-host', 'harness-process-host.cjs');

  assert.equal((await inspectPackageLayout(root)).requiredHarnessProcessHostReady, false);
  writeFile(target, fs.readFileSync(source));
  const ready = await inspectPackageLayout(root);
  assert.equal(ready.requiredHarnessProcessHostReady, true);
  assert.equal(ready.harnessProcessHost.sha256, ready.harnessProcessHost.expectedSha256);

  fs.appendFileSync(target, '\n// drifted packaged host\n');
  assert.equal((await inspectPackageLayout(root)).requiredHarnessProcessHostReady, false);
});

test('package layout requires the exact PTY host and bundled Node runtime', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-terminal-host-governance-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const terminalSource = path.resolve(__dirname, '..', 'electron', 'terminal-pty-host.cjs');
  const terminalTarget = path.join(root, 'resources', 'terminal', 'terminal-pty-host.cjs');
  const nodeSource = path.resolve(__dirname, '..', 'vendor', 'runtime', 'win32-x64', 'node.exe');
  const nodeTarget = path.join(root, 'resources', 'runtime', 'node.exe');

  let report = await inspectPackageLayout(root);
  assert.equal(report.requiredTerminalProcessHostReady, false);
  assert.equal(report.requiredNodeRuntimeReady, false);

  writeFile(terminalTarget, fs.readFileSync(terminalSource));
  fs.mkdirSync(path.dirname(nodeTarget), { recursive: true });
  fs.linkSync(nodeSource, nodeTarget);
  report = await inspectPackageLayout(root);
  assert.equal(report.requiredTerminalProcessHostReady, true);
  assert.equal(report.requiredNodeRuntimeReady, true);
  assert.equal(report.terminalProcessHost.sha256, report.terminalProcessHost.expectedSha256);
  assert.equal(report.nodeRuntime.sha256, report.nodeRuntime.expectedSha256);

  fs.appendFileSync(terminalTarget, '\n// drifted PTY host\n');
  assert.equal((await inspectPackageLayout(root)).requiredTerminalProcessHostReady, false);
  fs.unlinkSync(nodeTarget);
  assert.equal((await inspectPackageLayout(root)).requiredNodeRuntimeReady, false);
});

test('package layout requires the fixed bundled pnpm files, version, and offline wrapper', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-pnpm-governance-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const relative of [
    'resources/pnpm/empty.npmrc',
    'resources/pnpm/package/bin/pnpm.mjs',
    'resources/pnpm/package/dist/pnpm.mjs',
    'resources/pnpm/package/LICENSE'
  ]) writeFile(path.join(root, relative));
  writeFile(path.join(root, 'resources/pnpm/package/package.json'), JSON.stringify({ name: 'pnpm', version: '11.19.0' }));
  writeFile(path.join(root, 'resources/pnpm/pnpm.cmd'), '@ECHO OFF\r\n"%~dp0..\\runtime\\node.exe" "%~dp0package\\bin\\pnpm.mjs" %*\r\n');

  const ready = await inspectPackageLayout(root);
  assert.equal(ready.requiredPnpmFilesReady, true);
  assert.equal(ready.requiredPnpmVersionReady, true);
  assert.equal(ready.pnpmRuntime.version, '11.19.0');
  assert.equal(ready.pnpmRuntime.wrapperValid, true);

  writeFile(path.join(root, 'resources/pnpm/package/package.json'), JSON.stringify({ name: 'pnpm', version: '11.20.0' }));
  const drifted = await inspectPackageLayout(root);
  assert.equal(drifted.requiredPnpmVersionReady, false);
});

test('package layout requires the trusted Word skill and fixed offline DOCX tool', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-word-skill-governance-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const skillRoot = path.join(root, 'resources', 'skills', 'word-docx');
  writeFile(path.join(skillRoot, 'SKILL.md'), '---\nname: word-docx\n---\n');

  const incomplete = await inspectPackageLayout(root);
  assert.equal(incomplete.requiredWordSkillFilesReady, false);
  assert.deepEqual(incomplete.wordSkillRuntime, {
    files: 1,
    bytes: Buffer.byteLength('---\nname: word-docx\n---\n')
  });

  writeFile(path.join(skillRoot, 'scripts', 'word-docx.cjs'), '// fixed offline tool\n');
  const ready = await inspectPackageLayout(root);
  assert.equal(ready.requiredWordSkillFilesReady, true);
  assert.equal(ready.wordSkillRuntime.files, 2);
});

test('package layout requires the trusted Excel skill and fixed offline XLSX tool', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-excel-skill-governance-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const skillRoot = path.join(root, 'resources', 'skills', 'excel-xlsx');
  writeFile(path.join(skillRoot, 'SKILL.md'), '---\nname: excel-xlsx\n---\n');

  const incomplete = await inspectPackageLayout(root);
  assert.equal(incomplete.requiredExcelSkillFilesReady, false);
  assert.deepEqual(incomplete.excelSkillRuntime, {
    files: 1,
    bytes: Buffer.byteLength('---\nname: excel-xlsx\n---\n')
  });

  writeFile(path.join(skillRoot, 'scripts', 'excel-xlsx.cjs'), '// fixed offline tool\n');
  const ready = await inspectPackageLayout(root);
  assert.equal(ready.requiredExcelSkillFilesReady, true);
  assert.equal(ready.excelSkillRuntime.files, 2);
});

test('package layout requires the trusted PowerPoint skill and fixed offline PPTX tool', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-powerpoint-skill-governance-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const skillRoot = path.join(root, 'resources', 'skills', 'powerpoint-pptx');
  writeFile(path.join(skillRoot, 'SKILL.md'), '---\nname: powerpoint-pptx\n---\n');

  const incomplete = await inspectPackageLayout(root);
  assert.equal(incomplete.requiredPowerpointSkillFilesReady, false);
  assert.deepEqual(incomplete.powerpointSkillRuntime, {
    files: 1,
    bytes: Buffer.byteLength('---\nname: powerpoint-pptx\n---\n')
  });

  writeFile(path.join(skillRoot, 'scripts', 'powerpoint-pptx.cjs'), '// fixed offline tool\n');
  const ready = await inspectPackageLayout(root);
  assert.equal(ready.requiredPowerpointSkillFilesReady, true);
  assert.equal(ready.powerpointSkillRuntime.files, 2);
});

test('package layout requires all six Wiki skills and the fixed offline Wiki tool', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-wiki-skill-governance-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const relative of [
    'llm-wiki/SKILL.md',
    'wiki-setup/SKILL.md',
    'wiki-query/SKILL.md',
    'wiki-capture/SKILL.md',
    'wiki-update/SKILL.md',
    'wiki-history-ingest/SKILL.md'
  ]) writeFile(path.join(root, 'resources', 'skills', relative), `---\nname: ${relative.split('/')[0]}\n---\n`);

  const incomplete = await inspectPackageLayout(root);
  assert.equal(incomplete.requiredWikiSkillFilesReady, false);
  assert.equal(incomplete.wikiSkillRuntime.files, 6);

  writeFile(path.join(root, 'resources', 'skills', 'llm-wiki', 'scripts', 'wiki-basic.cjs'), '// fixed offline Wiki tool\n');
  const ready = await inspectPackageLayout(root);
  assert.equal(ready.requiredWikiSkillFilesReady, true);
  assert.equal(ready.wikiSkillRuntime.files, 7);
});

test('package layout requires exact Harness source-build provenance', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-harness-governance-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const harnessRoot = path.join(root, 'resources', 'harness');
  writeHarnessFixture(root);
  const ready = await inspectPackageLayout(root);
  assert.equal(ready.requiredHarnessRuntimeReady, true);
  assert.equal(ready.harnessRuntime.dshPackageCount, 242);
  assert.equal(ready.harnessRuntime.vendorPackageCount, 9);
  assert.equal(ready.harnessRuntime.auxiliaryPackageCount, 3);
  assert.equal(ready.harnessRuntime.packageInventorySha256, '98c1d04821a504c85c480e563b9629b1556189cb95becf0796c2f4eccc8e62dd');
  assert.deepEqual(ready.harnessRuntime.mismatchedPackages, []);

  fs.rmSync(path.join(harnessRoot, 'node_modules', '@deepseek-ai', 'dsh-acp'), { recursive: true, force: true });
  writeFile(path.join(harnessRoot, 'node_modules', '@deepseek-ai', 'dsh-fake', 'package.json'), JSON.stringify({
    name: '@deepseek-ai/dsh-fake', version: '0.1.2-rc.1'
  }));
  const substituted = await inspectPackageLayout(root);
  assert.equal(substituted.harnessRuntime.dshPackageCount, 242);
  assert.equal(substituted.requiredHarnessRuntimeReady, false);
  assert.notEqual(substituted.harnessRuntime.packageInventorySha256, ready.harnessRuntime.packageInventorySha256);
  fs.rmSync(path.join(harnessRoot, 'node_modules', '@deepseek-ai', 'dsh-fake'), { recursive: true, force: true });

  writeHarnessFixture(root);
  writeFile(path.join(harnessRoot, 'node_modules', '@deepseek-ai', 'unexpected-runtime', 'package.json'), JSON.stringify({
    name: '@deepseek-ai/unexpected-runtime', version: '9.9.9'
  }));
  const unexpected = await inspectPackageLayout(root);
  assert.equal(unexpected.requiredHarnessRuntimeReady, false);
  assert.deepEqual(unexpected.harnessRuntime.unexpectedDeepSeekPackages, ['@deepseek-ai/unexpected-runtime@9.9.9']);
  fs.rmSync(path.join(harnessRoot, 'node_modules', '@deepseek-ai', 'unexpected-runtime'), { recursive: true, force: true });

  writeHarnessFixture(root);
  writeFile(path.join(harnessRoot, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'), 'process.exit(99);');
  assert.equal((await inspectPackageLayout(root)).requiredHarnessRuntimeReady, false);

  writeHarnessFixture(root, { build: { node: 'v99.0.0' } });
  assert.equal((await inspectPackageLayout(root)).requiredHarnessRuntimeReady, false);

  writeHarnessFixture(root, { driftedPackage: 'dsh-acp' });
  const mixed = await inspectPackageLayout(root);
  assert.equal(mixed.requiredHarnessRuntimeReady, false);
  assert.deepEqual(mixed.harnessRuntime.mismatchedPackages, ['@deepseek-ai/dsh-acp@0.1.2-alpha.5']);

  writeHarnessFixture(root, { harness: { repository: 'https://github.com/example/mixed-runtime.git' } });
  assert.equal((await inspectPackageLayout(root)).requiredHarnessRuntimeReady, false);

  writeHarnessFixture(root, { harness: { tag: 'dsh-v0.1.2-alpha.5' } });
  assert.equal((await inspectPackageLayout(root)).requiredHarnessRuntimeReady, false);
});

test('package manifest and layout include user-readable legal notices', async (context) => {
  const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8'));
  assert.ok(manifest.build.extraResources.some((entry) => entry.from === 'LICENSE' && entry.to === 'legal/LICENSE.txt'));
  assert.ok(manifest.build.extraResources.some((entry) => entry.from === 'docs/THIRD_PARTY_LICENSES.md' && entry.to === 'legal/THIRD_PARTY_LICENSES.md'));

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-legal-governance-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.equal((await inspectPackageLayout(root)).requiredLegalNoticesReady, false);
  fs.mkdirSync(path.join(root, 'resources', 'legal'), { recursive: true });
  fs.copyFileSync(path.resolve(__dirname, '..', 'LICENSE'), path.join(root, 'resources', 'legal', 'LICENSE.txt'));
  fs.copyFileSync(path.resolve(__dirname, '..', 'docs', 'THIRD_PARTY_LICENSES.md'), path.join(root, 'resources', 'legal', 'THIRD_PARTY_LICENSES.md'));
  assert.equal((await inspectPackageLayout(root)).requiredLegalNoticesReady, true);
  writeFile(path.join(root, 'resources', 'legal', 'LICENSE.txt'), 'fake license');
  assert.equal((await inspectPackageLayout(root)).requiredLegalNoticesReady, false);
});

test('package manifest excludes the duplicate app PTY and unused xterm development surfaces', () => {
  const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8'));
  for (const pattern of [
    '!node_modules/node-pty/**/*',
    '!node_modules/node-addon-api/**/*',
    '!node_modules/@xterm/xterm/src/**/*',
    '!node_modules/@xterm/xterm/lib/*.map',
    '!node_modules/@xterm/xterm/lib/*.mjs',
    '!node_modules/@xterm/addon-fit/src/**/*',
    '!node_modules/@xterm/addon-fit/lib/*.map',
    '!node_modules/@xterm/addon-fit/lib/*.mjs'
  ]) assert.ok(manifest.build.files.includes(pattern), pattern);
});
test('packaged desktop plugins include their host-only session module', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-host-plugin-governance-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const name of ['dsh-desktop-shell-env', 'dsh-desktop-credentials', 'dsh-desktop-tools']) {
    for (const file of ['index.mjs', 'package.json']) writeFile(path.join(root, 'resources', 'harness-plugins', name, file), '{}');
  }
  const incomplete = await inspectPackageLayout(root);
  assert.equal(incomplete.requiredDesktopPluginsReady, false);
  assert.deepEqual(incomplete.desktopPluginsMissing, ['dsh-desktop-tools/session-control.mjs']);
  writeFile(path.join(root, 'resources', 'harness-plugins', 'dsh-desktop-tools', 'session-control.mjs'), '// host-only module');
  assert.equal((await inspectPackageLayout(root)).requiredDesktopPluginsReady, true);
});
