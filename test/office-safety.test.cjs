const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const word = require('../resources/skills/word-docx/scripts/word-docx.cjs');
const excel = require('../resources/skills/excel-xlsx/scripts/excel-xlsx.cjs');
const ppt = require('../resources/skills/powerpoint-pptx/scripts/powerpoint-pptx.cjs');
const { inspectPackageSafety, deliveryReceipt } = require('../resources/skills/word-docx/scripts/ooxml-safety.cjs');

test('shared relationship policy rejects root escapes, missing targets and encoded macro content types', () => {
  for (const target of ['../../outside.xml', 'missing.xml', 'https://example.invalid/file']) {
    const entries = new Map(word.documentEntries({ title: '边界', sections: [] }).map((entry) => [entry.name, Buffer.from(entry.data)]));
    entries.set('_rels/.rels', Buffer.from(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="${target}"/></Relationships>`));
    assert.equal(inspectPackageSafety(entries).passed, false, target);
  }
  const entries = new Map(word.documentEntries({ title: '宏类型', sections: [] }).map((entry) => [entry.name, Buffer.from(entry.data)]));
  entries.set('[Content_Types].xml', Buffer.from('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.ms-word.document.macro&#69;nabled.main+xml"/></Types>'));
  assert.equal(inspectPackageSafety(entries).passed, false);
});

test('delivery verification rejects a changed file and never rewrites the human edit', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-office-changed-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'edited.docx');
  await fs.writeFile(file, 'human edit');
  await assert.rejects(deliveryReceipt(root, file, Buffer.from('old artifact')), { code: 'delivery-changed' });
  assert.equal(await fs.readFile(file, 'utf8'), 'human edit');
});

test('Office paths reject credential folders, alternate streams and reserved Windows names', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-office-paths-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'spec.json'), JSON.stringify({ title: '边界', sections: [] }));
  for (const outputPath of ['.credentials/output.docx', 'secret/output.docx', 'out:stream.docx', 'NUL.docx']) {
    await assert.rejects(word.createDocument({ workspace: root, specPath: 'spec.json', outputPath }), (error) => ['sensitive-path', 'invalid-path'].includes(error.code));
  }
  assert.deepEqual(await fs.readdir(root), ['spec.json']);
});

test('Word strict inspection rejects encoded external relationships and preserves the original on replacement', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-office-safety-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const entries = word.documentEntries({ title: '原文件', sections: [] });
  entries.push({ name: 'word/_rels/footer2.xml.rels', data: '<r:Relationships xmlns:r="http://schemas.openxmlformats.org/package/2006/relationships"><r:Relationship Id="evil" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="https://example.invalid/pixel" TargetMode="Ext&#101;rnal"/></r:Relationships>' });
  const original = word.createZip(entries);
  await fs.writeFile(path.join(root, 'original.docx'), original);
  await fs.writeFile(path.join(root, 'replace.json'), JSON.stringify({ replacements: [{ find: '原文件', replace: '新文件' }] }));
  await assert.rejects(word.inspectDocument({ workspace: root, inputPath: 'original.docx', strict: true }), { code: 'strict-validation-failed' });
  await assert.rejects(word.replaceDocumentText({ workspace: root, inputPath: 'original.docx', specPath: 'replace.json', outputPath: 'original.docx', overwrite: true }));
  assert.deepEqual(await fs.readFile(path.join(root, 'original.docx')), original);
  assert.deepEqual((await fs.readdir(root)).sort(), ['original.docx', 'replace.json']);
});

test('shared ZIP reader rejects mismatched local names, encrypted entries and case aliases', () => {
  const original = word.createZip([{ name: 'one.xml', data: '<root/>' }]);
  const renamed = Buffer.from(original); renamed[30] = 'x'.charCodeAt(0);
  assert.throws(() => word.readZip(renamed), { code: 'invalid-archive' });
  const encrypted = Buffer.from(original); encrypted.writeUInt16LE(0x0801, 6);
  assert.throws(() => word.readZip(encrypted), { code: 'invalid-archive' });
  const descriptor = Buffer.from(original);
  descriptor.writeUInt16LE(0x0808, 6);
  descriptor.writeUInt16LE(0x0808, descriptor.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])) + 8);
  assert.throws(() => word.readZip(descriptor), { code: 'invalid-archive' });
  assert.throws(() => word.createZip([{ name: 'part.xml', data: 'a' }, { name: 'PART.xml', data: 'b' }]), { code: 'invalid-archive' });
});

test('PPT embedded workbooks cannot hide unsafe formulas behind XML aliases or entities', () => {
  const spec = ppt.normalizeSpec({ slides: [{ title: '图表检查', elements: [{ kind: 'chart', type: 'column', x: 1, y: 1, w: 5, h: 4, categories: ['A', 'B'], series: [{ name: '数据', values: [1, 2] }] }] }] });
  for (const formula of ['<f>WEBSERVICE(&quot;https://example.invalid&quot;)</f>', '<s:f xmlns:s="http://schemas.openxmlformats.org/spreadsheetml/2006/main">WEB&#83;ERVICE(&quot;https://example.invalid&quot;)</s:f>']) {
    const entries = word.readZip(word.createZip(ppt.presentationEntries(spec)));
    const embedded = [...entries.keys()].find((name) => name.endsWith('.xlsx'));
    const workbook = word.readZip(entries.get(embedded));
    const sheet = 'xl/worksheets/sheet1.xml';
    workbook.set(sheet, Buffer.from(workbook.get(sheet).toString('utf8').replace('<v>1</v>', `${formula}<v>1</v>`)));
    assert.equal(excel.inspectEntries(workbook).safety.passed, false);
    entries.set(embedded, word.createZip([...workbook].map(([name, data]) => ({ name, data }))));
    assert.equal(ppt.inspectEntries(entries).safety.passed, false);
  }
});

test('Word rejects VBA, DTDs, field instructions and active content even with namespace aliases', () => {
  for (const extra of [
    { name: 'word/vbaProject.bin', data: 'macro' },
    { name: 'word/extra.xml', data: '<!DOCTYPE root [<!ENTITY payload "x">]><root>&payload;</root>' },
    { name: 'word/extra.xml', data: '<z:root xmlns:z="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><z:fldSimple z:instr="DDEAUTO test"/></z:root>' },
    { name: 'word/extra.xml', data: '<z:root xmlns:z="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><z:altChunk/></z:root>' }
  ]) {
    const entries = new Map(word.documentEntries({ title: '安全检查', sections: [] }).map((entry) => [entry.name, Buffer.from(entry.data)]));
    entries.set(extra.name, Buffer.from(extra.data));
    assert.equal(word.inspectEntries(entries).safety.passed, false, extra.name);
  }
});

test('all generated Office formats return verified file and rollback digests without claiming visual validation', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-office-receipt-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const spec = { title: '交付验证', sections: [], sheets: [{ name: '明细', rows: [['内容'], ['中文']] }], slides: [{ title: '交付验证', elements: [] }] };
  await fs.writeFile(path.join(root, 'spec.json'), JSON.stringify(spec));
  for (const [format, create] of [['docx', word.createDocument], ['xlsx', excel.createWorkbook], ['pptx', ppt.createPresentation]]) {
    const options = { workspace: root, specPath: 'spec.json', outputPath: `交付.${format}` };
    const first = await create(options);
    const bytes = await fs.readFile(path.join(root, options.outputPath));
    assert.equal(first.delivery.sha256, createHash('sha256').update(bytes).digest('hex'));
    assert.equal(first.delivery.path, options.outputPath);
    assert.equal(first.delivery.validation, 'structure-and-safety');
    assert.equal(first.delivery.visualValidation, 'not-performed');
    const second = await create({ ...options, overwrite: true });
    assert.equal(second.delivery.overwritten, true);
    assert.equal(second.delivery.rollback.sha256, first.delivery.sha256);
    assert.deepEqual(await fs.readFile(path.join(root, second.delivery.rollback.path)), bytes);
  }
});
