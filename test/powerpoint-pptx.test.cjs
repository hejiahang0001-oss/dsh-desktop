const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { inspectEntries: inspectWorkbookEntries } = require('../resources/skills/excel-xlsx/scripts/excel-xlsx.cjs');
const { createZip, readZip } = require('../resources/skills/word-docx/scripts/word-docx.cjs');
const {
  MAX_ELEMENTS_PER_SLIDE,
  PowerPointPptxError,
  createPresentation,
  inspectEntries,
  inspectPresentation,
  normalizeSpec,
  presentationEntries,
  replacePresentationText
} = require('../resources/skills/powerpoint-pptx/scripts/powerpoint-pptx.cjs');

const sampleSpec = () => ({
  title: 'DSH Desktop PowerPoint 验收',
  author: 'DSH Desktop',
  theme: { name: 'DSH Acceptance', accent: '176B87', dark: '17324D', light: 'F7FAFC' },
  slides: [
    {
      layout: 'title',
      title: 'DSH Desktop PowerPoint 验收',
      subtitle: 'Editable PPTX · V0.5.22',
      notes: 'PPT_NOTES_VERIFIED：介绍本次演示目的。'
    },
    {
      layout: 'content',
      title: '原生对象与表格',
      notes: '说明文本、形状和表格均可编辑。',
      elements: [
        { kind: 'text', x: 0.8, y: 1.35, w: 5.2, h: 1.1, text: 'PPT_TEXT_VERIFIED\n多行文本保持可编辑', fontSize: 22 },
        { kind: 'shape', shape: 'roundRect', x: 6.4, y: 1.45, w: 2.3, h: 0.9, text: 'Editable Shape', fill: 'E7F4EA' },
        { kind: 'table', x: 0.8, y: 3.0, w: 7.9, h: 2.2, rows: [['Capability', 'Result'], ['Text', 'Editable'], ['Table', 'Editable']] }
      ]
    },
    {
      layout: 'content',
      title: '原生图表与图片',
      notes: '图表包含内嵌 Excel 工作簿，图片保持原始纵横比。',
      elements: [
        {
          kind: 'chart', type: 'column', x: 0.7, y: 1.35, w: 7.1, h: 4.9,
          categories: ['North', 'South'],
          series: [{ name: 'Plan', values: [120, 110] }, { name: 'Actual', values: [118, 116] }]
        },
        { kind: 'image', path: 'preview.png', alt: 'DSH Desktop preview', x: 8.3, y: 1.6, w: 4.2, h: 3.8 }
      ]
    }
  ]
});

const withWorkspace = async (context) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-powerpoint-pptx-test-'));
  context.after(() => fsp.rm(root, { recursive: true, force: true }));
  return root;
};

const prepareWorkspace = async (context) => {
  const root = await withWorkspace(context);
  await fsp.copyFile(path.resolve(__dirname, '..', 'docs', 'assets', 'social-preview.png'), path.join(root, 'preview.png'));
  await fsp.writeFile(path.join(root, 'spec.json'), JSON.stringify(sampleSpec()), 'utf8');
  return root;
};

test('PPTX generator creates editable slides, layouts, notes, image, table, and native chart data', async (context) => {
  const root = await prepareWorkspace(context);
  const created = await createPresentation({ workspace: root, specPath: 'spec.json', outputPath: 'acceptance.pptx' });
  assert.equal(created.valid, true);
  assert.equal(created.slides, 3);
  assert.equal(created.tables, 1);
  assert.equal(created.charts, 1);
  assert.equal(created.images, 1);
  assert.equal(created.notes, 3);
  assert.equal(created.masters, 1);
  assert.equal(created.layouts, 2);
  assert.equal(created.embeddedWorkbooks, 1);
  const entries = readZip(await fsp.readFile(path.join(root, 'acceptance.pptx')));
  assert.match(entries.get('ppt/presentation.xml').toString('utf8'), /<p:sldMasterIdLst>[\s\S]+<p:notesMasterIdLst>[\s\S]+<p:sldIdLst>/);
  assert.match(entries.get('ppt/slides/slide3.xml').toString('utf8'), /<c:chart[^>]+r:id="rId3"/);
  assert.match(entries.get('ppt/slides/_rels/slide3.xml.rels').toString('utf8'), /relationships\/chart[^>]+charts\/chart1\.xml/);
  assert.match(entries.get('ppt/charts/chart1.xml').toString('utf8'), /<c:barChart>[\s\S]+<c:externalData r:id="rId1"/);
  assert.equal(entries.has('ppt/media/image1.png'), true);
  const workbook = readZip(entries.get('ppt/embeddings/Microsoft_Excel_Worksheet1.xlsx'));
  const workbookInspection = inspectWorkbookEntries(workbook);
  assert.equal(workbookInspection.sheetCount, 1);
  assert.equal(workbookInspection.formulas, 0);
});

