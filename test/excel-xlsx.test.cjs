const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createZip, readZip } = require('../resources/skills/word-docx/scripts/word-docx.cjs');
const {
  ExcelXlsxError,
  MAX_COLUMNS,
  MAX_ROWS,
  createWorkbook,
  importCsv,
  inspectEntries,
  inspectWorkbook,
  normalizeFormula,
  normalizeSpec,
  setCells,
  workbookEntries
} = require('../resources/skills/excel-xlsx/scripts/excel-xlsx.cjs');

const sampleSpec = () => ({
  title: 'DSH Desktop Excel 验收',
  sheets: [
    {
      name: 'Summary',
      showGridLines: false,
      freeze: { rows: 2, columns: 1 },
      columns: [22, 16, 16, 16],
      mergedCells: ['A1:D1'],
      autoFilter: 'A2:D4',
      rows: [
        [{ value: 'DSH Desktop Excel 验收', style: 'title' }],
        [{ value: 'Item', style: 'header' }, { value: 'Plan', style: 'header' }, { value: 'Actual', style: 'header' }, { value: 'Variance', style: 'header' }],
        ['Revenue', { value: 100, style: 'currency' }, { value: 95, style: 'currency' }, { formula: 'C3-B3', cached: -5, style: 'currency' }],
        [{ value: 'Total', style: 'total' }, { formula: 'SUM(B3:B3)', cached: 100, style: 'total' }, { formula: 'SUM(C3:C3)', cached: 95, style: 'total' }, { formula: 'C4-B4', cached: -5, style: 'total' }]
      ]
    },
    {
      name: 'Details',
      rows: [[{ value: 'Amount', style: 'header' }], [{ value: 95, style: 'currency' }], [{ formula: 'SUM(A2:A2)', cached: 95, style: 'total' }]]
    }
  ],
  reconciliations: [{ label: 'Actual total', left: "'Summary'!$C$4", right: "'Details'!$A$3", tolerance: 0 }]
});

const withWorkspace = async (context) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-excel-xlsx-test-'));
  context.after(() => fsp.rm(root, { recursive: true, force: true }));
  return root;
};

test('XLSX generator creates editable multi-sheet OOXML with formulas, filters, freeze panes, and reconciliation', () => {
  const spec = normalizeSpec(sampleSpec());
  const entries = readZip(createZip(workbookEntries(spec)));
  const inspected = inspectEntries(entries);
  assert.equal(inspected.sheetCount, 3);
  assert.equal(inspected.formulas, 9);
  assert.equal(inspected.formulaErrors, 0);
  assert.equal(inspected.unsupportedFormulaStructures, 0);
  assert.equal(inspected.filters, 2);
  assert.equal(inspected.frozenPanes, 2);
  assert.equal(inspected.externalLinks, 0);
  assert.equal(inspected.connections, 0);
  assert.equal(inspected.queryTables, 0);
  assert.match(entries.get('xl/workbook.xml').toString('utf8'), /fullCalcOnLoad="1"/);
  assert.match(entries.get('xl/styles.xml').toString('utf8'), /numFmtId="164"/);
  assert.match(entries.get('xl/styles.xml').toString('utf8'), /<fgColor rgb="FFE7F4EA"\/><bgColor rgb="FFE7F4EA"\/>/);
  const summaryXml = entries.get('xl/worksheets/sheet1.xml').toString('utf8');
  assert.ok(
    summaryXml.indexOf('<sheetData>') < summaryXml.indexOf('<autoFilter')
      && summaryXml.indexOf('<autoFilter') < summaryXml.indexOf('<mergeCells')
      && summaryXml.indexOf('<mergeCells') < summaryXml.indexOf('<pageMargins'),
    'worksheet elements must follow SpreadsheetML schema order so Excel does not repair the file'
  );
});

test('create and strict inspect keep an editable workbook inside the selected workspace', async (context) => {
  const root = await withWorkspace(context);
  await fsp.writeFile(path.join(root, 'spec.json'), JSON.stringify(sampleSpec()), 'utf8');
  const created = await createWorkbook({ workspace: root, specPath: 'spec.json', outputPath: 'output/report.xlsx' });
  assert.equal(created.operation, 'create');
  assert.equal(created.sheetCount, 3);
  const inspected = await inspectWorkbook({ workspace: root, inputPath: 'output/report.xlsx', strict: true });
  assert.equal(inspected.formulaErrors, 0);
  assert.equal(inspected.riskyFormulas, 0);
});

