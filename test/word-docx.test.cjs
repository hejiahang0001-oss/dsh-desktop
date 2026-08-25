const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  MAX_TOTAL_UNCOMPRESSED_BYTES,
  WordDocxError,
  createDocument,
  createZip,
  documentEntries,
  inspectDocument,
  inspectEntries,
  readZip,
  replaceDocumentText
} = require('../resources/skills/word-docx/scripts/word-docx.cjs');

const sampleSpec = () => ({
  title: 'DSH Desktop Word 验收',
  subtitle: 'V0.5.20',
  author: 'DSH Desktop',
  header: 'DSH Desktop · Word',
  footer: '离线生成 · 可编辑 DOCX',
  sections: [
    { kind: 'heading', level: 1, text: '能力范围' },
    { kind: 'paragraph', text: '本文件用于验证中文段落、结构与 OOXML 可编辑性。' },
    { kind: 'bullets', items: ['生成可编辑文档', '保持工作区边界'] },
    { kind: 'numbered', items: ['结构检查', 'Word 视觉检查'] },
    { kind: 'table', table: { rows: [['项目', '结果'], ['DOCX', '通过']], widths: [3000, 6000] } }
  ]
});

const withWorkspace = async (context) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-word-docx-test-'));
  context.after(() => fsp.rm(root, { recursive: true, force: true }));
  return root;
};

test('DOCX generator creates a bounded editable OOXML package', () => {
  const entries = documentEntries(sampleSpec());
  const archive = createZip(entries);
  const inspected = inspectEntries(readZip(archive));
  assert.equal(inspected.valid, true);
  assert.equal(inspected.tables, 1);
  assert.ok(inspected.paragraphs >= 9);
  assert.match(inspected.title, /DSH Desktop Word 验收/);
  const packageEntries = readZip(archive);
  assert.match(packageEntries.get('word/_rels/document.xml.rels').toString('utf8'), /relationships\/settings/);
  assert.match(packageEntries.get('word/settings.xml').toString('utf8'), /compatibilityMode[^>]+w:val="15"/);
  assert.match(packageEntries.get('docProps/app.xml').toString('utf8'), /<AppVersion>16\.0000<\/AppVersion>/);
});

test('create and inspect keep all files inside the selected workspace', async (context) => {
  const root = await withWorkspace(context);
  await fsp.writeFile(path.join(root, 'spec.json'), JSON.stringify(sampleSpec()), 'utf8');
  const created = await createDocument({ workspace: root, specPath: 'spec.json', outputPath: 'output/acceptance.docx' });
  assert.equal(created.operation, 'create');
  assert.equal(created.valid, true);
  assert.equal(created.tables, 1);
  const inspected = await inspectDocument({ workspace: root, inputPath: 'output/acceptance.docx' });
  assert.equal(inspected.valid, true);
  assert.equal(inspected.output, undefined);
});

test('create embeds bounded workspace PNG images as editable Word drawing relationships', async (context) => {
  const root = await withWorkspace(context);
  const imagePath = path.join(root, 'preview.png');
  await fsp.copyFile(path.resolve(__dirname, '..', 'docs', 'assets', 'social-preview.png'), imagePath);
  const spec = sampleSpec();
  spec.sections.splice(2, 0, { kind: 'image', path: 'preview.png', alt: 'DSH Desktop 预览', widthInches: 5.5 });
  await fsp.writeFile(path.join(root, 'spec.json'), JSON.stringify(spec), 'utf8');
  const created = await createDocument({ workspace: root, specPath: 'spec.json', outputPath: 'image.docx' });
  assert.equal(created.images, 1);
  const entries = readZip(await fsp.readFile(path.join(root, 'image.docx')));
  assert.equal(entries.has('word/media/image1.png'), true);
  assert.match(entries.get('word/document.xml').toString('utf8'), /<wp:inline[\s\S]+descr="DSH Desktop 预览"[\s\S]+r:embed="rId10"/);
  assert.match(entries.get('word/_rels/document.xml.rels').toString('utf8'), /Id="rId10"[^>]+relationships\/image[^>]+media\/image1\.png/);
  assert.match(entries.get('[Content_Types].xml').toString('utf8'), /Extension="png" ContentType="image\/png"/);
});

test('create rejects disguised or out-of-workspace image inputs', async (context) => {
  const root = await withWorkspace(context);
  await fsp.writeFile(path.join(root, 'fake.png'), 'not an image', 'utf8');
  await fsp.writeFile(path.join(root, 'spec.json'), JSON.stringify({
    title: '图片边界',
    sections: [{ kind: 'image', path: 'fake.png' }]
  }), 'utf8');
  await assert.rejects(
    createDocument({ workspace: root, specPath: 'spec.json', outputPath: 'invalid.docx' }),
    (error) => error instanceof WordDocxError && error.code === 'invalid-image'
  );
  await fsp.writeFile(path.join(root, 'spec.json'), JSON.stringify({
    title: '图片边界',
    sections: [{ kind: 'image', path: '../outside.png' }]
  }), 'utf8');
  await assert.rejects(
    createDocument({ workspace: root, specPath: 'spec.json', outputPath: 'outside.docx' }),
    (error) => error instanceof WordDocxError && error.code === 'outside-workspace'
  );
});