test('presentationEntries builds a strict package without workspace images', () => {
  const spec = normalizeSpec({ title: 'Minimal', slides: [{ layout: 'title', title: 'Minimal', notes: 'Note' }] });
  const archive = createZip(presentationEntries(spec));
  const inspection = inspectEntries(readZip(archive));
  assert.equal(inspection.slides, 1);
  assert.equal(inspection.layouts, 2);
  assert.equal(inspection.notes, 1);
  assert.equal(inspection.externalRelationships, 0);
});

test('strict inspection accepts the generated presentation', async (context) => {
  const root = await prepareWorkspace(context);
  await createPresentation({ workspace: root, specPath: 'spec.json', outputPath: 'acceptance.pptx' });
  const inspected = await inspectPresentation({ workspace: root, inputPath: 'acceptance.pptx', strict: true });
  assert.equal(inspected.valid, true);
  assert.equal(inspected.macros, 0);
  assert.equal(inspected.oleObjects, 0);
  assert.equal(inspected.activeX, 0);
});

test('replace-text updates slide and speaker-note runs all-or-nothing', async (context) => {
  const root = await prepareWorkspace(context);
  await createPresentation({ workspace: root, specPath: 'spec.json', outputPath: 'before.pptx' });
  await fsp.writeFile(path.join(root, 'replace.json'), JSON.stringify({ replacements: [
    { find: 'PPT_TEXT_VERIFIED', replace: 'PPT_EDIT_VERIFIED' },
    { find: 'PPT_NOTES_VERIFIED', replace: 'PPT_NOTES_EDITED' }
  ] }), 'utf8');
  const updated = await replacePresentationText({ workspace: root, inputPath: 'before.pptx', specPath: 'replace.json', outputPath: 'after.pptx' });
  assert.equal(updated.replacements.PPT_TEXT_VERIFIED, 1);
  assert.equal(updated.replacements.PPT_NOTES_VERIFIED, 1);
  const entries = readZip(await fsp.readFile(path.join(root, 'after.pptx')));
  assert.match(entries.get('ppt/slides/slide2.xml').toString('utf8'), /PPT_EDIT_VERIFIED/);
  assert.match(entries.get('ppt/notesSlides/notesSlide1.xml').toString('utf8'), /PPT_NOTES_EDITED/);
});

test('replace-text writes no partial output when any requested text is absent', async (context) => {
  const root = await prepareWorkspace(context);
  await createPresentation({ workspace: root, specPath: 'spec.json', outputPath: 'before.pptx' });
  await fsp.writeFile(path.join(root, 'replace.json'), JSON.stringify({ replacements: [
    { find: 'PPT_TEXT_VERIFIED', replace: 'changed' },
    { find: 'missing marker', replace: 'never' }
  ] }), 'utf8');
  await assert.rejects(
    replacePresentationText({ workspace: root, inputPath: 'before.pptx', specPath: 'replace.json', outputPath: 'after.pptx' }),
    (error) => error instanceof PowerPointPptxError && error.code === 'text-not-found'
  );
  assert.equal(fs.existsSync(path.join(root, 'after.pptx')), false);
});

test('existing output requires explicit overwrite and creates a rollback copy', async (context) => {
  const root = await prepareWorkspace(context);
  await createPresentation({ workspace: root, specPath: 'spec.json', outputPath: 'presentation.pptx' });
  await assert.rejects(
    createPresentation({ workspace: root, specPath: 'spec.json', outputPath: 'presentation.pptx' }),
    (error) => error instanceof PowerPointPptxError && error.code === 'output-exists'
  );
  const overwritten = await createPresentation({ workspace: root, specPath: 'spec.json', outputPath: 'presentation.pptx', overwrite: true });
  assert.match(path.basename(overwritten.backup), /^presentation\.dsh-backup-\d+\.pptx$/);
  assert.equal((await inspectPresentation({ workspace: root, inputPath: path.basename(overwritten.backup), strict: true })).slides, 3);
});