test('CSV import preserves formula-like text and identifiers with leading zeroes', async (context) => {
  const root = await withWorkspace(context);
  await fsp.writeFile(path.join(root, 'input.csv'), 'Code,Text,Amount\n001,"=SUM(A1:A2)",12.5\n', 'utf8');
  const result = await importCsv({ workspace: root, inputPath: 'input.csv', outputPath: 'import.xlsx', sheetName: 'Imported', inferNumbers: true });
  assert.equal(result.formulas, 0);
  const entries = readZip(await fsp.readFile(path.join(root, 'import.xlsx')));
  const sheet = entries.get('xl/worksheets/sheet1.xml').toString('utf8');
  assert.match(sheet, /<t>001<\/t>/);
  assert.match(sheet, /<t>=SUM\(A1:A2\)<\/t>/);
  assert.match(sheet, /<c r="C2" s="6"><v>12\.5<\/v><\/c>/);
});

test('set-cells preserves existing styles and changes explicit values and formulas', async (context) => {
  const root = await withWorkspace(context);
  await fsp.writeFile(path.join(root, 'create.json'), JSON.stringify(sampleSpec()), 'utf8');
  await createWorkbook({ workspace: root, specPath: 'create.json', outputPath: 'before.xlsx' });
  await fsp.writeFile(path.join(root, 'updates.json'), JSON.stringify({ updates: [
    { sheet: 'Summary', cell: 'C3', value: 98 },
    { sheet: 'Summary', cell: 'D3', formula: 'C3-B3' }
  ] }), 'utf8');
  const updated = await setCells({ workspace: root, inputPath: 'before.xlsx', specPath: 'updates.json', outputPath: 'after.xlsx' });
  assert.equal(updated.updates, 2);
  const entries = readZip(await fsp.readFile(path.join(root, 'after.xlsx')));
  const sheet = entries.get('xl/worksheets/sheet1.xml').toString('utf8');
  assert.match(sheet, /<c r="C3" s="8"><v>98<\/v><\/c>/);
  assert.match(sheet, /<c r="D3" s="8"><f>C3-B3<\/f><v><\/v><\/c>/);
  assert.match(sheet, /<c r="B4" s="11"><f>SUM\(B3:B3\)<\/f><v><\/v><\/c>/);
  assert.match(entries.get('xl/workbook.xml').toString('utf8'), /fullCalcOnLoad="1" forceFullCalc="1"/);
});

test('set-cells inserts a new cell in column order without rebuilding the row', async (context) => {
  const root = await withWorkspace(context);
  await fsp.writeFile(path.join(root, 'create.json'), JSON.stringify({ sheets: [{ name: 'Sparse', rows: [['A', null, null, 'D']] }] }), 'utf8');
  await createWorkbook({ workspace: root, specPath: 'create.json', outputPath: 'before.xlsx' });
  await fsp.writeFile(path.join(root, 'updates.json'), JSON.stringify({ updates: [{ sheet: 'Sparse', cell: 'B1', value: 'B' }] }), 'utf8');
  await setCells({ workspace: root, inputPath: 'before.xlsx', specPath: 'updates.json', outputPath: 'after.xlsx' });
  const entries = readZip(await fsp.readFile(path.join(root, 'after.xlsx')));
  const sheet = entries.get('xl/worksheets/sheet1.xml').toString('utf8');
  assert.ok(sheet.indexOf('r="A1"') < sheet.indexOf('r="B1"'));
  assert.ok(sheet.indexOf('r="B1"') < sheet.indexOf('r="D1"'));
});

