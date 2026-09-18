const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createOfficePreviewFixtures } = require('../electron/office-preview-fixtures.cjs');
const { readZip } = require('../resources/skills/word-docx/scripts/word-docx.cjs');

test('official Office preview fixtures cover Chinese text, pagination, formulas and native charts', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-office-preview-fixture-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const fixtures = await createOfficePreviewFixtures(root, path.resolve(__dirname, '../resources/skills'));
  assert.deepEqual(fixtures.map(x => x.format), ['docx', 'xlsx', 'pptx']);
  for (const fixture of fixtures) {
    assert.match(fixture.sha256, /^[a-f0-9]{64}$/);
    const entries = readZip(await fs.readFile(path.join(root, fixture.name)));
    assert.ok([...entries.values()].some(b => b.toString('utf8').includes(fixture.marker)));
    if (fixture.format === 'docx') assert.match(entries.get('word/document.xml').toString(), /w:type="page"/);
    if (fixture.format === 'xlsx') assert.match(entries.get('xl/worksheets/sheet1.xml').toString(), /SUM\(B3:B4\)/);
    if (fixture.format === 'pptx') assert.ok(entries.has('ppt/charts/chart1.xml'));
  }
  await assert.rejects(createOfficePreviewFixtures(root, path.resolve(__dirname, '../resources/skills')), /EEXIST/);
});
