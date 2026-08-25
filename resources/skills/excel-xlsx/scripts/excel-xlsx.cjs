#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { createZip, readZip, xmlEscape } = require('../../word-docx/scripts/word-docx.cjs');

const MAX_SPEC_BYTES = 4 * 1024 * 1024;
const MAX_CSV_BYTES = 8 * 1024 * 1024;
const MAX_XLSX_BYTES = 64 * 1024 * 1024;
const MAX_SHEETS = 32;
const MAX_ROWS = 10_000;
const MAX_COLUMNS = 256;
const MAX_TOTAL_CELLS = 100_000;
const MAX_TEXT_CHARS = 32_767;
const MAX_FORMULA_CHARS = 8_192;
const REQUIRED_ENTRIES = Object.freeze([
  '[Content_Types].xml',
  '_rels/.rels',
  'xl/workbook.xml',
  'xl/_rels/workbook.xml.rels',
  'xl/styles.xml'
]);
const STYLE_IDS = Object.freeze({
  normal: 0,
  title: 1,
  subtitle: 2,
  header: 3,
  text: 4,
  integer: 5,
  decimal: 6,
  percent: 7,
  currency: 8,
  date: 9,
  formula: 10,
  total: 11,
  'check-ok': 12,
  'check-mismatch': 13
});
const RISKY_FORMULA = /\b(?:WEBSERVICE|HYPERLINK|RTD|CALL|REGISTER\.ID|EXEC|DDE|ENCODEURL|FILTERXML|IMAGE|STOCKHISTORY|INDIRECT|CUBEMEMBER|CUBEVALUE|CUBESET|CUBESETCOUNT|CUBERANKEDMEMBER|CUBEKPIMEMBER)\s*\(/i;

class ExcelXlsxError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ExcelXlsxError';
    this.code = code;
  }
}

const xmlUnescape = (value) => String(value ?? '')
  .replaceAll('&lt;', '<')
  .replaceAll('&gt;', '>')
  .replaceAll('&quot;', '"')
  .replaceAll('&apos;', "'")
  .replaceAll('&amp;', '&');

const assertPlainObject = (value, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ExcelXlsxError('invalid-spec', `${label} 必须是对象。`);
  return value;
};

const safeArray = (value, label, max) => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > max) throw new ExcelXlsxError('invalid-spec', `${label} 必须是最多 ${max} 项的数组。`);
  return value;
};

const boundedText = (value, label, max = MAX_TEXT_CHARS, { optional = false } = {}) => {
  if (optional && (value === undefined || value === null || value === '')) return '';
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) {
    throw new ExcelXlsxError('invalid-spec', `${label} 必须是最多 ${max} 字符的安全文本。`);
  }
  return value;
};

const isWithin = (root, target) => {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

const resolveWorkspace = (value) => path.resolve(value || process.env.DSH_CWD || process.cwd());

const resolveWorkspacePath = (workspace, candidate, label, extension) => {
  if (typeof candidate !== 'string' || candidate.trim() === '') throw new ExcelXlsxError('invalid-path', `${label} 不能为空。`);
  const resolved = path.resolve(workspace, candidate);
  if (!isWithin(workspace, resolved)) throw new ExcelXlsxError('outside-workspace', `${label} 必须位于当前工作区内。`);
  if (extension && path.extname(resolved).toLowerCase() !== extension) throw new ExcelXlsxError('invalid-path', `${label} 必须使用 ${extension} 扩展名。`);
  return resolved;
};

const assertNoReparsePath = async (workspace, target) => {
  let current = target;
  while (isWithin(workspace, current)) {
    try {
      const info = await fsp.lstat(current);
      if (info.isSymbolicLink()) throw new ExcelXlsxError('reparse-path', `拒绝通过符号链接或重解析点访问：${current}`);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    if (current === workspace) break;
    current = path.dirname(current);
  }
};

const readBoundedJson = async (filePath) => {
  const info = await fsp.stat(filePath);
  if (!info.isFile() || info.size <= 0 || info.size > MAX_SPEC_BYTES) throw new ExcelXlsxError('invalid-spec', `JSON 规格必须小于 ${MAX_SPEC_BYTES} 字节。`);
  try { return assertPlainObject(JSON.parse(await fsp.readFile(filePath, 'utf8')), 'JSON 规格'); }
  catch (error) {
    if (error instanceof ExcelXlsxError) throw error;
    throw new ExcelXlsxError('invalid-spec', `JSON 规格解析失败：${error.message}`);
  }
};

const columnName = (number) => {
  let value = number;
  let result = '';
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
};

const cellAddress = (row, column) => `${columnName(column)}${row}`;

const parseCellAddress = (value, label = '单元格') => {
  const match = /^\$?([A-Z]{1,3})\$?([1-9]\d*)$/i.exec(String(value || ''));
  if (!match) throw new ExcelXlsxError('invalid-cell', `${label} 地址无效：${value}`);
  let column = 0;
  for (const character of match[1].toUpperCase()) column = (column * 26) + character.charCodeAt(0) - 64;
  const row = Number(match[2]);
  if (column > MAX_COLUMNS || row > MAX_ROWS) throw new ExcelXlsxError('invalid-cell', `${label} 超出支持范围：${value}`);
  return { address: `${columnName(column)}${row}`, column, row };
};

const safeSheetName = (value, label) => {
  const name = boundedText(value, label, 31).trim();
  if (!name || /[\[\]:*?/\\]/.test(name) || name.startsWith("'") || name.endsWith("'") || /^history$/i.test(name)) {
    throw new ExcelXlsxError('invalid-sheet', `${label} 不是有效的工作表名称。`);
  }
  return name;
};

const normalizeRange = (value, label) => {
  const match = /^(\$?[A-Z]{1,3}\$?[1-9]\d*)(?::(\$?[A-Z]{1,3}\$?[1-9]\d*))?$/i.exec(String(value || ''));
  if (!match) throw new ExcelXlsxError('invalid-range', `${label} 范围无效。`);
  const first = parseCellAddress(match[1], label).address;
  const last = parseCellAddress(match[2] || match[1], label).address;
  return match[2] ? `${first}:${last}` : first;
};

const normalizeFormula = (value, label) => {
  let formula = boundedText(value, label, MAX_FORMULA_CHARS).trim();
  if (formula.startsWith('=')) formula = formula.slice(1);
  if (!formula || formula.includes('[') || formula.includes(']') || formula.includes('|') || /(?:https?|ftp|file):|\\\\/i.test(formula) || RISKY_FORMULA.test(formula)) {
    throw new ExcelXlsxError('unsafe-formula', `${label} 包含外部工作簿、网络、DDE 或可执行公式风险。`);
  }
  return formula;
};

const dateSerial = (value, label) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(boundedText(value, label, 10));
  if (!match) throw new ExcelXlsxError('invalid-date', `${label} 必须使用 YYYY-MM-DD。`);
  const [year, month, day] = match.slice(1).map(Number);
  const timestamp = Date.UTC(year, month - 1, day);
  const date = new Date(timestamp);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) throw new ExcelXlsxError('invalid-date', `${label} 日期无效。`);
  return (timestamp / 86_400_000) + 25_569;
};

