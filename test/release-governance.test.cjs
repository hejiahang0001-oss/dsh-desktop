const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const zlib = require('node:zlib');

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

test('package layout requires all four Wiki skills and the fixed offline Wiki tool', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-wiki-skill-governance-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const relative of [
    'llm-wiki/SKILL.md',
    'wiki-setup/SKILL.md',
    'wiki-query/SKILL.md',
    'wiki-capture/SKILL.md'
  ]) writeFile(path.join(root, 'resources', 'skills', relative), `---\nname: ${relative.split('/')[0]}\n---\n`);

  const incomplete = await inspectPackageLayout(root);
  assert.equal(incomplete.requiredWikiSkillFilesReady, false);
  assert.equal(incomplete.wikiSkillRuntime.files, 4);

  writeFile(path.join(root, 'resources', 'skills', 'llm-wiki', 'scripts', 'wiki-basic.cjs'), '// fixed offline Wiki tool\n');
  const ready = await inspectPackageLayout(root);
  assert.equal(ready.requiredWikiSkillFilesReady, true);
  assert.equal(ready.wikiSkillRuntime.files, 5);
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