test('set-cells rejects duplicate targets without writing a partial output', async (context) => {
  const root = await withWorkspace(context);
  await fsp.writeFile(path.join(root, 'create.json'), JSON.stringify(sampleSpec()), 'utf8');
  await createWorkbook({ workspace: root, specPath: 'create.json', outputPath: 'before.xlsx' });
  await fsp.writeFile(path.join(root, 'updates.json'), JSON.stringify({ updates: [
    { sheet: 'Summary', cell: 'C3', value: 98 },
    { sheet: 'summary', cell: 'C3', value: 99 }
  ] }), 'utf8');
  await assert.rejects(
    setCells({ workspace: root, inputPath: 'before.xlsx', specPath: 'updates.json', outputPath: 'after.xlsx' }),
    (error) => error instanceof ExcelXlsxError && error.code === 'invalid-spec' && /不能重复/.test(error.message)
  );
  assert.equal(fs.existsSync(path.join(root, 'after.xlsx')), false);
});

test('existing outputs require explicit overwrite and receive a rollback copy', async (context) => {
  const root = await withWorkspace(context);
  await fsp.writeFile(path.join(root, 'spec.json'), JSON.stringify(sampleSpec()), 'utf8');
  await createWorkbook({ workspace: root, specPath: 'spec.json', outputPath: 'report.xlsx' });
  await assert.rejects(
    createWorkbook({ workspace: root, specPath: 'spec.json', outputPath: 'report.xlsx' }),
    (error) => error instanceof ExcelXlsxError && error.code === 'output-exists'
  );
  const overwritten = await createWorkbook({ workspace: root, specPath: 'spec.json', outputPath: 'report.xlsx', overwrite: true });
  assert.match(path.basename(overwritten.backup), /^report\.dsh-backup-\d+\.xlsx$/);
  assert.equal((await inspectWorkbook({ workspace: root, inputPath: path.basename(overwritten.backup), strict: true })).sheetCount, 3);
});

test('formula policy rejects external workbooks, network functions, and DDE-like syntax', () => {
  for (const formula of ['[other.xlsx]Sheet1!A1', 'WEBSERVICE("https://example.com")', 'cmd|\' /C calc\'!A0']) {
    assert.throws(() => normalizeFormula(formula, 'formula'), (error) => error instanceof ExcelXlsxError && error.code === 'unsafe-formula');
  }
  assert.equal(normalizeFormula('SUM(A1:A5)', 'formula'), 'SUM(A1:A5)');
});

test('strict inspection rejects existing formula errors and risky formulas', async (context) => {
  const root = await withWorkspace(context);
  const entries = new Map(readZip(createZip(workbookEntries(normalizeSpec(sampleSpec())))));
  const sheetName = 'xl/worksheets/sheet1.xml';
  let sheet = entries.get(sheetName).toString('utf8');
  sheet = sheet.replace('<f>C3-B3</f><v>-5</v>', '<f>WEBSERVICE(&quot;https://example.com&quot;)</f><v></v>');
  sheet = sheet.replace('</sheetData>', '<row r="9"><c r="A9" t="e"><v>#REF!</v></c></row></sheetData>');
  entries.set(sheetName, Buffer.from(sheet, 'utf8'));
  await fsp.writeFile(path.join(root, 'unsafe.xlsx'), createZip([...entries].map(([name, data]) => ({ name, data }))));
  const inspected = await inspectWorkbook({ workspace: root, inputPath: 'unsafe.xlsx' });
  assert.equal(inspected.formulaErrors, 1);
  assert.equal(inspected.riskyFormulas, 1);
  await assert.rejects(
    inspectWorkbook({ workspace: root, inputPath: 'unsafe.xlsx', strict: true }),
    (error) => error instanceof ExcelXlsxError && error.code === 'strict-validation-failed'
  );
});