const normalizeStyle = (value, label) => {
  const name = value === undefined ? 'normal' : boundedText(value, label, 32);
  if (!(name in STYLE_IDS)) throw new ExcelXlsxError('invalid-style', `${label} 不受支持：${name}`);
  return name;
};

const normalizeCell = (value, label) => {
  if (value === null || value === undefined) return { kind: 'blank', style: 'normal' };
  if (typeof value === 'string') return { kind: 'string', value: boundedText(value, label), style: 'normal' };
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new ExcelXlsxError('invalid-cell', `${label} 数值必须有限。`);
    return { kind: 'number', value, style: 'normal' };
  }
  if (typeof value === 'boolean') return { kind: 'boolean', value, style: 'normal' };
  const cell = assertPlainObject(value, label);
  const style = normalizeStyle(cell.style, `${label}.style`);
  const kinds = ['value', 'formula', 'date', 'blank'].filter((key) => cell[key] !== undefined && cell[key] !== false);
  if (kinds.length !== 1) throw new ExcelXlsxError('invalid-cell', `${label} 必须且只能声明 value、formula、date 或 blank。`);
  if (cell.formula !== undefined) {
    const cached = cell.cached;
    if (cached !== undefined && (typeof cached !== 'number' || !Number.isFinite(cached))) throw new ExcelXlsxError('invalid-cell', `${label}.cached 只能是有限数值。`);
    return { kind: 'formula', formula: normalizeFormula(cell.formula, `${label}.formula`), cached, style };
  }
  if (cell.date !== undefined) return { kind: 'number', value: dateSerial(cell.date, `${label}.date`), style: cell.style === undefined ? 'date' : style };
  if (cell.blank === true) return { kind: 'blank', style };
  const scalar = cell.value;
  if (!['string', 'number', 'boolean'].includes(typeof scalar) || (typeof scalar === 'number' && !Number.isFinite(scalar))) {
    throw new ExcelXlsxError('invalid-cell', `${label}.value 必须是文本、有限数值或布尔值。`);
  }
  return { kind: typeof scalar, value: typeof scalar === 'string' ? boundedText(scalar, `${label}.value`) : scalar, style };
};