test('strict inspection rejects external relationships and active content', async (context) => {
  const root = await prepareWorkspace(context);
  await createPresentation({ workspace: root, specPath: 'spec.json', outputPath: 'safe.pptx' });
  const entries = readZip(await fsp.readFile(path.join(root, 'safe.pptx')));
  const relName = 'ppt/slides/_rels/slide1.xml.rels';
  entries.set(relName, Buffer.from(entries.get(relName).toString('utf8').replace('</Relationships>', '<Relationship Id="rId99" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com" TargetMode="External"/></Relationships>')));
  entries.set('ppt/activeX/activeX1.bin', Buffer.from('active'));
  await fsp.writeFile(path.join(root, 'unsafe.pptx'), createZip([...entries].map(([name, data]) => ({ name, data }))));
  const inspected = await inspectPresentation({ workspace: root, inputPath: 'unsafe.pptx' });
  assert.equal(inspected.externalRelationships, 1);
  assert.equal(inspected.activeX, 1);
  await assert.rejects(
    inspectPresentation({ workspace: root, inputPath: 'unsafe.pptx', strict: true }),
    (error) => error instanceof PowerPointPptxError && error.code === 'strict-validation-failed'
  );
});

test('strict inspection catches alternate quoting and absolute external targets', async (context) => {
  const root = await prepareWorkspace(context);
  await createPresentation({ workspace: root, specPath: 'spec.json', outputPath: 'safe.pptx' });
  const entries = readZip(await fsp.readFile(path.join(root, 'safe.pptx')));
  entries.set('ppt/slides/_rels/slide1.xml.rels', Buffer.from("<?xml version='1.0'?><Relationships><Relationship Id='rId9' Type='link' Target='https://example.invalid/data'/></Relationships>"));
  await fsp.writeFile(path.join(root, 'external.pptx'), createZip([...entries].map(([name, data]) => ({ name, data }))));
  await assert.rejects(
    inspectPresentation({ workspace: root, inputPath: 'external.pptx', strict: true }),
    (error) => error instanceof PowerPointPptxError && error.code === 'strict-validation-failed'
  );
});

test('layout bounds, chart data, and element counts remain bounded', () => {
  assert.throws(() => normalizeSpec({ slides: [{ elements: [{ kind: 'text', x: 12, y: 1, w: 2, h: 1, text: 'outside' }] }] }), /画布内/);
  assert.throws(() => normalizeSpec({ slides: [{ elements: [{ kind: 'chart', type: 'pie', x: 1, y: 1, w: 5, h: 4, categories: ['A', 'B'], series: [{ name: 'One', values: [1, 2] }, { name: 'Two', values: [2, 3] }] }] }] }), /系列数量无效/);
  assert.throws(() => normalizeSpec({ slides: [{ elements: [{ kind: 'chart', type: 'column', x: 1, y: 1, w: 5, h: 4, categories: ['A', 'B'], series: [{ name: 'One', values: [1, 1e16] }] }] }] }), /1e15/);
  assert.throws(() => normalizeSpec({ slides: [{ elements: Array(MAX_ELEMENTS_PER_SLIDE + 1).fill({ kind: 'text', x: 1, y: 1, w: 1, h: 1, text: 'x' }) }] }), /最多/);
});

test('PowerPoint tool rejects traversal and linked image escapes', async (context) => {
  const root = await prepareWorkspace(context);
  await assert.rejects(
    createPresentation({ workspace: root, specPath: 'spec.json', outputPath: '../outside.pptx' }),
    (error) => error instanceof PowerPointPptxError && error.code === 'outside-workspace'
  );
  const outside = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-powerpoint-outside-'));
  context.after(() => fsp.rm(outside, { recursive: true, force: true }));
  try { await fsp.symlink(outside, path.join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) {
    if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(error.code)) return;
    throw error;
  }
  const spec = sampleSpec();
  spec.slides[2].elements[1].path = 'linked/escape.png';
  await fsp.writeFile(path.join(root, 'linked.json'), JSON.stringify(spec), 'utf8');
  await assert.rejects(
    createPresentation({ workspace: root, specPath: 'linked.json', outputPath: 'linked.pptx' }),
    (error) => error instanceof PowerPointPptxError && error.code === 'reparse-path'
  );
});
