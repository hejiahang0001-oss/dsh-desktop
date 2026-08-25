#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const {
  createZip,
  imageMetadata,
  readZip,
  xmlEscape
} = require('../../word-docx/scripts/word-docx.cjs');
const {
  normalizeSpec: normalizeWorkbookSpec,
  workbookEntries
} = require('../../excel-xlsx/scripts/excel-xlsx.cjs');

const MAX_SPEC_BYTES = 4 * 1024 * 1024;
const MAX_PPTX_BYTES = 96 * 1024 * 1024;
const MAX_SLIDES = 40;
const MAX_ELEMENTS_PER_SLIDE = 80;
const MAX_TOTAL_ELEMENTS = 1_000;
const MAX_TEXT_CHARS = 120_000;
const MAX_IMAGES = 20;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 32 * 1024 * 1024;
const MAX_CHARTS = 20;
const MAX_CHART_CATEGORIES = 30;
const MAX_CHART_SERIES = 6;
const SLIDE_WIDTH = 13.333333;
const SLIDE_HEIGHT = 7.5;
const SLIDE_CX = 12_192_000;
const SLIDE_CY = 6_858_000;
const EMU = 914_400;
const REQUIRED_ENTRIES = Object.freeze([
  '[Content_Types].xml',
  '_rels/.rels',
  'ppt/presentation.xml',
  'ppt/_rels/presentation.xml.rels',
  'ppt/slideMasters/slideMaster1.xml',
  'ppt/slideLayouts/slideLayout1.xml',
  'ppt/slideLayouts/slideLayout2.xml',
  'ppt/notesMasters/notesMaster1.xml',
  'ppt/theme/theme1.xml'
]);

class PowerPointPptxError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PowerPointPptxError';
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
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PowerPointPptxError('invalid-spec', `${label} 必须是对象。`);
  return value;
};

const safeArray = (value, label, max) => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > max) throw new PowerPointPptxError('invalid-spec', `${label} 必须是最多 ${max} 项的数组。`);
  return value;
};

const boundedText = (value, label, max = 5_000, { optional = false } = {}) => {
  if (optional && (value === undefined || value === null || value === '')) return '';
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) {
    throw new PowerPointPptxError('invalid-spec', `${label} 必须是最多 ${max} 字符的安全文本。`);
  }
  return value;
};

const normalizeHex = (value, label, fallback) => {
  const text = value === undefined ? fallback : boundedText(value, label, 6);
  if (!/^[0-9A-F]{6}$/i.test(text)) throw new PowerPointPptxError('invalid-color', `${label} 必须是 6 位 HEX 颜色。`);
  return text.toUpperCase();
};