const quotedSheetReference = (value, sheets, label) => {
  const match = /^'((?:[^']|'')+)'!(\$?[A-Z]{1,3}\$?[1-9]\d*)$/.exec(String(value || ''));
  if (!match) throw new ExcelXlsxError('invalid-reference', `${label} 必须使用带单引号的跨表单元格引用。`);
  const name = match[1].replaceAll("''", "'");
  if (!sheets.some((sheet) => sheet.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new ExcelXlsxError('invalid-reference', `${label} 引用了不存在的工作表。`);
  parseCellAddress(match[2], label);
  return `'${name.replaceAll("'", "''")}'!${match[2].toUpperCase()}`;
};

const normalizeSpec = (raw) => {
  const title = boundedText(raw.title || 'DSH Desktop Workbook', 'title', 255);
  const sourceSheets = safeArray(raw.sheets, 'sheets', MAX_SHEETS);
  if (sourceSheets.length === 0) throw new ExcelXlsxError('invalid-spec', 'sheets 不能为空。');
  let totalCells = 0;
  const names = new Set();
  const sheets = sourceSheets.map((source, sheetIndex) => {
    const sheet = assertPlainObject(source, `sheets[${sheetIndex}]`);
    const name = safeSheetName(sheet.name, `sheets[${sheetIndex}].name`);
    const key = name.toLocaleLowerCase();
    if (names.has(key)) throw new ExcelXlsxError('invalid-sheet', `工作表名称不能重复：${name}`);
    names.add(key);
    const rows = safeArray(sheet.rows, `sheets[${sheetIndex}].rows`, MAX_ROWS).map((row, rowIndex) => {
      if (!Array.isArray(row) || row.length > MAX_COLUMNS) throw new ExcelXlsxError('invalid-spec', `sheets[${sheetIndex}].rows[${rowIndex}] 列数无效。`);
      totalCells += row.length;
      if (totalCells > MAX_TOTAL_CELLS) throw new ExcelXlsxError('invalid-spec', `工作簿单元格超过 ${MAX_TOTAL_CELLS}。`);
      return row.map((cell, columnIndex) => normalizeCell(cell, `sheets[${sheetIndex}].rows[${rowIndex}][${columnIndex}]`));
    });
    const columns = safeArray(sheet.columns, `sheets[${sheetIndex}].columns`, MAX_COLUMNS).map((width, index) => {
      if (typeof width !== 'number' || !Number.isFinite(width) || width < 4 || width > 80) throw new ExcelXlsxError('invalid-spec', `sheets[${sheetIndex}].columns[${index}] 宽度必须为 4–80。`);
      return width;
    });
    const freeze = sheet.freeze === undefined ? { rows: 0, columns: 0 } : assertPlainObject(sheet.freeze, `sheets[${sheetIndex}].freeze`);
    const frozenRows = Number(freeze.rows || 0);
    const frozenColumns = Number(freeze.columns || 0);
    if (!Number.isInteger(frozenRows) || frozenRows < 0 || frozenRows > MAX_ROWS || !Number.isInteger(frozenColumns) || frozenColumns < 0 || frozenColumns > MAX_COLUMNS) {
      throw new ExcelXlsxError('invalid-spec', `sheets[${sheetIndex}].freeze 超出范围。`);
    }
    return {
      name,
      rows,
      columns,
      freeze: { rows: frozenRows, columns: frozenColumns },
      showGridLines: sheet.showGridLines !== false,
      mergedCells: safeArray(sheet.mergedCells, `sheets[${sheetIndex}].mergedCells`, 256).map((range, index) => normalizeRange(range, `sheets[${sheetIndex}].mergedCells[${index}]`)),
      autoFilter: sheet.autoFilter ? normalizeRange(sheet.autoFilter, `sheets[${sheetIndex}].autoFilter`) : ''
    };
  });
  const reconciliations = safeArray(raw.reconciliations, 'reconciliations', 256).map((source, index) => {
    const item = assertPlainObject(source, `reconciliations[${index}]`);
    const tolerance = item.tolerance === undefined ? 0 : item.tolerance;
    if (typeof tolerance !== 'number' || !Number.isFinite(tolerance) || tolerance < 0) throw new ExcelXlsxError('invalid-spec', `reconciliations[${index}].tolerance 必须是非负数。`);
    return {
      label: boundedText(item.label, `reconciliations[${index}].label`, 255),
      left: quotedSheetReference(item.left, sheets, `reconciliations[${index}].left`),
      right: quotedSheetReference(item.right, sheets, `reconciliations[${index}].right`),
      tolerance
    };
  });
  if (reconciliations.length > 0) {
    if (names.has('reconciliation')) throw new ExcelXlsxError('invalid-sheet', '启用 reconciliations 时不能自行创建 Reconciliation 工作表。');
    const rows = [
      [{ kind: 'string', value: 'Reconciliation Checks', style: 'title' }],
      ['Check', 'Left reference', 'Right reference', 'Left value', 'Right value', 'Difference', 'Status', 'Tolerance'].map((value) => ({ kind: 'string', value, style: 'header' }))
    ];
    for (const [index, item] of reconciliations.entries()) {
      const row = index + 3;
      rows.push([
        { kind: 'string', value: item.label, style: 'text' },
        { kind: 'string', value: item.left, style: 'text' },
        { kind: 'string', value: item.right, style: 'text' },
        { kind: 'formula', formula: item.left, style: 'decimal' },
        { kind: 'formula', formula: item.right, style: 'decimal' },
        { kind: 'formula', formula: `D${row}-E${row}`, style: 'decimal' },
        { kind: 'formula', formula: `IF(ABS(F${row})<=H${row},\"OK\",\"MISMATCH\")`, style: 'formula' },
        { kind: 'number', value: item.tolerance, style: 'decimal' }
      ]);
    }
    totalCells += rows.reduce((sum, row) => sum + row.length, 0);
    if (totalCells > MAX_TOTAL_CELLS) throw new ExcelXlsxError('invalid-spec', `工作簿单元格超过 ${MAX_TOTAL_CELLS}。`);
    sheets.push({
      name: 'Reconciliation',
      rows,
      columns: [28, 24, 24, 16, 16, 16, 16, 14],
      freeze: { rows: 2, columns: 1 },
      showGridLines: false,
      mergedCells: ['A1:H1'],
      autoFilter: `A2:H${rows.length}`,
      conditionalStatusRange: `G3:G${rows.length}`
    });
  }
  return { title, sheets, totalCells, reconciliations: reconciliations.length };
};

const styleXml = () => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="3"><numFmt numFmtId="164" formatCode="&quot;¥&quot;#,##0.00;[Red]-&quot;¥&quot;#,##0.00"/><numFmt numFmtId="165" formatCode="yyyy-mm-dd"/><numFmt numFmtId="166" formatCode="0.00;[Red]-0.00"/></numFmts>
  <fonts count="5">
    <font><sz val="11"/><name val="Aptos"/><family val="2"/></font>
    <font><b/><sz val="18"/><color rgb="FF17324D"/><name val="Aptos Display"/><family val="2"/></font>
    <font><sz val="11"/><color rgb="FF5F6B76"/><name val="Aptos"/><family val="2"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Aptos"/><family val="2"/></font>
    <font><b/><sz val="11"/><color rgb="FF17324D"/><name val="Aptos"/><family val="2"/></font>
  </fonts>
  <fills count="7"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE9F0F6"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF176B87"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF3F7FA"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE7F4EA"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFBE9E7"/><bgColor indexed="64"/></patternFill></fill></fills>
  <borders count="3"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FFD3DEE7"/></bottom><diagonal/></border><border><left/><right/><top style="double"><color rgb="FF176B87"/></top><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="14">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="3" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
    <xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
    <xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
    <xf numFmtId="10" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
    <xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
    <xf numFmtId="166" fontId="0" fillId="4" borderId="0" xfId="0" applyNumberFormat="1" applyFill="1"/>
    <xf numFmtId="166" fontId="4" fillId="0" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>
    <xf numFmtId="0" fontId="4" fillId="5" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
    <xf numFmtId="0" fontId="4" fillId="6" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
  <dxfs count="2"><dxf><font><b/><color rgb="FF176B45"/></font><fill><patternFill patternType="solid"><fgColor rgb="FFE7F4EA"/><bgColor rgb="FFE7F4EA"/></patternFill></fill></dxf><dxf><font><b/><color rgb="FFA12B1F"/></font><fill><patternFill patternType="solid"><fgColor rgb="FFFBE9E7"/><bgColor rgb="FFFBE9E7"/></patternFill></fill></dxf></dxfs><tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>
</styleSheet>`;

const cellXml = (cell, address, styleOverride) => {
  const style = styleOverride === undefined ? STYLE_IDS[cell.style || 'normal'] : styleOverride;
  const s = style ? ` s="${style}"` : '';
  if (cell.kind === 'blank') return style ? `<c r="${address}"${s}/>` : '';
  if (cell.kind === 'string') {
    const preserve = /^\s|\s$|\s{2}/.test(cell.value) ? ' xml:space="preserve"' : '';
    return `<c r="${address}"${s} t="inlineStr"><is><t${preserve}>${xmlEscape(cell.value)}</t></is></c>`;
  }
  if (cell.kind === 'boolean') return `<c r="${address}"${s} t="b"><v>${cell.value ? 1 : 0}</v></c>`;
  if (cell.kind === 'number') return `<c r="${address}"${s}><v>${cell.value}</v></c>`;
  if (cell.kind === 'formula') return `<c r="${address}"${s}><f>${xmlEscape(cell.formula)}</f><v>${cell.cached ?? ''}</v></c>`;
  throw new ExcelXlsxError('invalid-cell', `不支持的单元格类型：${cell.kind}`);
};

const paneXml = (freeze) => {
  if (!freeze.rows && !freeze.columns) return '';
  const topLeft = cellAddress(freeze.rows + 1, freeze.columns + 1);
  const attributes = [
    freeze.columns ? `xSplit="${freeze.columns}"` : '',
    freeze.rows ? `ySplit="${freeze.rows}"` : '',
    `topLeftCell="${topLeft}"`,
    `activePane="${freeze.rows && freeze.columns ? 'bottomRight' : (freeze.rows ? 'bottomLeft' : 'topRight')}"`,
    'state="frozen"'
  ].filter(Boolean).join(' ');
  return `<pane ${attributes}/>`;
};

const worksheetXml = (sheet) => {
  const rowParts = [];
  for (let rowIndex = 0; rowIndex < sheet.rows.length; rowIndex += 1) {
    const cells = [];
    for (let columnIndex = 0; columnIndex < sheet.rows[rowIndex].length; columnIndex += 1) {
      const xml = cellXml(sheet.rows[rowIndex][columnIndex], cellAddress(rowIndex + 1, columnIndex + 1));
      if (xml) cells.push(xml);
    }
    if (cells.length > 0) rowParts.push(`<row r="${rowIndex + 1}">${cells.join('')}</row>`);
  }
  const columns = sheet.columns.length > 0
    ? `<cols>${sheet.columns.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join('')}</cols>`
    : '';
  const merges = sheet.mergedCells.length > 0 ? `<mergeCells count="${sheet.mergedCells.length}">${sheet.mergedCells.map((range) => `<mergeCell ref="${range}"/>`).join('')}</mergeCells>` : '';
  const conditionalStatus = sheet.conditionalStatusRange
    ? `<conditionalFormatting sqref="${sheet.conditionalStatusRange}"><cfRule type="cellIs" dxfId="0" priority="2" operator="equal"><formula>&quot;OK&quot;</formula></cfRule><cfRule type="cellIs" dxfId="1" priority="1" operator="equal"><formula>&quot;MISMATCH&quot;</formula></cfRule></conditionalFormatting>`
    : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews><sheetView workbookViewId="0" showGridLines="${sheet.showGridLines ? 1 : 0}">${paneXml(sheet.freeze)}</sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="15"/>
  ${columns}<sheetData>${rowParts.join('')}</sheetData>${sheet.autoFilter ? `<autoFilter ref="${sheet.autoFilter}"/>` : ''}${merges}${conditionalStatus}
  <pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>
</worksheet>`;
};

