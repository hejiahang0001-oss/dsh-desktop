const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const test = require('node:test');
const { verifyStoredOfficeCopies } = require('../electron/official-attachment-smoke.cjs');
const word = require('../resources/skills/word-docx/scripts/word-docx.cjs');
const excel = require('../resources/skills/excel-xlsx/scripts/excel-xlsx.cjs');

test('official attachment verification copies exact stored files before strict workspace inspection', async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-official-attachment-'));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const workspacePath = path.join(directory, 'workspace'), harnessHome = path.join(directory, 'harness');
  await fs.mkdir(workspacePath);
  const fixtures = [
    ['表格.xlsx', word.createZip(excel.workbookEntries(excel.normalizeSpec({ sheets: [{ name: 'Data', rows: [['Item', 'Value'], ['Test', 12]] }] })))],
    ['文档.docx', word.createZip(word.documentEntries(word.normalizeSpec({ title: 'Attachment check', sections: [{ kind: 'paragraph', text: 'Fixture only.' }] })))],
    ['资料.pdf', Buffer.from('%PDF-1.7\nfixture')]
  ];
  const files = [];
  for (const [name, bytes] of fixtures) {
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const source = path.join(directory, name);
    const stored = path.join(harnessHome, 'attachments', 'v1', 'files', sha256.slice(0, 2), sha256, name);
    await fs.mkdir(path.dirname(stored), { recursive: true });
    await fs.writeFile(stored, bytes); await fs.writeFile(source, bytes);
    files.push({ name, bytes, path: source });
  }
  const result = await verifyStoredOfficeCopies({ files, harnessHome, workspacePath, word, excel });
  assert.equal(result.length, 2);
  assert.ok(result.every((item) => item.strict && item.outsideRejected && /^[a-f0-9]{64}$/.test(item.sha256)));
  await assert.rejects(verifyStoredOfficeCopies({ files, harnessHome, workspacePath, word, excel }), { code: 'EEXIST' });
});

test('bundled Office instructions preserve the workspace boundary for official attachments', async () => {
  for (const name of ['word-docx', 'excel-xlsx', 'powerpoint-pptx']) {
    const text = await fs.readFile(path.join(__dirname, '..', 'resources', 'skills', name, 'SKILL.md'), 'utf8');
    assert.match(text, /官方对话附件|Official conversation attachments/);
    assert.match(text, /未占用文件名|unused filename/);
    assert.match(text, /inspect --strict/);
    assert.match(text, /DSH_CWD/);
    assert.match(text, /导入工作区/);
  }
});