const isWithin = (root, target) => {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

const resolveWorkspace = (value) => path.resolve(value || process.env.DSH_CWD || process.cwd());

const resolveWorkspacePath = (workspace, candidate, label, extension) => {
  if (typeof candidate !== 'string' || candidate.trim() === '') throw new PowerPointPptxError('invalid-path', `${label} 不能为空。`);
  const resolved = path.resolve(workspace, candidate);
  if (!isWithin(workspace, resolved)) throw new PowerPointPptxError('outside-workspace', `${label} 必须位于当前工作区内。`);
  if (extension && path.extname(resolved).toLowerCase() !== extension) throw new PowerPointPptxError('invalid-path', `${label} 必须使用 ${extension} 扩展名。`);
  return resolved;
};

const assertNoReparsePath = async (workspace, target) => {
  let current = target;
  while (isWithin(workspace, current)) {
    try {
      const info = await fsp.lstat(current);
      if (info.isSymbolicLink()) throw new PowerPointPptxError('reparse-path', `拒绝通过符号链接或重解析点访问：${current}`);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    if (current === workspace) break;
    current = path.dirname(current);
  }
};

const readBoundedJson = async (filePath) => {
  const info = await fsp.stat(filePath);
  if (!info.isFile() || info.size <= 0 || info.size > MAX_SPEC_BYTES) throw new PowerPointPptxError('invalid-spec', `JSON 规格必须小于 ${MAX_SPEC_BYTES} 字节。`);
  try { return assertPlainObject(JSON.parse(await fsp.readFile(filePath, 'utf8')), 'JSON 规格'); }
  catch (error) {
    if (error instanceof PowerPointPptxError) throw error;
    throw new PowerPointPptxError('invalid-spec', `JSON 规格解析失败：${error.message}`);
  }
};

const emu = (value) => Math.round(value * EMU);

const normalizeBox = (source, label) => {
  const x = Number(source.x);
  const y = Number(source.y);
  const w = Number(source.w);
  const h = Number(source.h);
  if (![x, y, w, h].every(Number.isFinite) || x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > SLIDE_WIDTH + 0.001 || y + h > SLIDE_HEIGHT + 0.001) {
    throw new PowerPointPptxError('invalid-layout', `${label} 必须位于 ${SLIDE_WIDTH} × ${SLIDE_HEIGHT} 英寸画布内。`);
  }
  return { x, y, w, h };
};

const normalizeTextStyle = (source, label, defaults = {}) => {
  const fontSize = Number(source.fontSize ?? defaults.fontSize ?? 20);
  if (!Number.isFinite(fontSize) || fontSize < 8 || fontSize > 72) throw new PowerPointPptxError('invalid-style', `${label}.fontSize 必须为 8–72。`);
  const align = source.align ?? defaults.align ?? 'left';
  const valign = source.valign ?? defaults.valign ?? 'top';
  if (!['left', 'center', 'right'].includes(align) || !['top', 'middle', 'bottom'].includes(valign)) throw new PowerPointPptxError('invalid-style', `${label} 对齐方式无效。`);
  return {
    fontSize,
    color: normalizeHex(source.color, `${label}.color`, defaults.color || '17324D'),
    bold: source.bold === undefined ? Boolean(defaults.bold) : source.bold === true,
    align,
    valign,
    font: boundedText(source.font || defaults.font || '', `${label}.font`, 100, { optional: true }),
    eastAsiaFont: boundedText(source.eastAsiaFont || defaults.eastAsiaFont || '', `${label}.eastAsiaFont`, 100, { optional: true })
  };
};

const normalizeTextElement = (item, label) => ({
  kind: 'text',
  ...normalizeBox(item, label),
  text: boundedText(item.text, `${label}.text`, 10_000),
  style: normalizeTextStyle(item, label),
  fill: item.fill === undefined ? '' : normalizeHex(item.fill, `${label}.fill`, 'FFFFFF'),
  line: item.line === undefined ? '' : normalizeHex(item.line, `${label}.line`, 'D8E1E8'),
  margin: Number.isFinite(Number(item.margin)) ? Math.max(0, Math.min(0.4, Number(item.margin))) : 0.08
});

const normalizeShapeElement = (item, label) => {
  const shape = item.shape || 'rect';
  if (!['rect', 'roundRect', 'ellipse', 'chevron'].includes(shape)) throw new PowerPointPptxError('invalid-shape', `${label}.shape 不受支持。`);
  return {
    kind: 'shape',
    shape,
    ...normalizeBox(item, label),
    text: boundedText(item.text, `${label}.text`, 5_000, { optional: true }),
    style: normalizeTextStyle(item, label, { align: 'center', valign: 'middle', fontSize: 18 }),
    fill: normalizeHex(item.fill, `${label}.fill`, 'E9F0F6'),
    line: normalizeHex(item.line, `${label}.line`, 'B8C7D4'),
    radius: 0
  };
};

const normalizeTableElement = (item, label) => {
  const rows = safeArray(item.rows, `${label}.rows`, 20).map((row, rowIndex) => {
    if (!Array.isArray(row) || row.length === 0 || row.length > 10) throw new PowerPointPptxError('invalid-table', `${label}.rows[${rowIndex}] 列数无效。`);
    return row.map((cell, columnIndex) => boundedText(String(cell ?? ''), `${label}.rows[${rowIndex}][${columnIndex}]`, 2_000));
  });
  if (rows.length === 0) throw new PowerPointPptxError('invalid-table', `${label}.rows 不能为空。`);
  const columns = rows[0].length;
  if (rows.some((row) => row.length !== columns)) throw new PowerPointPptxError('invalid-table', `${label} 每行列数必须一致。`);
  const widths = item.widths === undefined ? Array(columns).fill(1 / columns) : safeArray(item.widths, `${label}.widths`, 10).map(Number);
  if (widths.length !== columns || widths.some((value) => !Number.isFinite(value) || value <= 0)) throw new PowerPointPptxError('invalid-table', `${label}.widths 必须与列数一致且为正数。`);
  return { kind: 'table', ...normalizeBox(item, label), rows, widths, header: item.header !== false, fontSize: Math.max(9, Math.min(28, Number(item.fontSize) || 14)) };
};

const normalizeChartElement = (item, label) => {
  const type = item.type || 'column';
  if (!['column', 'bar', 'line', 'pie'].includes(type)) throw new PowerPointPptxError('invalid-chart', `${label}.type 不受支持。`);
  const categories = safeArray(item.categories, `${label}.categories`, MAX_CHART_CATEGORIES).map((value, index) => boundedText(String(value), `${label}.categories[${index}]`, 200));
  if (categories.length < 2) throw new PowerPointPptxError('invalid-chart', `${label}.categories 至少需要 2 项。`);
  const series = safeArray(item.series, `${label}.series`, MAX_CHART_SERIES).map((entry, seriesIndex) => {
    const source = assertPlainObject(entry, `${label}.series[${seriesIndex}]`);
    const values = safeArray(source.values, `${label}.series[${seriesIndex}].values`, MAX_CHART_CATEGORIES).map((value, valueIndex) => {
      const number = Number(value);
      if (!Number.isFinite(number) || Math.abs(number) > 1e15) throw new PowerPointPptxError('invalid-chart', `${label}.series[${seriesIndex}].values[${valueIndex}] 必须是绝对值不超过 1e15 的有限数值。`);
      return number;
    });
    if (values.length !== categories.length) throw new PowerPointPptxError('invalid-chart', `${label}.series[${seriesIndex}] 数值数量必须等于分类数量。`);
    return { name: boundedText(source.name, `${label}.series[${seriesIndex}].name`, 200), values };
  });
  if (series.length === 0 || (type === 'pie' && series.length !== 1)) throw new PowerPointPptxError('invalid-chart', `${label} 系列数量无效。`);
  return { kind: 'chart', ...normalizeBox(item, label), type, categories, series, title: boundedText(item.title, `${label}.title`, 300, { optional: true }) };
};

const normalizeImageElement = (item, label) => ({
  kind: 'image',
  ...normalizeBox(item, label),
  path: boundedText(item.path, `${label}.path`, 1_000),
  alt: boundedText(item.alt || path.basename(String(item.path || 'image')), `${label}.alt`, 500)
});

const normalizeElement = (source, label) => {
  const item = assertPlainObject(source, label);
  const kind = item.kind;
  if (kind === 'text') return normalizeTextElement(item, label);
  if (kind === 'shape') return normalizeShapeElement(item, label);
  if (kind === 'table') return normalizeTableElement(item, label);
  if (kind === 'chart') return normalizeChartElement(item, label);
  if (kind === 'image') return normalizeImageElement(item, label);
  throw new PowerPointPptxError('invalid-element', `${label}.kind 不受支持。`);
};

const normalizeSpec = (raw) => {
  const source = assertPlainObject(raw, 'PPTX 规格');
  const themeSource = source.theme === undefined ? {} : assertPlainObject(source.theme, 'theme');
  const theme = {
    name: boundedText(themeSource.name || 'DSH Desktop Theme', 'theme.name', 200),
    accent: normalizeHex(themeSource.accent, 'theme.accent', '176B87'),
    accent2: normalizeHex(themeSource.accent2, 'theme.accent2', '5B8DEF'),
    dark: normalizeHex(themeSource.dark, 'theme.dark', '17324D'),
    light: normalizeHex(themeSource.light, 'theme.light', 'F7FAFC'),
    muted: normalizeHex(themeSource.muted, 'theme.muted', '647585'),
    font: boundedText(themeSource.font || 'Aptos', 'theme.font', 100),
    eastAsiaFont: boundedText(themeSource.eastAsiaFont || 'Microsoft YaHei', 'theme.eastAsiaFont', 100)
  };
  let totalElements = 0;
  let totalChars = 0;
  let charts = 0;
  let images = 0;
  const slides = safeArray(source.slides, 'slides', MAX_SLIDES).map((entry, slideIndex) => {
    const slide = assertPlainObject(entry, `slides[${slideIndex}]`);
    const layout = slide.layout || (slideIndex === 0 ? 'title' : 'content');
    if (!['title', 'content'].includes(layout)) throw new PowerPointPptxError('invalid-layout', `slides[${slideIndex}].layout 不受支持。`);
    const elements = safeArray(slide.elements, `slides[${slideIndex}].elements`, MAX_ELEMENTS_PER_SLIDE).map((element, elementIndex) => normalizeElement(element, `slides[${slideIndex}].elements[${elementIndex}]`));
    totalElements += elements.length;
    charts += elements.filter((element) => element.kind === 'chart').length;
    images += elements.filter((element) => element.kind === 'image').length;
    const title = boundedText(slide.title, `slides[${slideIndex}].title`, 500, { optional: true });
    const subtitle = boundedText(slide.subtitle, `slides[${slideIndex}].subtitle`, 1_000, { optional: true });
    const notes = boundedText(slide.notes, `slides[${slideIndex}].notes`, 20_000, { optional: true });
    totalChars += title.length + subtitle.length + notes.length + JSON.stringify(elements).length;
    return {
      layout,
      title,
      subtitle,
      notes,
      background: normalizeHex(slide.background, `slides[${slideIndex}].background`, theme.light),
      elements
    };
  });
  if (slides.length === 0) throw new PowerPointPptxError('invalid-spec', 'slides 不能为空。');
  if (totalElements > MAX_TOTAL_ELEMENTS || totalChars > MAX_TEXT_CHARS || charts > MAX_CHARTS || images > MAX_IMAGES) throw new PowerPointPptxError('invalid-spec', '演示文稿超过元素、文本、图表或图片上限。');
  return {
    title: boundedText(source.title || slides[0].title || 'DSH Desktop Presentation', 'title', 300),
    author: boundedText(source.author || 'DSH Desktop', 'author', 200),
    subject: boundedText(source.subject, 'subject', 500, { optional: true }),
    theme,
    slides,
    totalElements,
    charts,
    images
  };
};

const materializeImages = async (workspace, spec) => {
  let totalBytes = 0;
  let count = 0;
  const slides = [];
  for (const slide of spec.slides) {
    const elements = [];
    for (const element of slide.elements) {
      if (element.kind !== 'image') { elements.push(element); continue; }
      count += 1;
      const sourcePath = resolveWorkspacePath(workspace, element.path, '图片文件');
      await assertNoReparsePath(workspace, sourcePath);
      const info = await fsp.stat(sourcePath);
      if (!info.isFile() || info.size <= 0 || info.size > MAX_IMAGE_BYTES) throw new PowerPointPptxError('invalid-image', `图片必须是小于 ${MAX_IMAGE_BYTES} 字节的普通文件。`);
      totalBytes += info.size;
      if (totalBytes > MAX_TOTAL_IMAGE_BYTES) throw new PowerPointPptxError('invalid-image', `图片总大小不能超过 ${MAX_TOTAL_IMAGE_BYTES} 字节。`);
      const data = await fsp.readFile(sourcePath);
      let metadata;
      try { metadata = imageMetadata(data); }
      catch (error) { throw new PowerPointPptxError('invalid-image', error.message); }
      elements.push({ ...element, media: { ...metadata, data } });
    }
    slides.push({ ...slide, elements });
  }
  return { ...spec, slides };
};

const colorXml = (hex) => `<a:solidFill><a:srgbClr val="${hex}"/></a:solidFill>`;
const lineXml = (hex, width = 12_700) => hex ? `<a:ln w="${width}">${colorXml(hex)}<a:prstDash val="solid"/></a:ln>` : '<a:ln><a:noFill/></a:ln>';
const xfrmXml = ({ x, y, w, h }) => `<a:xfrm><a:off x="${emu(x)}" y="${emu(y)}"/><a:ext cx="${emu(w)}" cy="${emu(h)}"/></a:xfrm>`;

const paragraphXml = (text, style, theme) => {
  const latin = style.font || theme.font;
  const eastAsia = style.eastAsiaFont || theme.eastAsiaFont;
  const alignment = { left: 'l', center: 'ctr', right: 'r' }[style.align];
  return String(text).split(/\r?\n/).map((line) => `<a:p><a:pPr algn="${alignment}"/><a:r><a:rPr lang="zh-CN" altLang="en-US" sz="${Math.round(style.fontSize * 100)}" b="${style.bold ? 1 : 0}" dirty="0">${colorXml(style.color)}<a:latin typeface="${xmlEscape(latin)}"/><a:ea typeface="${xmlEscape(eastAsia)}"/></a:rPr><a:t>${xmlEscape(line)}</a:t></a:r><a:endParaRPr lang="zh-CN" sz="${Math.round(style.fontSize * 100)}"/></a:p>`).join('');
};

const textShapeXml = ({ id, name, box, text, style, theme, fill = '', line = '', margin = 0.08, preset = 'rect', txBox = true }) => {
  const anchor = { top: 't', middle: 'ctr', bottom: 'b' }[style.valign];
  const spPr = `<p:spPr>${xfrmXml(box)}<a:prstGeom prst="${preset}"><a:avLst/></a:prstGeom>${fill ? colorXml(fill) : '<a:noFill/>'}${lineXml(line)}</p:spPr>`;
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${xmlEscape(name)}"/><p:cNvSpPr${txBox ? ' txBox="1"' : ''}/><p:nvPr/></p:nvSpPr>${spPr}<p:txBody><a:bodyPr wrap="square" lIns="${emu(margin)}" tIns="${emu(margin)}" rIns="${emu(margin)}" bIns="${emu(margin)}" anchor="${anchor}"/><a:lstStyle/>${paragraphXml(text, style, theme)}</p:txBody></p:sp>`;
};

const tableCellXml = (text, rowIndex, fontSize, theme) => {
  const fill = rowIndex === 0 ? theme.accent : (rowIndex % 2 === 0 ? 'F0F4F7' : 'FFFFFF');
  const style = { fontSize, color: rowIndex === 0 ? 'FFFFFF' : theme.dark, bold: rowIndex === 0, align: 'left', valign: 'middle', font: theme.font, eastAsiaFont: theme.eastAsiaFont };
  const border = `<a:lnL w="12700">${colorXml('D5DEE5')}<a:prstDash val="solid"/></a:lnL><a:lnR w="12700">${colorXml('D5DEE5')}<a:prstDash val="solid"/></a:lnR><a:lnT w="12700">${colorXml('D5DEE5')}<a:prstDash val="solid"/></a:lnT><a:lnB w="12700">${colorXml('D5DEE5')}<a:prstDash val="solid"/></a:lnB>`;
  return `<a:tc><a:txBody><a:bodyPr anchor="ctr"/><a:lstStyle/>${paragraphXml(text, style, theme)}</a:txBody><a:tcPr marL="91440" marR="91440" marT="45720" marB="45720">${border}${colorXml(fill)}</a:tcPr></a:tc>`;
};

const tableXml = (element, id, theme) => {
  const sum = element.widths.reduce((total, value) => total + value, 0);
  const widths = element.widths.map((value) => Math.round(emu(element.w) * value / sum));
  const rowHeight = Math.round(emu(element.h) / element.rows.length);
  return `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="Table ${id}"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="${emu(element.x)}" y="${emu(element.y)}"/><a:ext cx="${emu(element.w)}" cy="${emu(element.h)}"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="${element.header ? 1 : 0}" bandRow="1"><a:tableStyleId>{5940675A-B579-460E-94D1-54222C63F5DA}</a:tableStyleId></a:tblPr><a:tblGrid>${widths.map((width) => `<a:gridCol w="${width}"/>`).join('')}</a:tblGrid>${element.rows.map((row, rowIndex) => `<a:tr h="${rowHeight}">${row.map((cell) => tableCellXml(cell, element.header ? rowIndex : 1, element.fontSize, theme)).join('')}</a:tr>`).join('')}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
};

const stringCacheXml = (values) => `<c:strCache><c:ptCount val="${values.length}"/>${values.map((value, index) => `<c:pt idx="${index}"><c:v>${xmlEscape(value)}</c:v></c:pt>`).join('')}</c:strCache>`;
const numberCacheXml = (values) => `<c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${values.length}"/>${values.map((value, index) => `<c:pt idx="${index}"><c:v>${value}</c:v></c:pt>`).join('')}</c:numCache>`;

const seriesXml = (element, series, seriesIndex, categoryColumn, valueColumn, theme) => {
  const endRow = element.categories.length + 1;
  const color = [theme.accent, theme.accent2, 'E69F00', '009E73', 'CC79A7', '56B4E9'][seriesIndex];
  return `<c:ser><c:idx val="${seriesIndex}"/><c:order val="${seriesIndex}"/><c:tx><c:strRef><c:f>'Data'!$${valueColumn}$1</c:f>${stringCacheXml([series.name])}</c:strRef></c:tx><c:spPr>${colorXml(color)}${lineXml(color, 25_400)}</c:spPr><c:cat><c:strRef><c:f>'Data'!$${categoryColumn}$2:$${categoryColumn}$${endRow}</c:f>${stringCacheXml(element.categories)}</c:strRef></c:cat><c:val><c:numRef><c:f>'Data'!$${valueColumn}$2:$${valueColumn}$${endRow}</c:f>${numberCacheXml(series.values)}</c:numRef></c:val></c:ser>`;
};

const chartXml = (element, chartIndex, theme) => {
  const columns = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const series = element.series.map((entry, index) => seriesXml(element, entry, index, 'A', columns[index + 1], theme)).join('');
  const catAxis = 48_610_000 + (chartIndex * 10);
  const valAxis = catAxis + 1;
  let plot;
  if (element.type === 'pie') {
    plot = `<c:pieChart><c:varyColors val="1"/>${series}<c:firstSliceAng val="0"/></c:pieChart>`;
  } else if (element.type === 'line') {
    plot = `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${series}<c:marker val="1"/><c:smooth val="0"/><c:axId val="${catAxis}"/><c:axId val="${valAxis}"/></c:lineChart>`;
  } else {
    plot = `<c:barChart><c:barDir val="${element.type === 'bar' ? 'bar' : 'col'}"/><c:grouping val="clustered"/><c:varyColors val="0"/>${series}<c:gapWidth val="120"/><c:axId val="${catAxis}"/><c:axId val="${valAxis}"/></c:barChart>`;
  }
  const axes = element.type === 'pie' ? '' : `<c:catAx><c:axId val="${catAxis}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="${element.type === 'bar' ? 'l' : 'b'}"/><c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="${valAxis}"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx><c:valAx><c:axId val="${valAxis}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="${element.type === 'bar' ? 'b' : 'l'}"/><c:majorGridlines/><c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="${catAxis}"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><c:date1904 val="0"/><c:lang val="zh-CN"/><c:roundedCorners val="0"/><c:chart><c:autoTitleDeleted val="1"/><c:plotArea><c:layout/>${plot}${axes}</c:plotArea><c:legend><c:legendPos val="b"/><c:layout/><c:overlay val="0"/></c:legend><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/><c:showDLblsOverMax val="0"/></c:chart><c:externalData r:id="rId1"><c:autoUpdate val="0"/></c:externalData></c:chartSpace>`;
};

const embeddedWorkbook = (element) => {
  const rows = [
    ['Category', ...element.series.map((series) => series.name)],
    ...element.categories.map((category, categoryIndex) => [category, ...element.series.map((series) => series.values[categoryIndex])])
  ];
  const spec = normalizeWorkbookSpec({ title: 'PowerPoint chart data', sheets: [{ name: 'Data', rows, autoFilter: `A1:${String.fromCharCode(65 + element.series.length)}${rows.length}`, freeze: { rows: 1, columns: 1 } }] });
  return createZip(workbookEntries(spec));
};

const chartFrameXml = (element, id, relationshipId) => `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="Chart ${id}"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="${emu(element.x)}" y="${emu(element.y)}"/><a:ext cx="${emu(element.w)}" cy="${emu(element.h)}"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="${relationshipId}"/></a:graphicData></a:graphic></p:graphicFrame>`;

const imageXml = (element, id, relationshipId) => {
  const requestedRatio = element.w / element.h;
  const nativeRatio = element.media.width / element.media.height;
  let w = element.w;
  let h = element.h;
  let x = element.x;
  let y = element.y;
  if (nativeRatio > requestedRatio) {
    h = element.w / nativeRatio;
    y += (element.h - h) / 2;
  } else {
    w = element.h * nativeRatio;
    x += (element.w - w) / 2;
  }
  const box = { x, y, w, h };
  return `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="Image ${id}" descr="${xmlEscape(element.alt)}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${relationshipId}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrmXml(box)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></p:spPr></p:pic>`;
};

const spTreeRoot = (children) => `<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${children}</p:spTree>`;

const slideEntries = (spec) => {
  const entries = [];
  let globalMedia = 0;
  let globalChart = 0;
  spec.slides.forEach((slide, slideIndex) => {
    let nextId = 2;
    let nextRel = 3;
    const children = [];
    const relationships = [
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout${slide.layout === 'title' ? 1 : 2}.xml"/>`,
      `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide${slideIndex + 1}.xml"/>`
    ];
    if (slide.title) children.push(textShapeXml({ id: nextId++, name: 'Title', box: { x: 0.7, y: slide.layout === 'title' ? 1.45 : 0.42, w: 11.9, h: slide.layout === 'title' ? 1.05 : 0.62 }, text: slide.title, style: normalizeTextStyle({}, 'title', { fontSize: slide.layout === 'title' ? 36 : 28, color: spec.theme.dark, bold: true, align: slide.layout === 'title' ? 'center' : 'left', valign: 'middle', font: spec.theme.font, eastAsiaFont: spec.theme.eastAsiaFont }), theme: spec.theme, margin: 0.02 }));
    if (slide.subtitle) children.push(textShapeXml({ id: nextId++, name: 'Subtitle', box: { x: 1.2, y: slide.layout === 'title' ? 2.75 : 1.08, w: 10.9, h: slide.layout === 'title' ? 0.8 : 0.5 }, text: slide.subtitle, style: normalizeTextStyle({}, 'subtitle', { fontSize: slide.layout === 'title' ? 21 : 16, color: spec.theme.muted, align: slide.layout === 'title' ? 'center' : 'left', valign: 'middle', font: spec.theme.font, eastAsiaFont: spec.theme.eastAsiaFont }), theme: spec.theme, margin: 0.02 }));
    for (const element of slide.elements) {
      if (element.kind === 'text') children.push(textShapeXml({ id: nextId++, name: `Text ${nextId}`, box: element, text: element.text, style: { ...element.style, font: element.style.font || spec.theme.font, eastAsiaFont: element.style.eastAsiaFont || spec.theme.eastAsiaFont }, theme: spec.theme, fill: element.fill, line: element.line, margin: element.margin }));
      else if (element.kind === 'shape') children.push(textShapeXml({ id: nextId++, name: `Shape ${nextId}`, box: element, text: element.text, style: { ...element.style, font: element.style.font || spec.theme.font, eastAsiaFont: element.style.eastAsiaFont || spec.theme.eastAsiaFont }, theme: spec.theme, fill: element.fill, line: element.line, margin: 0.08, preset: element.shape, txBox: false }));
      else if (element.kind === 'table') children.push(tableXml(element, nextId++, spec.theme));
      else if (element.kind === 'image') {
        globalMedia += 1;
        const relId = `rId${nextRel++}`;
        const fileName = `image${globalMedia}.${element.media.extension}`;
        relationships.push(`<Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${fileName}"/>`);
        children.push(imageXml(element, nextId++, relId));
        entries.push({ name: `ppt/media/${fileName}`, data: element.media.data });
      } else if (element.kind === 'chart') {
        globalChart += 1;
        const relId = `rId${nextRel++}`;
        relationships.push(`<Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart${globalChart}.xml"/>`);
        children.push(chartFrameXml(element, nextId++, relId));
        entries.push({ name: `ppt/charts/chart${globalChart}.xml`, data: chartXml(element, globalChart, spec.theme) });
        entries.push({ name: `ppt/charts/_rels/chart${globalChart}.xml.rels`, data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/package" Target="../embeddings/Microsoft_Excel_Worksheet${globalChart}.xlsx"/></Relationships>` });
        entries.push({ name: `ppt/embeddings/Microsoft_Excel_Worksheet${globalChart}.xlsx`, data: embeddedWorkbook(element) });
      }
    }
    children.push(textShapeXml({ id: nextId++, name: 'Slide number', box: { x: 11.9, y: 7.08, w: 0.7, h: 0.24 }, text: String(slideIndex + 1), style: normalizeTextStyle({}, 'slide-number', { fontSize: 9, color: spec.theme.muted, align: 'right', valign: 'middle', font: spec.theme.font, eastAsiaFont: spec.theme.eastAsiaFont }), theme: spec.theme, margin: 0 }));
    const slideXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld name="Slide ${slideIndex + 1}"><p:bg><p:bgPr>${colorXml(slide.background)}<a:effectLst/></p:bgPr></p:bg>${spTreeRoot(children.join(''))}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
    entries.push({ name: `ppt/slides/slide${slideIndex + 1}.xml`, data: slideXml });
    entries.push({ name: `ppt/slides/_rels/slide${slideIndex + 1}.xml.rels`, data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships.join('')}</Relationships>` });
    entries.push({ name: `ppt/notesSlides/notesSlide${slideIndex + 1}.xml`, data: notesSlideXml(slide.notes, slideIndex + 1, spec.theme) });
    entries.push({ name: `ppt/notesSlides/_rels/notesSlide${slideIndex + 1}.xml.rels`, data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster" Target="../notesMasters/notesMaster1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="../slides/slide${slideIndex + 1}.xml"/></Relationships>` });
  });
  return entries;
};

const themeXml = (theme) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="${xmlEscape(theme.name)}"><a:themeElements><a:clrScheme name="${xmlEscape(theme.name)}"><a:dk1><a:srgbClr val="${theme.dark}"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="33475B"/></a:dk2><a:lt2><a:srgbClr val="${theme.light}"/></a:lt2><a:accent1><a:srgbClr val="${theme.accent}"/></a:accent1><a:accent2><a:srgbClr val="${theme.accent2}"/></a:accent2><a:accent3><a:srgbClr val="E69F00"/></a:accent3><a:accent4><a:srgbClr val="009E73"/></a:accent4><a:accent5><a:srgbClr val="CC79A7"/></a:accent5><a:accent6><a:srgbClr val="56B4E9"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fontScheme name="${xmlEscape(theme.name)}"><a:majorFont><a:latin typeface="${xmlEscape(theme.font)}"/><a:ea typeface="${xmlEscape(theme.eastAsiaFont)}"/><a:cs typeface="Arial"/></a:majorFont><a:minorFont><a:latin typeface="${xmlEscape(theme.font)}"/><a:ea typeface="${xmlEscape(theme.eastAsiaFont)}"/><a:cs typeface="Arial"/></a:minorFont></a:fontScheme><a:fmtScheme name="${xmlEscape(theme.name)}"><a:fillStyleLst>${colorXml(theme.accent)}${colorXml(theme.accent2)}<a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"><a:tint val="50000"/><a:satMod val="300000"/></a:schemeClr></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"><a:shade val="50000"/><a:satMod val="200000"/></a:schemeClr></a:gs></a:gsLst><a:lin ang="16200000" scaled="1"/></a:gradFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"><a:tint val="95000"/><a:satMod val="170000"/></a:schemeClr></a:solidFill><a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"><a:tint val="93000"/><a:satMod val="150000"/></a:schemeClr></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"><a:shade val="98000"/><a:satMod val="130000"/></a:schemeClr></a:gs></a:gsLst><a:lin ang="16200000" scaled="1"/></a:gradFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`;

const masterShapeTree = () => spTreeRoot('');
const textStyleList = (theme, size) => `<a:lvl1pPr marL="0" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:defRPr sz="${size}" kern="1200">${colorXml(theme.dark)}<a:latin typeface="${xmlEscape(theme.font)}"/><a:ea typeface="${xmlEscape(theme.eastAsiaFont)}"/></a:defRPr></a:lvl1pPr>`;

const slideMasterXml = (theme) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld name="DSH Master">${masterShapeTree()}</p:cSld><p:clrMap accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" bg1="lt1" bg2="lt2" folHlink="folHlink" hlink="hlink" tx1="dk1" tx2="dk2"/><p:sldLayoutIdLst><p:sldLayoutId id="1" r:id="rId1"/><p:sldLayoutId id="2" r:id="rId2"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle>${textStyleList(theme, 3200)}</p:titleStyle><p:bodyStyle>${textStyleList(theme, 1800)}</p:bodyStyle><p:otherStyle>${textStyleList(theme, 1400)}</p:otherStyle></p:txStyles></p:sldMaster>`;

const slideLayoutXml = (name, type) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="${type}" preserve="1" matchingName="${name}"><p:cSld name="${name}">${masterShapeTree()}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;

const notesMasterXml = (theme) => {
  const style = { fontSize: 12, color: theme.dark, bold: false, align: 'left', valign: 'top', font: theme.font, eastAsiaFont: theme.eastAsiaFont };
  const body = textShapeXml({ id: 2, name: 'Notes Body', box: { x: 0.6, y: 4.2, w: 6.3, h: 4.6 }, text: '', style, theme, margin: 0.05 }).replace('<p:nvPr/>', '<p:nvPr><p:ph type="body" idx="1"/></p:nvPr>');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:notesMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld name="Notes Master">${spTreeRoot(body)}</p:cSld><p:clrMap accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" bg1="lt1" bg2="lt2" folHlink="folHlink" hlink="hlink" tx1="dk1" tx2="dk2"/><p:hf hdr="1" ftr="1" dt="1" sldNum="1"/><p:notesStyle>${textStyleList(theme, 1200)}</p:notesStyle></p:notesMaster>`;
};

function notesSlideXml(notes, slideNumber, theme) {
  const style = { fontSize: 12, color: theme.dark, bold: false, align: 'left', valign: 'top', font: theme.font, eastAsiaFont: theme.eastAsiaFont };
  const body = textShapeXml({ id: 2, name: 'Notes Body', box: { x: 0.6, y: 4.2, w: 6.3, h: 4.6 }, text: notes || '', style, theme, margin: 0.05 }).replace('<p:nvPr/>', '<p:nvPr><p:ph type="body" idx="1"/></p:nvPr>');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:notes xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld name="Notes ${slideNumber}">${spTreeRoot(body)}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`;
}

const presentationEntries = (spec) => {
  const slides = slideEntries(spec);
  const created = new Date().toISOString();
  const slideOverrides = spec.slides.map((_, index) => `<Override PartName="/ppt/slides/slide${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/><Override PartName="/ppt/notesSlides/notesSlide${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>`).join('');
  const chartOverrides = Array.from({ length: spec.charts }, (_, index) => `<Override PartName="/ppt/charts/chart${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`).join('');
  const imageDefaults = [...new Map(spec.slides.flatMap((slide) => slide.elements.filter((element) => element.kind === 'image').map((element) => [element.media.extension, element.media.contentType])))]
    .map(([extension, contentType]) => `<Default Extension="${extension}" ContentType="${contentType}"/>`).join('');
  const presentationRelationships = [
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>',
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster" Target="notesMasters/notesMaster1.xml"/>',
    ...spec.slides.map((_, index) => `<Relationship Id="rId${index + 3}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${index + 1}.xml"/>`)
  ];
  const presentationXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" saveSubsetFonts="1" autoCompressPictures="0"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:notesMasterIdLst><p:notesMasterId r:id="rId2"/></p:notesMasterIdLst><p:sldIdLst>${spec.slides.map((_, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 3}"/>`).join('')}</p:sldIdLst><p:sldSz cx="${SLIDE_CX}" cy="${SLIDE_CY}" type="screen16x9"/><p:notesSz cx="6858000" cy="9144000"/><p:defaultTextStyle>${textStyleList(spec.theme, 1800)}</p:defaultTextStyle></p:presentation>`;
  return [
    { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="xlsx" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"/>${imageDefaults}<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/slideLayouts/slideLayout2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/notesMasters/notesMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>${slideOverrides}${chartOverrides}</Types>` },
    { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>' },
    { name: 'docProps/core.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlEscape(spec.title)}</dc:title><dc:subject>${xmlEscape(spec.subject)}</dc:subject><dc:creator>${xmlEscape(spec.author)}</dc:creator><cp:lastModifiedBy>${xmlEscape(spec.author)}</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${created}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${created}</dcterms:modified></cp:coreProperties>` },
    { name: 'docProps/app.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>DSH Desktop PowerPoint PPTX Tool</Application><PresentationFormat>On-screen Show (16:9)</PresentationFormat><Slides>${spec.slides.length}</Slides><Notes>${spec.slides.length}</Notes><AppVersion>16.0000</AppVersion></Properties>` },
    { name: 'ppt/presentation.xml', data: presentationXml },
    { name: 'ppt/_rels/presentation.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${presentationRelationships.join('')}</Relationships>` },
    { name: 'ppt/theme/theme1.xml', data: themeXml(spec.theme) },
    { name: 'ppt/slideMasters/slideMaster1.xml', data: slideMasterXml(spec.theme) },
    { name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>' },
    { name: 'ppt/slideLayouts/slideLayout1.xml', data: slideLayoutXml('Title', 'title') },
    { name: 'ppt/slideLayouts/slideLayout2.xml', data: slideLayoutXml('Content', 'obj') },
    { name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>' },
    { name: 'ppt/slideLayouts/_rels/slideLayout2.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>' },
    { name: 'ppt/notesMasters/notesMaster1.xml', data: notesMasterXml(spec.theme) },
    { name: 'ppt/notesMasters/_rels/notesMaster1.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>' },
    ...slides
  ];
};

const readPresentationZip = (buffer) => {
  try { return readZip(buffer); }
  catch (error) { throw new PowerPointPptxError('invalid-pptx', `PPTX ZIP 无效：${String(error?.message || error).replaceAll('DOCX', 'PPTX')}`); }
};

const inspectEntries = (entries) => {
  for (const name of REQUIRED_ENTRIES) if (!entries.has(name)) throw new PowerPointPptxError('invalid-pptx', `PPTX 缺少必需条目：${name}`);
  const slideNames = [...entries.keys()].filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).sort((left, right) => Number(left.match(/\d+/)[0]) - Number(right.match(/\d+/)[0]));
  if (slideNames.length === 0 || slideNames.length > MAX_SLIDES) throw new PowerPointPptxError('invalid-pptx', 'PPTX 幻灯片数量无效。');
  let shapes = 0;
  let textRuns = 0;
  let tables = 0;
  let charts = 0;
  let images = 0;
  let textCharacters = 0;
  for (const name of slideNames) {
    const xml = entries.get(name).toString('utf8');
    if (!/<p:sld\b/.test(xml) || !/<p:spTree\b/.test(xml)) throw new PowerPointPptxError('invalid-pptx', `幻灯片结构无效：${name}`);
    shapes += (xml.match(/<p:sp\b/g) || []).length;
    textRuns += (xml.match(/<a:t(?:\s|>)/g) || []).length;
    tables += (xml.match(/<a:tbl\b/g) || []).length;
    charts += (xml.match(/<c:chart\b/g) || []).length;
    images += (xml.match(/<p:pic\b/g) || []).length;
    textCharacters += [...xml.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)].reduce((sum, match) => sum + xmlUnescape(match[1]).length, 0);
  }
  const notes = [...entries.keys()].filter((name) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(name)).length;
  const masters = [...entries.keys()].filter((name) => /^ppt\/slideMasters\/slideMaster\d+\.xml$/.test(name)).length;
  const layouts = [...entries.keys()].filter((name) => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(name)).length;
  const notesMasters = [...entries.keys()].filter((name) => /^ppt\/notesMasters\/notesMaster\d+\.xml$/.test(name)).length;
  const embeddedWorkbooks = [...entries.keys()].filter((name) => /^ppt\/embeddings\/.*\.xlsx$/i.test(name)).length;
  const externalRelationships = [...entries.entries()].filter(([name, data]) => {
    if (!name.endsWith('.rels')) return false;
    const xml = data.toString('utf8');
    return /TargetMode\s*=\s*["']External["']/i.test(xml)
      || /Target\s*=\s*["'](?:[A-Za-z][A-Za-z0-9+.-]*:|\\\\|\/\/)/i.test(xml);
  }).length;
  const macros = [...entries.keys()].filter((name) => /vbaProject\.bin$/i.test(name)).length;
  const oleObjects = [...entries.keys()].filter((name) => /(^|\/)oleObjects\//i.test(name)).length;
  const activeX = [...entries.keys()].filter((name) => /(^|\/)activeX\//i.test(name)).length;
  const externalLinks = [...entries.keys()].filter((name) => /(^|\/)externalLinks\//i.test(name)).length;
  return { valid: true, entries: entries.size, slides: slideNames.length, shapes, textRuns, textCharacters, tables, charts, images, notes, masters, layouts, notesMasters, embeddedWorkbooks, externalRelationships, externalLinks, macros, oleObjects, activeX };
};

const assertStrictInspection = (inspection) => {
  if (inspection.masters < 1 || inspection.layouts < 2 || inspection.notesMasters < 1 || inspection.notes !== inspection.slides || inspection.charts !== inspection.embeddedWorkbooks || inspection.externalRelationships || inspection.externalLinks || inspection.macros || inspection.oleObjects || inspection.activeX) {
    throw new PowerPointPptxError('strict-validation-failed', `严格检查失败：母版 ${inspection.masters}，版式 ${inspection.layouts}，备注母版 ${inspection.notesMasters}，备注 ${inspection.notes}/${inspection.slides}，图表/数据 ${inspection.charts}/${inspection.embeddedWorkbooks}，外部关系 ${inspection.externalRelationships}，外链 ${inspection.externalLinks}，宏 ${inspection.macros}，OLE ${inspection.oleObjects}，ActiveX ${inspection.activeX}。`);
  }
};

const replaceTextInEntries = (entries, rawSpec) => {
  const source = assertPlainObject(rawSpec, '替换规格');
  const replacements = safeArray(source.replacements, 'replacements', 200).map((entry, index) => {
    const item = assertPlainObject(entry, `replacements[${index}]`);
    const find = boundedText(item.find, `replacements[${index}].find`, 4_000);
    const replace = boundedText(item.replace, `replacements[${index}].replace`, 10_000);
    if (!find) throw new PowerPointPptxError('invalid-spec', `replacements[${index}].find 不能为空。`);
    return { find, replace };
  });
  if (replacements.length === 0 || new Set(replacements.map((item) => item.find)).size !== replacements.length) throw new PowerPointPptxError('invalid-spec', 'replacements 必须非空且 find 不能重复。');
  const counts = Object.fromEntries(replacements.map((item) => [item.find, 0]));
  const targetNames = [...entries.keys()].filter((name) => /^ppt\/(?:slides\/slide|notesSlides\/notesSlide)\d+\.xml$/.test(name));
  const changes = new Map();
  for (const name of targetNames) {
    const original = entries.get(name).toString('utf8');
    const updated = original.replace(/<a:t(\s[^>]*)?>([\s\S]*?)<\/a:t>/g, (full, attributes = '', encoded) => {
      let text = xmlUnescape(encoded);
      for (const item of replacements) {
        const parts = text.split(item.find);
        if (parts.length > 1) { counts[item.find] += parts.length - 1; text = parts.join(item.replace); }
      }
      return `<a:t${attributes}>${xmlEscape(text)}</a:t>`;
    });
    changes.set(name, Buffer.from(updated, 'utf8'));
  }
  const missing = replacements.filter((item) => counts[item.find] === 0).map((item) => item.find);
  if (missing.length > 0) throw new PowerPointPptxError('text-not-found', `未找到待替换文本：${missing.join('、')}`);
  for (const [name, data] of changes) entries.set(name, data);
  return { counts };
};

const atomicWrite = async (outputPath, buffer, { overwrite = false } = {}) => {
  await fsp.mkdir(path.dirname(outputPath), { recursive: true });
  let existed = false;
  try {
    const existing = await fsp.lstat(outputPath);
    if (!existing.isFile()) throw new PowerPointPptxError('invalid-output', '输出路径已存在且不是普通文件。');
    if (!overwrite) throw new PowerPointPptxError('output-exists', '输出文件已存在；如确认覆盖，请使用 --overwrite。');
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
    assertStrictInspection(inspectEntries(readPresentationZip(await fsp.readFile(temporary))));
    if (process.platform === 'win32' && existed) await fsp.rm(outputPath);
    await fsp.rename(temporary, outputPath);
  } catch (error) {
    await fsp.rm(temporary, { force: true }).catch(() => {});
    if (backup && !fs.existsSync(outputPath)) await fsp.copyFile(backup, outputPath).catch(() => {});
    throw error;
  }
  return backup;
};

const createPresentation = async ({ workspace, specPath, outputPath, overwrite = false }) => {
  const root = resolveWorkspace(workspace);
  const specFile = resolveWorkspacePath(root, specPath, '规格文件', '.json');
  const output = resolveWorkspacePath(root, outputPath, '输出文件', '.pptx');
  await Promise.all([assertNoReparsePath(root, specFile), assertNoReparsePath(root, output)]);
  const materialized = await materializeImages(root, normalizeSpec(await readBoundedJson(specFile)));
  const buffer = createZip(presentationEntries(materialized));
  const backup = await atomicWrite(output, buffer, { overwrite });
  return { operation: 'create', output, bytes: buffer.length, backup, ...inspectEntries(readPresentationZip(buffer)) };
};

const replacePresentationText = async ({ workspace, inputPath, specPath, outputPath, overwrite = false }) => {
  const root = resolveWorkspace(workspace);
  const input = resolveWorkspacePath(root, inputPath, '输入文件', '.pptx');
  const specFile = resolveWorkspacePath(root, specPath, '规格文件', '.json');
  const output = resolveWorkspacePath(root, outputPath, '输出文件', '.pptx');
  await Promise.all([assertNoReparsePath(root, input), assertNoReparsePath(root, specFile), assertNoReparsePath(root, output)]);
  const info = await fsp.stat(input);
  if (!info.isFile() || info.size <= 0 || info.size > MAX_PPTX_BYTES) throw new PowerPointPptxError('invalid-pptx', `输入 PPTX 必须小于 ${MAX_PPTX_BYTES} 字节。`);
  const entries = readPresentationZip(await fsp.readFile(input));
  assertStrictInspection(inspectEntries(entries));
  const replacement = replaceTextInEntries(entries, await readBoundedJson(specFile));
  const buffer = createZip([...entries].map(([name, data]) => ({ name, data })));
  const backup = await atomicWrite(output, buffer, { overwrite });
  return { operation: 'replace-text', input, output, bytes: buffer.length, backup, replacements: replacement.counts, ...inspectEntries(readPresentationZip(buffer)) };
};

const inspectPresentation = async ({ workspace, inputPath, strict = false }) => {
  const root = resolveWorkspace(workspace);
  const input = resolveWorkspacePath(root, inputPath, '输入文件', '.pptx');
  await assertNoReparsePath(root, input);
  const info = await fsp.stat(input);
  if (!info.isFile() || info.size <= 0 || info.size > MAX_PPTX_BYTES) throw new PowerPointPptxError('invalid-pptx', `输入 PPTX 必须小于 ${MAX_PPTX_BYTES} 字节。`);
  const inspection = inspectEntries(readPresentationZip(await fsp.readFile(input)));
  if (strict) assertStrictInspection(inspection);
  return { operation: 'inspect', input, bytes: info.size, strict, ...inspection };
};

const parseArgs = (args) => {
  const values = { _: [] };
  const flags = new Set(['overwrite', 'strict']);
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith('--')) { values._.push(token); continue; }
    const name = token.slice(2);
    if (flags.has(name)) { values[name] = true; continue; }
    if (index + 1 >= args.length) throw new PowerPointPptxError('invalid-arguments', `参数 --${name} 缺少值。`);
    values[name] = args[index += 1];
  }
  return values;
};

const usage = () => [
  'DSH Desktop PowerPoint PPTX Tool',
  'create --spec <spec.json> --output <file.pptx> [--workspace <dir>] [--overwrite]',
  'replace-text --input <file.pptx> --spec <replacements.json> --output <file.pptx> [--workspace <dir>] [--overwrite]',
  'inspect --input <file.pptx> [--strict] [--workspace <dir>]'
].join('\n');

const main = async (argv = process.argv.slice(2)) => {
  const args = parseArgs(argv);
  const command = args._[0];
  let result;
  if (command === 'create') result = await createPresentation({ workspace: args.workspace, specPath: args.spec, outputPath: args.output, overwrite: args.overwrite });
  else if (command === 'replace-text') result = await replacePresentationText({ workspace: args.workspace, inputPath: args.input, specPath: args.spec, outputPath: args.output, overwrite: args.overwrite });
  else if (command === 'inspect') result = await inspectPresentation({ workspace: args.workspace, inputPath: args.input, strict: args.strict });
  else throw new PowerPointPptxError('invalid-arguments', usage());
  process.stdout.write(`${JSON.stringify({ ok: true, ...result }, null, 2)}\n`);
  return result;
};

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({ ok: false, code: error?.code || 'powerpoint-pptx-failed', error: error?.message || String(error) })}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  MAX_CHARTS,
  MAX_ELEMENTS_PER_SLIDE,
  MAX_IMAGES,
  MAX_PPTX_BYTES,
  MAX_SLIDES,
  MAX_TOTAL_ELEMENTS,
  PowerPointPptxError,
  REQUIRED_ENTRIES,
  createPresentation,
  inspectEntries,
  inspectPresentation,
  normalizeSpec,
  presentationEntries,
  replacePresentationText,
  replaceTextInEntries
};