const workbookEntries = (spec) => {
  const now = new Date().toISOString();
  const overrides = spec.sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('');
  const sheets = spec.sheets.map((sheet, index) => `<sheet name="${xmlEscape(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('');
  const relationships = spec.sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('');
  const entries = [
    { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>${overrides}</Types>` },
    { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>` },
    { name: 'docProps/core.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlEscape(spec.title)}</dc:title><dc:creator>DSH Desktop</dc:creator><cp:lastModifiedBy>DSH Desktop</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>` },
    { name: 'docProps/app.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Microsoft Excel</Application><AppVersion>16.0300</AppVersion></Properties>` },
    { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView xWindow="0" yWindow="0" windowWidth="24000" windowHeight="14000"/></bookViews><sheets>${sheets}</sheets><calcPr calcId="191029" calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"/></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships}<Relationship Id="rId${spec.sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: 'xl/styles.xml', data: styleXml() }
  ];
  spec.sheets.forEach((sheet, index) => entries.push({ name: `xl/worksheets/sheet${index + 1}.xml`, data: worksheetXml(sheet) }));
  return entries;
};

const tagAttributes = (tag) => Object.fromEntries([...tag.matchAll(/([\w:.-]+)="([^"]*)"/g)].map((match) => [match[1], xmlUnescape(match[2])]));

const workbookSheets = (entries) => {
  const workbook = entries.get('xl/workbook.xml')?.toString('utf8') || '';
  const relationships = entries.get('xl/_rels/workbook.xml.rels')?.toString('utf8') || '';
  const relMap = new Map();
  for (const match of relationships.matchAll(/<Relationship\b[^>]*\/?\s*>/g)) {
    const attributes = tagAttributes(match[0]);
    if (attributes.Id && attributes.Target) relMap.set(attributes.Id, attributes.Target);
  }
  const sheets = [];
  for (const match of workbook.matchAll(/<sheet\b[^>]*\/?\s*>/g)) {
    const attributes = tagAttributes(match[0]);
    const target = relMap.get(attributes['r:id']);
    if (!target || !/^worksheets\/[^/]+\.xml$/.test(target)) throw new ExcelXlsxError('invalid-xlsx', '工作表关系无效。');
    const entry = `xl/${target}`;
    if (!entries.has(entry)) throw new ExcelXlsxError('invalid-xlsx', `缺少工作表条目：${entry}`);
    sheets.push({ name: attributes.name, entry });
  }
  if (sheets.length === 0 || sheets.length > MAX_SHEETS) throw new ExcelXlsxError('invalid-xlsx', '工作表数量无效。');
  return sheets;
};

const readWorkbookZip = (buffer) => {
  try { return readZip(buffer); }
  catch (error) {
    throw new ExcelXlsxError('invalid-xlsx', `XLSX ZIP 无效：${String(error?.message || error).replaceAll('DOCX', 'XLSX')}`);
  }
};

const inspectEntries = (entries) => {
  for (const name of REQUIRED_ENTRIES) if (!entries.has(name)) throw new ExcelXlsxError('invalid-xlsx', `XLSX 缺少条目：${name}`);
  const sheets = workbookSheets(entries);
  let cells = 0;
  let formulas = 0;
  let formulaErrors = 0;
  let riskyFormulas = 0;
  let unsupportedFormulaStructures = 0;
  let filters = 0;
  let frozenPanes = 0;
  const details = sheets.map((sheet) => {
    const xml = entries.get(sheet.entry).toString('utf8');
    const sheetCells = (xml.match(/<c\b/g) || []).length;
    const formulaTags = [...xml.matchAll(/<f(?:\s[^>]*)?(?:\/>|>[\s\S]*?<\/f>)/g)].map((match) => match[0]);
    const sheetFormulas = formulaTags.map((tag) => xmlUnescape(/>([\s\S]*?)<\/f>$/.exec(tag)?.[1] || ''));
    const sheetUnsupportedFormulaStructures = formulaTags.filter((tag) => /\bt="(?:shared|array|dataTable)"/i.test(tag) || /<f(?:\s[^>]*)?\/>$/.test(tag)).length;
    const sheetErrors = (xml.match(/<c\b[^>]*\bt="e"[^>]*>[\s\S]*?<\/c>/g) || []).length;
    const sheetRisks = sheetFormulas.filter((formula) => {
      try { normalizeFormula(formula, 'existing formula'); return false; } catch { return true; }
    }).length;
    cells += sheetCells;
    formulas += sheetFormulas.length;
    formulaErrors += sheetErrors;
    riskyFormulas += sheetRisks;
    unsupportedFormulaStructures += sheetUnsupportedFormulaStructures;
    if (/<autoFilter\b/.test(xml)) filters += 1;
    if (/<pane\b[^>]*\bstate="frozen"/.test(xml)) frozenPanes += 1;
    return { name: sheet.name, cells: sheetCells, formulas: sheetFormulas.length, formulaErrors: sheetErrors, riskyFormulas: sheetRisks, unsupportedFormulaStructures: sheetUnsupportedFormulaStructures };
  });
  const externalLinks = [...entries.keys()].filter((name) => name.startsWith('xl/externalLinks/')).length;
  const connections = entries.has('xl/connections.xml') ? 1 : 0;
  const queryTables = [...entries.keys()].filter((name) => name.startsWith('xl/queryTables/')).length;
  const macros = [...entries.keys()].filter((name) => /vbaProject\.bin$/i.test(name)).length;
  return { entryCount: entries.size, sheetCount: sheets.length, cells, formulas, formulaErrors, riskyFormulas, unsupportedFormulaStructures, filters, frozenPanes, externalLinks, connections, queryTables, macros, sheets: details };
};

const assertStrictInspection = (inspection) => {
  if (inspection.formulaErrors || inspection.riskyFormulas || inspection.unsupportedFormulaStructures || inspection.externalLinks || inspection.connections || inspection.queryTables || inspection.macros) {
    throw new ExcelXlsxError('strict-validation-failed', `严格检查失败：公式错误 ${inspection.formulaErrors}，风险公式 ${inspection.riskyFormulas}，不支持的公式结构 ${inspection.unsupportedFormulaStructures}，外部链接 ${inspection.externalLinks}，连接 ${inspection.connections}，查询表 ${inspection.queryTables}，宏 ${inspection.macros}。`);
  }
};

const atomicWrite = async (outputPath, buffer, { overwrite = false } = {}) => {
  await fsp.mkdir(path.dirname(outputPath), { recursive: true });
  let existed = false;
  try {
    const existing = await fsp.lstat(outputPath);
    if (!existing.isFile()) throw new ExcelXlsxError('invalid-output', '输出路径已存在且不是普通文件。');
    if (!overwrite) throw new ExcelXlsxError('output-exists', '输出文件已存在；如确认覆盖，请使用 --overwrite。');
    existed = true;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  let backup = '';
  if (existed) {
    const parsed = path.parse(outputPath);
    backup = path.join(parsed.dir, `${parsed.name}.dsh-backup-${Date.now()}${parsed.ext}`);
    await fsp.copyFile(outputPath, backup, fs.constants.COPYFILE_EXCL);
  }
  const temporary = path.join(path.dirname(outputPath), `.${path.basename(outputPath)}.${process.pid}.${Date.now()}.tmp`);
  try {
    await fsp.writeFile(temporary, buffer, { flag: 'wx' });
    assertStrictInspection(inspectEntries(readWorkbookZip(await fsp.readFile(temporary))));
    if (process.platform === 'win32' && existed) await fsp.rm(outputPath);
    await fsp.rename(temporary, outputPath);
  } catch (error) {
    await fsp.rm(temporary, { force: true }).catch(() => {});
    if (backup && !fs.existsSync(outputPath)) await fsp.copyFile(backup, outputPath).catch(() => {});
    throw error;
  }
  return backup;
};

const createWorkbook = async ({ workspace, specPath, outputPath, overwrite = false }) => {
  const root = resolveWorkspace(workspace);
  const specFile = resolveWorkspacePath(root, specPath, '规格文件', '.json');
  const output = resolveWorkspacePath(root, outputPath, '输出文件', '.xlsx');
  await assertNoReparsePath(root, specFile);
  await assertNoReparsePath(root, output);
  const spec = normalizeSpec(await readBoundedJson(specFile));
  const buffer = createZip(workbookEntries(spec));
  const backup = await atomicWrite(output, buffer, { overwrite });
  return { operation: 'create', output, bytes: buffer.length, backup, reconciliations: spec.reconciliations, ...inspectEntries(readWorkbookZip(buffer)) };
};

const parseCsv = (text) => {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"' && field === '') quoted = true;
    else if (character === ',') { row.push(field); field = ''; }
    else if (character === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (character !== '\r') field += character;
  }
  if (quoted) throw new ExcelXlsxError('invalid-csv', 'CSV 引号未闭合。');
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  if (rows.length === 0 || rows.length > MAX_ROWS) throw new ExcelXlsxError('invalid-csv', 'CSV 行数无效。');
  const columns = Math.max(...rows.map((item) => item.length));
  if (columns > MAX_COLUMNS || rows.length * columns > MAX_TOTAL_CELLS) throw new ExcelXlsxError('invalid-csv', 'CSV 超出行列或单元格上限。');
  return rows;
};

const inferredCsvCell = (value) => {
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) && value.length <= 18) {
    const number = Number(value);
    if (Number.isFinite(number)) return { value: number, style: Number.isInteger(number) ? 'integer' : 'decimal' };
  }
  return value;
};

const importCsv = async ({ workspace, inputPath, outputPath, sheetName = 'Data', header = true, inferNumbers = false, overwrite = false }) => {
  const root = resolveWorkspace(workspace);
  const input = resolveWorkspacePath(root, inputPath, 'CSV 文件', '.csv');
  const output = resolveWorkspacePath(root, outputPath, '输出文件', '.xlsx');
  await assertNoReparsePath(root, input);
  await assertNoReparsePath(root, output);
  const info = await fsp.stat(input);
  if (!info.isFile() || info.size <= 0 || info.size > MAX_CSV_BYTES) throw new ExcelXlsxError('invalid-csv', `CSV 必须小于 ${MAX_CSV_BYTES} 字节。`);
  const rows = parseCsv((await fsp.readFile(input, 'utf8')).replace(/^\ufeff/, '')).map((row, rowIndex) => row.map((value) => {
    const converted = inferNumbers ? inferredCsvCell(value) : value;
    if (rowIndex === 0 && header) return { value: typeof converted === 'object' ? String(converted.value) : String(converted), style: 'header' };
    return converted;
  }));
  const widthCount = Math.max(...rows.map((row) => row.length));
  const spec = normalizeSpec({
    title: path.basename(input),
    sheets: [{
      name: safeSheetName(sheetName, 'sheet-name'),
      showGridLines: false,
      freeze: { rows: header ? 1 : 0, columns: 0 },
      columns: Array.from({ length: widthCount }, (_, index) => Math.min(40, Math.max(12, ...rows.slice(0, 200).map((row) => String(typeof row[index] === 'object' ? row[index]?.value ?? '' : row[index] ?? '').length + 2)))),
      autoFilter: header ? `A1:${columnName(widthCount)}${rows.length}` : '',
      rows
    }]
  });
  const buffer = createZip(workbookEntries(spec));
  const backup = await atomicWrite(output, buffer, { overwrite });
  return { operation: 'import-csv', input, output, bytes: buffer.length, backup, importedRows: rows.length, importedColumns: widthCount, inferredNumbers: inferNumbers, ...inspectEntries(readWorkbookZip(buffer)) };
};

const normalizeUpdateCell = (source, label) => {
  const update = assertPlainObject(source, label);
  const sheet = safeSheetName(update.sheet, `${label}.sheet`);
  const cell = parseCellAddress(update.cell, `${label}.cell`).address;
  if (update.clear === true) return { sheet, cell, clear: true };
  const normalized = normalizeCell(Object.fromEntries(Object.entries(update).filter(([key]) => ['value', 'formula', 'date', 'blank'].includes(key))), label);
  let styleIndex;
  if (update.styleIndex !== undefined) {
    if (!Number.isInteger(update.styleIndex) || update.styleIndex < 0 || update.styleIndex > 65_535) throw new ExcelXlsxError('invalid-style', `${label}.styleIndex 无效。`);
    styleIndex = update.styleIndex;
  }
  return { sheet, cell, normalized, styleIndex };
};

const setCellInWorksheet = (xml, address, update) => {
  const parsed = parseCellAddress(address);
  const rowPattern = new RegExp(`<row\\b[^>]*\\br="${parsed.row}"[^>]*>[\\s\\S]*?<\\/row>`);
  const rowMatch = rowPattern.exec(xml);
  const cellPattern = new RegExp(`<c\\b[^>]*\\br="${address}"[^>]*(?:\\/>|>[\\s\\S]*?<\\/c>)`);
  if (rowMatch) {
    const rowXml = rowMatch[0];
    const existing = cellPattern.exec(rowXml);
    if (update.clear) {
      if (!existing) return xml;
      return xml.slice(0, rowMatch.index) + rowXml.replace(cellPattern, '') + xml.slice(rowMatch.index + rowXml.length);
    }
    const existingStyle = existing?.[0].match(/\bs="(\d+)"/)?.[1];
    const replacement = cellXml(update.normalized, address, update.styleIndex ?? (existingStyle === undefined ? 0 : Number(existingStyle)));
    let changed;
    if (existing) changed = rowXml.replace(cellPattern, replacement);
    else {
      let offset = rowXml.lastIndexOf('</row>');
      for (const match of rowXml.matchAll(/<c\b[^>]*\br="([A-Z]{1,3}[1-9]\d*)"[^>]*(?:\/>|>[\s\S]*?<\/c>)/g)) {
        if (parseCellAddress(match[1]).column > parsed.column) { offset = match.index; break; }
      }
      changed = `${rowXml.slice(0, offset)}${replacement}${rowXml.slice(offset)}`;
    }
    return xml.slice(0, rowMatch.index) + changed + xml.slice(rowMatch.index + rowXml.length);
  }
  if (update.clear) return xml;
  const cell = cellXml(update.normalized, address, update.styleIndex ?? 0);
  const newRow = `<row r="${parsed.row}">${cell}</row>`;
  const sheetData = /<sheetData(?:\s[^>]*)?>([\s\S]*?)<\/sheetData>/.exec(xml);
  if (!sheetData) throw new ExcelXlsxError('invalid-xlsx', '工作表缺少 sheetData。');
  const inner = sheetData[1];
  let offset = inner.length;
  for (const match of inner.matchAll(/<row\b[^>]*\br="(\d+)"[^>]*>[\s\S]*?<\/row>/g)) {
    if (Number(match[1]) > parsed.row) { offset = match.index; break; }
  }
  const changedInner = inner.slice(0, offset) + newRow + inner.slice(offset);
  return xml.slice(0, sheetData.index) + sheetData[0].replace(inner, changedInner) + xml.slice(sheetData.index + sheetData[0].length);
};

const setCells = async ({ workspace, inputPath, specPath, outputPath, overwrite = false }) => {
  const root = resolveWorkspace(workspace);
  const input = resolveWorkspacePath(root, inputPath, '输入文件', '.xlsx');
  const specFile = resolveWorkspacePath(root, specPath, '规格文件', '.json');
  const output = resolveWorkspacePath(root, outputPath, '输出文件', '.xlsx');
  await Promise.all([assertNoReparsePath(root, input), assertNoReparsePath(root, specFile), assertNoReparsePath(root, output)]);
  const info = await fsp.stat(input);
  if (!info.isFile() || info.size <= 0 || info.size > MAX_XLSX_BYTES) throw new ExcelXlsxError('invalid-xlsx', `输入 XLSX 必须小于 ${MAX_XLSX_BYTES} 字节。`);
  const entries = readWorkbookZip(await fsp.readFile(input));
  assertStrictInspection(inspectEntries(entries));
  const sheetMap = new Map(workbookSheets(entries).map((sheet) => [sheet.name.toLocaleLowerCase(), sheet]));
  const raw = await readBoundedJson(specFile);
  const updates = safeArray(raw.updates, 'updates', 2_000).map((update, index) => normalizeUpdateCell(update, `updates[${index}]`));
  if (updates.length === 0) throw new ExcelXlsxError('invalid-spec', 'updates 不能为空。');
  const identities = updates.map((update) => `${update.sheet.toLocaleLowerCase()}!${update.cell}`);
  if (new Set(identities).size !== identities.length) throw new ExcelXlsxError('invalid-spec', 'updates 不能重复指向同一单元格。');
  for (const update of updates) {
    const sheet = sheetMap.get(update.sheet.toLocaleLowerCase());
    if (!sheet) throw new ExcelXlsxError('invalid-sheet', `未找到工作表：${update.sheet}`);
    const xml = entries.get(sheet.entry).toString('utf8');
    entries.set(sheet.entry, Buffer.from(setCellInWorksheet(xml, update.cell, update), 'utf8'));
  }
  for (const sheet of sheetMap.values()) {
    const xml = entries.get(sheet.entry).toString('utf8').replace(
      /(<f(?:\s[^>]*)?>[\s\S]*?<\/f>)<v(?:\s[^>]*)?>[\s\S]*?<\/v>/g,
      '$1<v></v>'
    );
    entries.set(sheet.entry, Buffer.from(xml, 'utf8'));
  }
  const workbookXml = entries.get('xl/workbook.xml').toString('utf8');
  const calcPr = '<calcPr calcId="191029" calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"/>';
  entries.set('xl/workbook.xml', Buffer.from(
    /<calcPr\b[^>]*\/?\s*>/.test(workbookXml)
      ? workbookXml.replace(/<calcPr\b[^>]*\/?\s*>/, calcPr)
      : workbookXml.replace('</workbook>', `${calcPr}</workbook>`),
    'utf8'
  ));
  const buffer = createZip([...entries].map(([name, data]) => ({ name, data })));
  const backup = await atomicWrite(output, buffer, { overwrite });
  return { operation: 'set-cells', input, output, bytes: buffer.length, backup, updates: updates.length, ...inspectEntries(readWorkbookZip(buffer)) };
};

const inspectWorkbook = async ({ workspace, inputPath, strict = false }) => {
  const root = resolveWorkspace(workspace);
  const input = resolveWorkspacePath(root, inputPath, '输入文件', '.xlsx');
  await assertNoReparsePath(root, input);
  const info = await fsp.stat(input);
  if (!info.isFile() || info.size <= 0 || info.size > MAX_XLSX_BYTES) throw new ExcelXlsxError('invalid-xlsx', `输入 XLSX 必须小于 ${MAX_XLSX_BYTES} 字节。`);
  const inspection = inspectEntries(readWorkbookZip(await fsp.readFile(input)));
  if (strict) assertStrictInspection(inspection);
  return { operation: 'inspect', input, bytes: info.size, strict, ...inspection };
};

const parseArgs = (args) => {
  const values = { _: [] };
  const flags = new Set(['overwrite', 'strict', 'infer-numbers', 'no-header']);
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith('--')) { values._.push(token); continue; }
    const name = token.slice(2);
    if (flags.has(name)) { values[name] = true; continue; }
    if (index + 1 >= args.length) throw new ExcelXlsxError('invalid-arguments', `参数 --${name} 缺少值。`);
    values[name] = args[index += 1];
  }
  return values;
};