test('existing outputs require explicit overwrite and receive a rollback copy', async (context) => {
  const root = await withWorkspace(context);
  await fsp.writeFile(path.join(root, 'spec.json'), JSON.stringify(sampleSpec()), 'utf8');
  await createDocument({ workspace: root, specPath: 'spec.json', outputPath: 'acceptance.docx' });
  await assert.rejects(
    createDocument({ workspace: root, specPath: 'spec.json', outputPath: 'acceptance.docx' }),
    (error) => error instanceof WordDocxError && error.code === 'output-exists'
  );
  const overwritten = await createDocument({ workspace: root, specPath: 'spec.json', outputPath: 'acceptance.docx', overwrite: true });
  assert.match(path.basename(overwritten.backup), /^acceptance\.dsh-backup-\d+\.docx$/);
  assert.equal(fs.existsSync(overwritten.backup), true);
  assert.equal((await inspectDocument({ workspace: root, inputPath: path.basename(overwritten.backup) })).valid, true);
});

test('replace-text writes a new valid DOCX and reports every exact match', async (context) => {
  const root = await withWorkspace(context);
  await fsp.writeFile(path.join(root, 'create.json'), JSON.stringify(sampleSpec()), 'utf8');
  await createDocument({ workspace: root, specPath: 'create.json', outputPath: 'before.docx' });
  await fsp.writeFile(path.join(root, 'replace.json'), JSON.stringify({ replacements: [{ find: 'V0.5.20', replace: 'V0.5.20 已验证' }] }), 'utf8');
  const result = await replaceDocumentText({ workspace: root, inputPath: 'before.docx', specPath: 'replace.json', outputPath: 'after.docx' });
  assert.equal(result.replacements['V0.5.20'], 1);
  assert.match((await inspectDocument({ workspace: root, inputPath: 'after.docx' })).title, /已验证/);
});

test('replace-text is all-or-nothing when any requested text is absent', async (context) => {
  const root = await withWorkspace(context);
  await fsp.writeFile(path.join(root, 'create.json'), JSON.stringify(sampleSpec()), 'utf8');
  await createDocument({ workspace: root, specPath: 'create.json', outputPath: 'before.docx' });
  await fsp.writeFile(path.join(root, 'replace.json'), JSON.stringify({ replacements: [{ find: '不存在的字段', replace: '新值' }] }), 'utf8');
  await assert.rejects(
    replaceDocumentText({ workspace: root, inputPath: 'before.docx', specPath: 'replace.json', outputPath: 'after.docx' }),
    (error) => error instanceof WordDocxError && error.code === 'text-not-found'
  );
  assert.equal(fs.existsSync(path.join(root, 'after.docx')), false);
});

test('replace-text rejects duplicate find rules instead of applying ambiguous replacements', async (context) => {
  const root = await withWorkspace(context);
  await fsp.writeFile(path.join(root, 'create.json'), JSON.stringify(sampleSpec()), 'utf8');
  await createDocument({ workspace: root, specPath: 'create.json', outputPath: 'before.docx' });
  await fsp.writeFile(path.join(root, 'replace.json'), JSON.stringify({ replacements: [
    { find: 'V0.5.20', replace: 'FIRST' },
    { find: 'V0.5.20', replace: 'SECOND' }
  ] }), 'utf8');
  await assert.rejects(
    replaceDocumentText({ workspace: root, inputPath: 'before.docx', specPath: 'replace.json', outputPath: 'after.docx' }),
    (error) => error instanceof WordDocxError && error.code === 'invalid-spec' && /不能重复/.test(error.message)
  );
  assert.equal(fs.existsSync(path.join(root, 'after.docx')), false);
});

test('Word tool rejects output traversal and symbolic-link escape', async (context) => {
  const root = await withWorkspace(context);
  await fsp.writeFile(path.join(root, 'spec.json'), JSON.stringify(sampleSpec()), 'utf8');
  await assert.rejects(
    createDocument({ workspace: root, specPath: 'spec.json', outputPath: '../outside.docx' }),
    (error) => error instanceof WordDocxError && error.code === 'outside-workspace'
  );
  const outside = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-word-docx-outside-'));
  context.after(() => fsp.rm(outside, { recursive: true, force: true }));
  try {
    await fsp.symlink(outside, path.join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(error.code)) return;
    throw error;
  }
  await assert.rejects(
    createDocument({ workspace: root, specPath: 'spec.json', outputPath: 'linked/escape.docx' }),
    (error) => error instanceof WordDocxError && error.code === 'reparse-path'
  );
});

test('ZIP reader rejects corrupted OOXML packages', () => {
  const archive = createZip(documentEntries(sampleSpec()));
  archive[Math.floor(archive.length / 2)] ^= 0xff;
  assert.throws(() => inspectEntries(readZip(archive)), (error) => error instanceof WordDocxError);
});

test('ZIP reader rejects archives whose declared total uncompressed size exceeds the global bound', () => {
  const archive = createZip([
    { name: 'one.bin', data: '1' },
    { name: 'two.bin', data: '2' },
    { name: 'three.bin', data: '3' },
    { name: 'four.bin', data: '4' },
    { name: 'five.bin', data: '5' }
  ]);
  const end = archive.length - 22;
  let cursor = archive.readUInt32LE(end + 16);
  const declared = Math.floor(MAX_TOTAL_UNCOMPRESSED_BYTES / 5) + 1;
  for (let index = 0; index < 5; index += 1) {
    archive.writeUInt32LE(declared, cursor + 24);
    cursor += 46 + archive.readUInt16LE(cursor + 28) + archive.readUInt16LE(cursor + 30) + archive.readUInt16LE(cursor + 32);
  }
  assert.throws(() => readZip(archive), (error) => error instanceof WordDocxError && error.code === 'invalid-archive' && /总大小/.test(error.message));
});
