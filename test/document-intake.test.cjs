const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { DocumentIntake, validateDocument, documentReference, MAX_FILE_BYTES } = require('../electron/document-intake.cjs');
const { createZip, documentEntries, normalizeSpec: wordSpec } = require('../resources/skills/word-docx/scripts/word-docx.cjs');
const { workbookEntries, normalizeSpec: excelSpec } = require('../resources/skills/excel-xlsx/scripts/excel-xlsx.cjs');

test('valid generated Office documents are admitted and mismatched OOXML is rejected', () => {
  const xlsx = createZip(workbookEntries(excelSpec({ sheets: [{ name: '数据', rows: [['项目', '金额'], ['甲', 12]] }] })));
  const docx = createZip(documentEntries(wordSpec({ title: '测试合同', sections: [{ kind: 'paragraph', text: '仅用于测试。' }] })));
  assert.doesNotThrow(() => validateDocument('测试 数据.xlsx', xlsx));
  assert.doesNotThrow(() => validateDocument('测试 合同.docx', docx));
  assert.throws(() => validateDocument('伪装.docx', xlsx), /Office|Word|结构/);
  assert.throws(() => validateDocument('损坏.xlsx', xlsx.subarray(0, xlsx.length - 10)), /Office|ZIP|结构/);
});

const fixture = async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-document-test-'));
  const workspace = path.join(root, '中文 工作区');
  const external = path.join(root, '外部 文件');
  await fs.mkdir(workspace); await fs.mkdir(external);
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return { root, workspace, external, intake: new DocumentIntake() };
};

test('document signatures reject disguised and unsupported files', () => {
  assert.throws(() => validateDocument('合同.pdf', Buffer.from('not pdf')), /PDF/);
  assert.throws(() => validateDocument('book.xlsx', Buffer.from('PKnot-a-workbook')), /Office/);
  assert.throws(() => validateDocument('macro.xlsm', Buffer.from('anything')), /暂不支持/);
  assert.throws(() => validateDocument('table.csv', Buffer.from([0xff, 0x00])), /文本/);
  assert.doesNotThrow(() => validateDocument('合同.pdf', Buffer.from('%PDF-1.7\nfixture')));
  assert.doesNotThrow(() => validateDocument('数据.csv', Buffer.from('名称,金额\n测试,12')));
});

test('external documents are copied without changing original and expose only relative metadata', async (t) => {
  const f = await fixture(t);
  const original = path.join(f.external, '合同 一.pdf');
  const bytes = Buffer.from('%PDF-1.7\noriginal-content');
  await fs.writeFile(original, bytes);
  const result = await f.intake.importFiles({ workspacePath: f.workspace, paths: [original] });
  assert.equal(result.items.length, 1); assert.equal(result.rejected.length, 0);
  const item = result.items[0];
  assert.equal(item.source, 'imported');
  assert.equal(path.isAbsolute(item.relativePath), false);
  assert.equal(JSON.stringify(item).includes(f.external), false);
  assert.deepEqual(await fs.readFile(path.join(f.workspace, item.relativePath)), bytes);
  assert.deepEqual(await fs.readFile(original), bytes);
  assert.match(documentReference(item), /参考资料/);
});

test('workspace files are referenced without a second copy', async (t) => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.workspace, '数据.csv'), 'a,b\n1,2');
  const result = await f.intake.importFiles({ workspacePath: f.workspace, paths: [path.join(f.workspace, '数据.csv')] });
  assert.equal(result.items[0].relativePath, '数据.csv');
  assert.equal(result.items[0].source, 'workspace');
  assert.deepEqual(await fs.readdir(f.workspace), ['数据.csv']);
});

test('duplicates are coalesced and valid files survive a mixed invalid batch', async (t) => {
  const f = await fixture(t);
  const valid = path.join(f.external, '数据.csv');
  const invalid = path.join(f.external, 'not.pdf');
  await fs.writeFile(valid, 'a,b\n1,2'); await fs.writeFile(invalid, 'fake');
  const result = await f.intake.importFiles({ workspacePath: f.workspace, paths: [valid, valid, invalid] });
  assert.equal(result.items.length, 1); assert.equal(result.rejected.length, 1);
});

test('existing attachment hash reuses the same validated file', async (t) => {
  const f = await fixture(t);
  const source = path.join(f.external, '数据.csv');
  await fs.writeFile(source, 'a,b\n1,2');
  const first = await f.intake.importFiles({ workspacePath: f.workspace, paths: [source] });
  const second = await f.intake.importFiles({ workspacePath: f.workspace, paths: [source], existing: first.items });
  assert.equal(second.items[0].relativePath, first.items[0].relativePath);
  assert.equal(second.items[0].duplicate, true);
});

test('restricted paths, folders, oversized files and unsupported extensions fail closed', async (t) => {
  const f = await fixture(t);
  const secret = path.join(f.external, 'secrets.txt');
  const large = path.join(f.external, 'large.pdf');
  await fs.writeFile(secret, 'never import');
  const handle = await fs.open(large, 'w'); await handle.truncate(MAX_FILE_BYTES + 1); await handle.close();
  const result = await f.intake.importFiles({ workspacePath: f.workspace, paths: [secret, f.external, large] });
  assert.equal(result.items.length, 0); assert.equal(result.rejected.length, 3);
  assert.deepEqual(await fs.readdir(f.workspace), []);
});

test('symlink traversal is rejected before reading', async (t) => {
  const f = await fixture(t);
  const link = path.join(f.workspace, 'linked');
  await fs.writeFile(path.join(f.external, 'x.csv'), 'a,b');
  await fs.symlink(f.external, link, process.platform === 'win32' ? 'junction' : 'dir');
  const result = await f.intake.importFiles({ workspacePath: f.workspace, paths: [path.join(link, 'x.csv')] });
  assert.equal(result.items.length, 0); assert.match(result.rejected[0].message, /链接|联接/);
});

test('workspace switch while importing aborts before write', async (t) => {
  const f = await fixture(t);
  const source = path.join(f.external, '数据.csv'); await fs.writeFile(source, 'a,b');
  const result = await f.intake.importFiles({ workspacePath: f.workspace, paths: [source], assertCurrent: async () => { throw new Error('会话已切换'); } });
  assert.equal(result.items.length, 0); assert.match(result.rejected[0].message, /会话已切换/);
  assert.deepEqual(await fs.readdir(f.workspace), []);
});

test('path input and reference serialization reject control characters', async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.intake.importFiles({ workspacePath: f.workspace, paths: ['relative.pdf'] }), /路径/);
  assert.throws(() => documentReference({ relativePath: '../secret.txt' }), /路径/);
  assert.throws(() => documentReference({ relativePath: 'one\nnext.txt' }), /路径/);
  assert.match(documentReference({ relativePath: 'dsh-attachments/合同 一.pdf' }), /"dsh-attachments\/合同 一.pdf"/);
});