test('strict inspection and cell updates reject shared formula structures', async (context) => {
  const root = await withWorkspace(context);
  const entries = new Map(readZip(createZip(workbookEntries(normalizeSpec(sampleSpec())))));
  const sheetName = 'xl/worksheets/sheet1.xml';
  let sheet = entries.get(sheetName).toString('utf8');
  sheet = sheet.replace('<f>C3-B3</f><v>-5</v>', '<f t="shared" ref="D3:D4" si="0">C3-B3</f><v>-5</v>');
  sheet = sheet.replace('<f>C4-B4</f><v>-5</v>', '<f t="shared" si="0"/><v>-5</v>');
  entries.set(sheetName, Buffer.from(sheet, 'utf8'));
  await fsp.writeFile(path.join(root, 'shared.xlsx'), createZip([...entries].map(([name, data]) => ({ name, data }))));
  await fsp.writeFile(path.join(root, 'updates.json'), JSON.stringify({ updates: [{ sheet: 'Summary', cell: 'C3', value: 98 }] }), 'utf8');
  const inspected = await inspectWorkbook({ workspace: root, inputPath: 'shared.xlsx' });
  assert.equal(inspected.formulas, 9);
  assert.equal(inspected.unsupportedFormulaStructures, 2);
  await assert.rejects(
    inspectWorkbook({ workspace: root, inputPath: 'shared.xlsx', strict: true }),
    (error) => error instanceof ExcelXlsxError && error.code === 'strict-validation-failed'
  );
  await assert.rejects(
    setCells({ workspace: root, inputPath: 'shared.xlsx', specPath: 'updates.json', outputPath: 'after.xlsx' }),
    (error) => error instanceof ExcelXlsxError && error.code === 'strict-validation-failed'
  );
  assert.equal(fs.existsSync(path.join(root, 'after.xlsx')), false);
});

test('strict inspection rejects external connection and query-table parts', async (context) => {
  const root = await withWorkspace(context);
  await fsp.writeFile(path.join(root, 'spec.json'), JSON.stringify(sampleSpec()), 'utf8');
  await createWorkbook({ workspace: root, specPath: 'spec.json', outputPath: 'safe.xlsx' });
  const entries = readZip(await fsp.readFile(path.join(root, 'safe.xlsx')));
  entries.set('xl/connections.xml', Buffer.from('<connections/>'));
  entries.set('xl/queryTables/queryTable1.xml', Buffer.from('<queryTable/>'));
  const unsafe = createZip([...entries].map(([name, data]) => ({ name, data })));
  await fsp.writeFile(path.join(root, 'connected.xlsx'), unsafe);
  const inspected = await inspectWorkbook({ workspace: root, inputPath: 'connected.xlsx' });
  assert.equal(inspected.connections, 1);
  assert.equal(inspected.queryTables, 1);
  await assert.rejects(
    inspectWorkbook({ workspace: root, inputPath: 'connected.xlsx', strict: true }),
    (error) => error instanceof ExcelXlsxError && error.code === 'strict-validation-failed'
  );
});

test('Excel tool rejects output traversal and symbolic-link escape', async (context) => {
  const root = await withWorkspace(context);
  await fsp.writeFile(path.join(root, 'spec.json'), JSON.stringify(sampleSpec()), 'utf8');
  await assert.rejects(
    createWorkbook({ workspace: root, specPath: 'spec.json', outputPath: '../outside.xlsx' }),
    (error) => error instanceof ExcelXlsxError && error.code === 'outside-workspace'
  );
  const outside = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-excel-xlsx-outside-'));
  context.after(() => fsp.rm(outside, { recursive: true, force: true }));
  try { await fsp.symlink(outside, path.join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) {
    if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(error.code)) return;
    throw error;
  }
  await assert.rejects(
    createWorkbook({ workspace: root, specPath: 'spec.json', outputPath: 'linked/escape.xlsx' }),
    (error) => error instanceof ExcelXlsxError && error.code === 'reparse-path'
  );
});

test('row, column, and reconciliation references remain bounded', () => {
  assert.throws(() => normalizeSpec({ sheets: [{ name: 'TooWide', rows: [Array(MAX_COLUMNS + 1).fill(1)] }] }), /列数无效/);
  assert.throws(() => normalizeSpec({ sheets: [{ name: 'Summary', rows: [[1]] }], reconciliations: [{ label: 'bad', left: "'Summary'!A1", right: "'Missing'!A1" }] }), /不存在的工作表/);
  assert.throws(() => normalizeSpec({ sheets: [{ name: 'Summary', rows: [[1]] }], reconciliations: [{ label: 'bad', left: "'Summary'!A1", right: `'Summary'!A${MAX_ROWS + 1}` }] }), /超出支持范围/);
});