const usage = () => [
  'DSH Desktop Excel XLSX Tool',
  'create --spec <spec.json> --output <file.xlsx> [--workspace <dir>] [--overwrite]',
  'import-csv --input <file.csv> --output <file.xlsx> [--sheet-name <name>] [--infer-numbers] [--no-header] [--workspace <dir>] [--overwrite]',
  'set-cells --input <file.xlsx> --spec <updates.json> --output <file.xlsx> [--workspace <dir>] [--overwrite]',
  'inspect --input <file.xlsx> [--strict] [--workspace <dir>]'
].join('\n');

const main = async (argv = process.argv.slice(2)) => {
  const args = parseArgs(argv);
  const command = args._[0];
  let result;
  if (command === 'create') result = await createWorkbook({ workspace: args.workspace, specPath: args.spec, outputPath: args.output, overwrite: args.overwrite });
  else if (command === 'import-csv') result = await importCsv({ workspace: args.workspace, inputPath: args.input, outputPath: args.output, sheetName: args['sheet-name'], header: !args['no-header'], inferNumbers: args['infer-numbers'], overwrite: args.overwrite });
  else if (command === 'set-cells') result = await setCells({ workspace: args.workspace, inputPath: args.input, specPath: args.spec, outputPath: args.output, overwrite: args.overwrite });
  else if (command === 'inspect') result = await inspectWorkbook({ workspace: args.workspace, inputPath: args.input, strict: args.strict });
  else throw new ExcelXlsxError('invalid-arguments', usage());
  process.stdout.write(`${JSON.stringify({ ok: true, ...result }, null, 2)}\n`);
  return result;
};

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({ ok: false, code: error?.code || 'excel-xlsx-failed', error: error?.message || String(error) })}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  ExcelXlsxError,
  MAX_COLUMNS,
  MAX_ROWS,
  MAX_SHEETS,
  MAX_TOTAL_CELLS,
  REQUIRED_ENTRIES,
  STYLE_IDS,
  createWorkbook,
  importCsv,
  inspectEntries,
  inspectWorkbook,
  normalizeFormula,
  normalizeSpec,
  parseCellAddress,
  parseCsv,
  setCells,
  workbookEntries,
  workbookSheets
};
