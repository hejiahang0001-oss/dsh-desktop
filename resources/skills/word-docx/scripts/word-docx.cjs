#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const zlib = require('node:zlib');

const MAX_SPEC_BYTES = 2 * 1024 * 1024;
const MAX_DOCX_BYTES = 64 * 1024 * 1024;
const MAX_ENTRY_BYTES = 24 * 1024 * 1024;
const MAX_TOTAL_UNCOMPRESSED_BYTES = 96 * 1024 * 1024;
const MAX_ENTRIES = 256;
const MAX_TEXT_CHARS = 500_000;
const MAX_SECTIONS = 100;
const MAX_TABLE_ROWS = 500;
const MAX_TABLE_COLUMNS = 30;
const MAX_IMAGES = 24;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 32 * 1024 * 1024;
const REQUIRED_ENTRIES = Object.freeze([
  '[Content_Types].xml',
  '_rels/.rels',
  'word/document.xml',
  'word/styles.xml'
]);

class WordDocxError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'WordDocxError';
    this.code = code;
  }
}

const xmlEscape = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&apos;');

const xmlUnescape = (value) => String(value ?? '')
  .replaceAll('&lt;', '<')
  .replaceAll('&gt;', '>')
  .replaceAll('&quot;', '"')
  .replaceAll('&apos;', "'")
  .replaceAll('&amp;', '&');

const assertPlainObject = (value, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new WordDocxError('invalid-spec', `${label} 必须是对象。`);
  }
  return value;
};

const boundedText = (value, label, max = 20_000, { optional = false } = {}) => {
  if (optional && (value === undefined || value === null || value === '')) return '';
  if (typeof value !== 'string') throw new WordDocxError('invalid-spec', `${label} 必须是文本。`);
  if (value.length > max) throw new WordDocxError('invalid-spec', `${label} 超过 ${max} 个字符。`);
  return value;
};

const safeArray = (value, label, max) => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > max) {
    throw new WordDocxError('invalid-spec', `${label} 必须是最多 ${max} 项的数组。`);
  }
  return value;
};

const isWithin = (root, target) => {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

const resolveWorkspacePath = (workspace, candidate, label, extension = '') => {
  if (typeof candidate !== 'string' || candidate.trim() === '') {
    throw new WordDocxError('invalid-path', `${label} 不能为空。`);
  }
  const resolved = path.resolve(workspace, candidate);
  if (!isWithin(workspace, resolved)) throw new WordDocxError('outside-workspace', `${label} 必须位于当前工作区内。`);
  if (extension && path.extname(resolved).toLowerCase() !== extension) {
    throw new WordDocxError('invalid-path', `${label} 必须使用 ${extension} 扩展名。`);
  }
  return resolved;
};

const assertNoReparsePath = async (workspace, target) => {
  let current = target;
  while (isWithin(workspace, current)) {
    try {
      const info = await fsp.lstat(current);
      if (info.isSymbolicLink()) throw new WordDocxError('reparse-path', `拒绝通过符号链接或重解析点写入：${current}`);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    if (current === workspace) break;
    current = path.dirname(current);
  }
};

const readBoundedJson = async (filePath) => {
  const info = await fsp.stat(filePath);
  if (!info.isFile() || info.size <= 0 || info.size > MAX_SPEC_BYTES) {
    throw new WordDocxError('invalid-spec', `JSON 规格文件必须小于 ${MAX_SPEC_BYTES} 字节。`);
  }
  let value;
  try { value = JSON.parse(await fsp.readFile(filePath, 'utf8')); } catch (error) {
    throw new WordDocxError('invalid-spec', `JSON 规格解析失败：${error.message}`);
  }
  return assertPlainObject(value, 'JSON 规格');
};

const buildCrcTable = () => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    table[index] = value >>> 0;
  }
  return table;
};

const CRC_TABLE = buildCrcTable();
const crc32 = (buffer) => {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};

const dosTimestamp = (date = new Date()) => {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  };
};

const createZip = (entries) => {
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > MAX_ENTRIES) {
    throw new WordDocxError('invalid-archive', 'DOCX ZIP 条目数量无效。');
  }
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const timestamp = dosTimestamp();
  const names = new Set();
  for (const entry of entries) {
    const name = String(entry.name || '').replaceAll('\\', '/');
    if (!name || name.startsWith('/') || name.includes('../') || names.has(name)) {
      throw new WordDocxError('invalid-archive', `DOCX ZIP 条目名称无效：${name}`);
    }
    names.add(name);
    const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data ?? ''), 'utf8');
    if (raw.length > MAX_ENTRY_BYTES) throw new WordDocxError('invalid-archive', `DOCX ZIP 条目过大：${name}`);
    const compressed = zlib.deflateRawSync(raw, { level: 9 });
    const nameBuffer = Buffer.from(name, 'utf8');
    const crc = crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(timestamp.time, 10);
    local.writeUInt16LE(timestamp.date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, nameBuffer, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(timestamp.time, 12);
    central.writeUInt16LE(timestamp.date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBuffer);
    offset += local.length + nameBuffer.length + compressed.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, end]);
};

const findEndOfCentralDirectory = (buffer) => {
  const lower = Math.max(0, buffer.length - 65557);
  for (let offset = buffer.length - 22; offset >= lower; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw new WordDocxError('invalid-archive', '找不到 DOCX ZIP 中央目录。');
};

const readZip = (buffer) => {
  if (!Buffer.isBuffer(buffer) || buffer.length <= 0 || buffer.length > MAX_DOCX_BYTES) {
    throw new WordDocxError('invalid-archive', `DOCX 必须小于 ${MAX_DOCX_BYTES} 字节。`);
  }
  const endOffset = findEndOfCentralDirectory(buffer);
  const count = buffer.readUInt16LE(endOffset + 10);
  const centralOffset = buffer.readUInt32LE(endOffset + 16);
  if (count === 0 || count > MAX_ENTRIES || centralOffset >= endOffset) {
    throw new WordDocxError('invalid-archive', 'DOCX ZIP 中央目录无效。');
  }
  let preflightCursor = centralOffset;
  let totalRawSize = 0;
  for (let index = 0; index < count; index += 1) {
    if (preflightCursor + 46 > endOffset || buffer.readUInt32LE(preflightCursor) !== 0x02014b50) {
      throw new WordDocxError('invalid-archive', 'DOCX ZIP 条目头无效。');
    }
    const rawSize = buffer.readUInt32LE(preflightCursor + 24);
    const nameLength = buffer.readUInt16LE(preflightCursor + 28);
    const extraLength = buffer.readUInt16LE(preflightCursor + 30);
    const commentLength = buffer.readUInt16LE(preflightCursor + 32);
    if (rawSize > MAX_ENTRY_BYTES) throw new WordDocxError('invalid-archive', 'DOCX ZIP 单个条目过大。');
    totalRawSize += rawSize;
    if (totalRawSize > MAX_TOTAL_UNCOMPRESSED_BYTES) {
      throw new WordDocxError('invalid-archive', `DOCX ZIP 解压后总大小超过 ${MAX_TOTAL_UNCOMPRESSED_BYTES} 字节。`);
    }
    preflightCursor += 46 + nameLength + extraLength + commentLength;
    if (preflightCursor > endOffset) throw new WordDocxError('invalid-archive', 'DOCX ZIP 中央目录条目越界。');
  }
  const entries = new Map();
  let cursor = centralOffset;
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > endOffset || buffer.readUInt32LE(cursor) !== 0x02014b50) {
      throw new WordDocxError('invalid-archive', 'DOCX ZIP 条目头无效。');
    }
    const flags = buffer.readUInt16LE(cursor + 8);
    const method = buffer.readUInt16LE(cursor + 10);
    const crc = buffer.readUInt32LE(cursor + 16);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const rawSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString((flags & 0x0800) ? 'utf8' : 'latin1').replaceAll('\\', '/');
    if (!name || name.startsWith('/') || name.includes('../') || entries.has(name) || rawSize > MAX_ENTRY_BYTES || ![0, 8].includes(method)) {
      throw new WordDocxError('invalid-archive', `DOCX ZIP 条目不受支持：${name}`);
    }
    if (localOffset + 30 > centralOffset || buffer.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new WordDocxError('invalid-archive', `DOCX ZIP 本地条目无效：${name}`);
    }
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    if (dataOffset + compressedSize > centralOffset) throw new WordDocxError('invalid-archive', `DOCX ZIP 条目越界：${name}`);
    const compressed = buffer.subarray(dataOffset, dataOffset + compressedSize);
    let data;
    try {
      data = method === 0 ? Buffer.from(compressed) : zlib.inflateRawSync(compressed, { maxOutputLength: MAX_ENTRY_BYTES });
    } catch (error) {
      throw new WordDocxError('invalid-archive', `DOCX ZIP 条目解压失败：${name}：${error.message}`);
    }
    if (data.length !== rawSize || crc32(data) !== crc) throw new WordDocxError('invalid-archive', `DOCX ZIP 条目校验失败：${name}`);
    entries.set(name, data);
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
};

const paragraphXml = (text, { style = '', bold = false, italic = false, size = 22, color = '', align = '', numbering } = {}) => {
  const value = boundedText(text, '段落', 20_000);
  const pPr = [
    style ? `<w:pStyle w:val="${xmlEscape(style)}"/>` : '',
    align ? `<w:jc w:val="${xmlEscape(align)}"/>` : '',
    numbering ? `<w:numPr><w:ilvl w:val="${numbering.level || 0}"/><w:numId w:val="${numbering.id || 1}"/></w:numPr>` : ''
  ].join('');
  const preserve = /^\s|\s$|\s{2}/.test(value) ? ' xml:space="preserve"' : '';
  const rPr = [bold ? '<w:b/>' : '', italic ? '<w:i/>' : '', size ? `<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>` : '', color ? `<w:color w:val="${color}"/>` : ''].join('');
  return `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}<w:t${preserve}>${xmlEscape(value)}</w:t></w:r></w:p>`;
};

const tableXml = (table) => {
  const source = assertPlainObject(table, '表格');
  const rows = safeArray(source.rows, '表格 rows', MAX_TABLE_ROWS);
  if (rows.length === 0) throw new WordDocxError('invalid-spec', '表格 rows 不能为空。');
  const normalized = rows.map((row, rowIndex) => {
    if (!Array.isArray(row) || row.length === 0 || row.length > MAX_TABLE_COLUMNS) {
      throw new WordDocxError('invalid-spec', `表格第 ${rowIndex + 1} 行列数无效。`);
    }
    return row.map((cell, columnIndex) => boundedText(cell, `表格 ${rowIndex + 1}/${columnIndex + 1}`, 4_000));
  });
  const columns = normalized[0].length;
  if (normalized.some((row) => row.length !== columns)) throw new WordDocxError('invalid-spec', '表格每行列数必须一致。');
  const widths = Array.isArray(source.widths) && source.widths.length === columns
    ? source.widths.map((width) => Math.max(500, Math.min(9000, Number(width) || 0)))
    : Array(columns).fill(Math.floor(9000 / columns));
  const grid = widths.map((width) => `<w:gridCol w:w="${width}"/>`).join('');
  const body = normalized.map((row, rowIndex) => `<w:tr>${row.map((cell, columnIndex) => `<w:tc><w:tcPr><w:tcW w:w="${widths[columnIndex]}" w:type="dxa"/><w:shd w:fill="${rowIndex === 0 ? 'EAF0F8' : 'FFFFFF'}"/></w:tcPr>${paragraphXml(cell, { bold: rowIndex === 0, size: 20 })}</w:tc>`).join('')}</w:tr>`).join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders><w:top w:val="single" w:sz="4" w:color="AAB5C4"/><w:left w:val="single" w:sz="4" w:color="AAB5C4"/><w:bottom w:val="single" w:sz="4" w:color="AAB5C4"/><w:right w:val="single" w:sz="4" w:color="AAB5C4"/><w:insideH w:val="single" w:sz="4" w:color="D6DCE5"/><w:insideV w:val="single" w:sz="4" w:color="D6DCE5"/></w:tblBorders></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${body}</w:tbl>`;
};

const imageMetadata = (buffer) => {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0 || buffer.length > MAX_IMAGE_BYTES) {
    throw new WordDocxError('invalid-image', `图片必须小于 ${MAX_IMAGE_BYTES} 字节。`);
  }
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buffer.length >= 24 && buffer.subarray(0, 8).equals(pngSignature)) {
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    if (width > 0 && height > 0 && width <= 20_000 && height <= 20_000 && width * height <= 100_000_000) {
      return { extension: 'png', contentType: 'image/png', width, height };
    }
    throw new WordDocxError('invalid-image', 'PNG 图片尺寸无效或超限。');
  }
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    const startOfFrame = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
    while (offset + 4 <= buffer.length) {
      while (offset < buffer.length && buffer[offset] === 0xff) offset += 1;
      if (offset >= buffer.length) break;
      const marker = buffer[offset];
      offset += 1;
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > buffer.length) break;
      const length = buffer.readUInt16BE(offset);
      if (length < 2 || offset + length > buffer.length) break;
      if (startOfFrame.has(marker) && length >= 7) {
        const height = buffer.readUInt16BE(offset + 3);
        const width = buffer.readUInt16BE(offset + 5);
        if (width > 0 && height > 0 && width <= 20_000 && height <= 20_000 && width * height <= 100_000_000) {
          return { extension: 'jpg', contentType: 'image/jpeg', width, height };
        }
        throw new WordDocxError('invalid-image', 'JPEG 图片尺寸无效或超限。');
      }
      offset += length;
    }
    throw new WordDocxError('invalid-image', 'JPEG 图片缺少受支持的尺寸信息。');
  }
  throw new WordDocxError('invalid-image', '本版本仅支持真实 PNG 或 JPEG 图片。');
};

const imageXml = ({ relId, drawingId, width, height, widthInches, alt }) => {
  const cx = Math.round(widthInches * 914_400);
  const cy = Math.max(1, Math.round(cx * height / width));
  const name = `DSH Word image ${drawingId}`;
  return `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="${drawingId}" name="${xmlEscape(name)}" descr="${xmlEscape(alt)}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${drawingId}" name="${xmlEscape(name)}" descr="${xmlEscape(alt)}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
};

const normalizeSpec = (raw) => {
  const source = assertPlainObject(raw, 'DOCX 规格');
  const title = boundedText(source.title, 'title', 300);
  const subtitle = boundedText(source.subtitle, 'subtitle', 500, { optional: true });
  const author = boundedText(source.author || 'DSH Desktop', 'author', 200);
  const language = source.language === 'en-US' ? 'en-US' : 'zh-CN';
  const sections = safeArray(source.sections, 'sections', MAX_SECTIONS).map((section, index) => {
    const item = assertPlainObject(section, `sections[${index}]`);
    const kind = item.kind || 'paragraph';
    if (!['heading', 'paragraph', 'bullets', 'numbered', 'table', 'image', 'pageBreak'].includes(kind)) {
      throw new WordDocxError('invalid-spec', `sections[${index}].kind 不受支持。`);
    }
    if (kind === 'table') return { kind, table: item.table || item };
    if (kind === 'image') {
      const sourcePath = boundedText(item.path, `sections[${index}].path`, 1_000);
      const alt = boundedText(item.alt || path.basename(sourcePath), `sections[${index}].alt`, 500);
      const requestedWidth = Number(item.widthInches ?? 5.5);
      if (!Number.isFinite(requestedWidth) || requestedWidth < 1 || requestedWidth > 6.5) {
        throw new WordDocxError('invalid-spec', `sections[${index}].widthInches 必须在 1–6.5 之间。`);
      }
      return { kind, path: sourcePath, alt, widthInches: requestedWidth };
    }
    if (kind === 'pageBreak') return { kind };
    if (kind === 'bullets' || kind === 'numbered') return { kind, items: safeArray(item.items, `sections[${index}].items`, 200).map((value, itemIndex) => boundedText(value, `sections[${index}].items[${itemIndex}]`, 10_000)) };
    return { kind, text: boundedText(item.text, `sections[${index}].text`, 20_000), level: Math.max(1, Math.min(3, Number(item.level) || 1)) };
  });
  const header = boundedText(source.header, 'header', 300, { optional: true });
  const footer = boundedText(source.footer || '由 DSH Desktop 生成', 'footer', 300, { optional: true });
  const totalChars = title.length + subtitle.length + header.length + footer.length + JSON.stringify(sections).length;
  if (totalChars > MAX_TEXT_CHARS) throw new WordDocxError('invalid-spec', `文档内容超过 ${MAX_TEXT_CHARS} 个字符。`);
  return { title, subtitle, author, language, sections, header, footer };
};

const materializeImages = async (workspace, spec) => {
  let totalBytes = 0;
  let count = 0;
  const sections = [];
  for (const section of spec.sections) {
    if (section.kind !== 'image') {
      sections.push(section);
      continue;
    }
    count += 1;
    if (count > MAX_IMAGES) throw new WordDocxError('invalid-spec', `图片不能超过 ${MAX_IMAGES} 张。`);
    const sourcePath = resolveWorkspacePath(workspace, section.path, '图片文件');
    await assertNoReparsePath(workspace, sourcePath);
    const info = await fsp.stat(sourcePath);
    if (!info.isFile() || info.size <= 0 || info.size > MAX_IMAGE_BYTES) {
      throw new WordDocxError('invalid-image', `图片必须是小于 ${MAX_IMAGE_BYTES} 字节的普通文件。`);
    }
    totalBytes += info.size;
    if (totalBytes > MAX_TOTAL_IMAGE_BYTES) throw new WordDocxError('invalid-image', `图片总大小不能超过 ${MAX_TOTAL_IMAGE_BYTES} 字节。`);
    const data = await fsp.readFile(sourcePath);
    sections.push({ ...section, media: { ...imageMetadata(data), data } });
  }
  return { ...spec, sections };
};

const buildDocumentEntries = (spec) => {
  const mediaEntries = [];
  for (const section of spec.sections) {
    if (section.kind !== 'image') continue;
    if (!section.media?.data) throw new WordDocxError('invalid-image', '图片必须通过工作区安全读取后再生成 DOCX。');
    const drawingId = mediaEntries.length + 1;
    mediaEntries.push({
      ...section.media,
      alt: section.alt,
      widthInches: section.widthInches,
      drawingId,
      relId: `rId${9 + drawingId}`,
      fileName: `image${drawingId}.${section.media.extension}`
    });
  }
  const body = [];
  body.push(paragraphXml(spec.title, { style: 'Title', bold: true, size: 36, color: '17365D', align: 'center' }));
  if (spec.subtitle) body.push(paragraphXml(spec.subtitle, { style: 'Subtitle', italic: true, size: 22, color: '526477', align: 'center' }));
  body.push(paragraphXml(''));
  let imageIndex = 0;
  for (const section of spec.sections) {
    if (section.kind === 'heading') body.push(paragraphXml(section.text, { style: `Heading${section.level}`, bold: true, size: section.level === 1 ? 28 : section.level === 2 ? 24 : 22, color: '17365D' }));
    else if (section.kind === 'paragraph') body.push(paragraphXml(section.text, { size: 22 }));
    else if (section.kind === 'bullets') for (const item of section.items) body.push(paragraphXml(item, { size: 22, numbering: { id: 1 } }));
    else if (section.kind === 'numbered') for (const item of section.items) body.push(paragraphXml(item, { size: 22, numbering: { id: 2 } }));
    else if (section.kind === 'table') body.push(tableXml(section.table));
    else if (section.kind === 'image') body.push(imageXml(mediaEntries[imageIndex++]));
    else body.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
  }
  const created = new Date().toISOString();
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${body.join('')}<w:sectPr><w:headerReference w:type="default" r:id="rId3"/><w:footerReference w:type="default" r:id="rId4"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Aptos" w:eastAsia="微软雅黑" w:hAnsi="Aptos"/><w:sz w:val="22"/><w:lang w:val="${spec.language}" w:eastAsia="${spec.language}"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="360" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:qFormat/></w:style><w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:qFormat/></w:style>${[1, 2, 3].map((level) => `<w:style w:type="paragraph" w:styleId="Heading${level}"><w:name w:val="heading ${level}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:outlineLvl w:val="${level - 1}"/></w:pPr></w:style>`).join('')}</w:styles>`;
  const numberingXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="720"/></w:tabs><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum><w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="720"/></w:tabs><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>`;
  const headerXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${paragraphXml(spec.header || spec.title, { size: 18, color: '6B7785', align: 'right' })}</w:hdr>`;
  const footerXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${paragraphXml(spec.footer, { size: 18, color: '6B7785', align: 'center' })}</w:ftr>`;
  const imageDefaults = [...new Map(mediaEntries.map((entry) => [entry.extension, entry.contentType]))]
    .map(([extension, contentType]) => `<Default Extension="${extension}" ContentType="${contentType}"/>`).join('');
  const imageRelationships = mediaEntries.map((entry) => `<Relationship Id="${entry.relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${entry.fileName}"/>`).join('');
  return [
    { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${imageDefaults}<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>` },
    { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>` },
    { name: 'docProps/core.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlEscape(spec.title)}</dc:title><dc:creator>${xmlEscape(spec.author)}</dc:creator><cp:lastModifiedBy>${xmlEscape(spec.author)}</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${created}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${created}</dcterms:modified></cp:coreProperties>` },
    { name: 'docProps/app.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>DSH Desktop Word DOCX Tool</Application><AppVersion>16.0000</AppVersion></Properties>' },
    { name: 'word/document.xml', data: documentXml },
    { name: 'word/styles.xml', data: stylesXml },
    { name: 'word/settings.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:zoom w:percent="100"/><w:defaultTabStop w:val="720"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/><w:compatSetting w:name="overrideTableStyleFontSizeAndJustification" w:uri="http://schemas.microsoft.com/office/word" w:val="1"/><w:compatSetting w:name="enableOpenTypeFeatures" w:uri="http://schemas.microsoft.com/office/word" w:val="1"/><w:compatSetting w:name="doNotFlipMirrorIndents" w:uri="http://schemas.microsoft.com/office/word" w:val="1"/></w:compat><w:themeFontLang w:val="${spec.language}" w:eastAsia="${spec.language}"/></w:settings>` },
    { name: 'word/numbering.xml', data: numberingXml },
    { name: 'word/header1.xml', data: headerXml },
    { name: 'word/footer1.xml', data: footerXml },
    { name: 'word/_rels/document.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/><Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>${imageRelationships}</Relationships>` },
    ...mediaEntries.map((entry) => ({ name: `word/media/${entry.fileName}`, data: entry.data }))
  ];
};

const documentEntries = (rawSpec) => buildDocumentEntries(normalizeSpec(rawSpec));

const inspectEntries = (entries) => {
  for (const name of REQUIRED_ENTRIES) if (!entries.has(name)) throw new WordDocxError('invalid-docx', `DOCX 缺少必需条目：${name}`);
  const documentXml = entries.get('word/document.xml').toString('utf8');
  if (!documentXml.includes('<w:document') || !documentXml.includes('<w:body')) throw new WordDocxError('invalid-docx', 'word/document.xml 结构无效。');
  const text = [...documentXml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map((match) => xmlUnescape(match[1])).join('');
  return {
    valid: true,
    entries: entries.size,
    textCharacters: text.length,
    paragraphs: (documentXml.match(/<w:p(?:\s|>)/g) || []).length,
    tables: (documentXml.match(/<w:tbl(?:\s|>)/g) || []).length,
    images: (documentXml.match(/<a:blip\s+r:embed=/g) || []).length,
    title: text.slice(0, 200)
  };
};

const replaceTextInEntries = (entries, rawSpec) => {
  const source = assertPlainObject(rawSpec, '替换规格');
  const replacements = safeArray(source.replacements, 'replacements', 200).map((replacement, index) => {
    const item = assertPlainObject(replacement, `replacements[${index}]`);
    const find = boundedText(item.find, `replacements[${index}].find`, 4_000);
    const replace = boundedText(item.replace, `replacements[${index}].replace`, 20_000);
    if (!find) throw new WordDocxError('invalid-spec', `replacements[${index}].find 不能为空。`);
    return { find, replace };
  });
  if (replacements.length === 0) throw new WordDocxError('invalid-spec', 'replacements 不能为空。');
  if (new Set(replacements.map((item) => item.find)).size !== replacements.length) {
    throw new WordDocxError('invalid-spec', 'replacements.find 不能重复。');
  }
  const original = entries.get('word/document.xml').toString('utf8');
  const counts = Object.fromEntries(replacements.map((item) => [item.find, 0]));
  const updated = original.replace(/<w:t(\s[^>]*)?>([\s\S]*?)<\/w:t>/g, (full, attributes = '', encoded) => {
    let text = xmlUnescape(encoded);
    for (const item of replacements) {
      const parts = text.split(item.find);
      if (parts.length > 1) {
        counts[item.find] += parts.length - 1;
        text = parts.join(item.replace);
      }
    }
    const preserve = /^\s|\s$|\s{2}/.test(text) && !/xml:space=/.test(attributes) ? `${attributes} xml:space="preserve"` : attributes;
    return `<w:t${preserve}>${xmlEscape(text)}</w:t>`;
  });
  const missing = replacements.filter((item) => counts[item.find] === 0).map((item) => item.find);
  if (missing.length > 0) throw new WordDocxError('text-not-found', `未找到待替换文本：${missing.join('、')}`);
  entries.set('word/document.xml', Buffer.from(updated, 'utf8'));
  return { counts };
};

const atomicWrite = async (outputPath, buffer, { overwrite = false } = {}) => {
  await fsp.mkdir(path.dirname(outputPath), { recursive: true });
  let existed = false;
  try {
    const existing = await fsp.lstat(outputPath);
    if (!existing.isFile()) throw new WordDocxError('invalid-output', '输出路径已存在且不是普通文件。');
    if (!overwrite) throw new WordDocxError('output-exists', '输出文件已存在；如确认覆盖，请使用 --overwrite。');
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
    const entries = readZip(await fsp.readFile(temporary));
    inspectEntries(entries);
    if (process.platform === 'win32' && existed) await fsp.rm(outputPath);
    await fsp.rename(temporary, outputPath);
  } catch (error) {
    await fsp.rm(temporary, { force: true }).catch(() => {});
    if (backup && !fs.existsSync(outputPath)) await fsp.copyFile(backup, outputPath).catch(() => {});
    throw error;
  }
  return backup;
};

const parseArgs = (args) => {
  const values = { _: [] };
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith('--')) { values._.push(token); continue; }
    const name = token.slice(2);
    if (name === 'overwrite' || name === 'json') { values[name] = true; continue; }
    if (index + 1 >= args.length) throw new WordDocxError('invalid-arguments', `参数 --${name} 缺少值。`);
    values[name] = args[index += 1];
  }
  return values;
};

const resolveWorkspace = (value) => path.resolve(value || process.env.DSH_CWD || process.cwd());

const createDocument = async ({ workspace, specPath, outputPath, overwrite = false }) => {
  const root = resolveWorkspace(workspace);
  const spec = resolveWorkspacePath(root, specPath, '规格文件', '.json');
  const output = resolveWorkspacePath(root, outputPath, '输出文件', '.docx');
  await assertNoReparsePath(root, spec);
  await assertNoReparsePath(root, output);
  const normalized = normalizeSpec(await readBoundedJson(spec));
  const materialized = await materializeImages(root, normalized);
  const buffer = createZip(buildDocumentEntries(materialized));
  const backup = await atomicWrite(output, buffer, { overwrite });
  return { operation: 'create', output, bytes: buffer.length, backup, ...inspectEntries(readZip(buffer)) };
};

const replaceDocumentText = async ({ workspace, inputPath, specPath, outputPath, overwrite = false }) => {
  const root = resolveWorkspace(workspace);
  const input = resolveWorkspacePath(root, inputPath, '输入文件', '.docx');
  const spec = resolveWorkspacePath(root, specPath, '规格文件', '.json');
  const output = resolveWorkspacePath(root, outputPath, '输出文件', '.docx');
  await assertNoReparsePath(root, input);
  await assertNoReparsePath(root, spec);
  await assertNoReparsePath(root, output);
  const inputInfo = await fsp.stat(input);
  if (!inputInfo.isFile() || inputInfo.size <= 0 || inputInfo.size > MAX_DOCX_BYTES) throw new WordDocxError('invalid-docx', '输入 DOCX 大小无效。');
  const entries = readZip(await fsp.readFile(input));
  inspectEntries(entries);
  const replacement = replaceTextInEntries(entries, await readBoundedJson(spec));
  const buffer = createZip([...entries].map(([name, data]) => ({ name, data })));
  const backup = await atomicWrite(output, buffer, { overwrite });
  return { operation: 'replace-text', input, output, bytes: buffer.length, backup, replacements: replacement.counts, ...inspectEntries(readZip(buffer)) };
};

const inspectDocument = async ({ workspace, inputPath }) => {
  const root = resolveWorkspace(workspace);
  const input = resolveWorkspacePath(root, inputPath, '输入文件', '.docx');
  await assertNoReparsePath(root, input);
  const inputInfo = await fsp.stat(input);
  if (!inputInfo.isFile() || inputInfo.size <= 0 || inputInfo.size > MAX_DOCX_BYTES) throw new WordDocxError('invalid-docx', '输入 DOCX 大小无效。');
  const entries = readZip(await fsp.readFile(input));
  return { operation: 'inspect', input, bytes: inputInfo.size, ...inspectEntries(entries) };
};

const usage = () => [
  'DSH Desktop Word DOCX Tool',
  'create --spec <spec.json> --output <file.docx> [--workspace <dir>] [--overwrite]',
  'replace-text --input <file.docx> --spec <replacements.json> --output <file.docx> [--workspace <dir>] [--overwrite]',
  'inspect --input <file.docx> [--workspace <dir>]'
].join('\n');

const main = async (argv = process.argv.slice(2)) => {
  const args = parseArgs(argv);
  const command = args._[0];
  let result;
  if (command === 'create') result = await createDocument({ workspace: args.workspace, specPath: args.spec, outputPath: args.output, overwrite: args.overwrite });
  else if (command === 'replace-text') result = await replaceDocumentText({ workspace: args.workspace, inputPath: args.input, specPath: args.spec, outputPath: args.output, overwrite: args.overwrite });
  else if (command === 'inspect') result = await inspectDocument({ workspace: args.workspace, inputPath: args.input });
  else throw new WordDocxError('invalid-arguments', usage());
  process.stdout.write(`${JSON.stringify({ ok: true, ...result }, null, 2)}\n`);
  return result;
};

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({ ok: false, code: error?.code || 'word-docx-failed', error: error?.message || String(error) })}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  MAX_DOCX_BYTES,
  MAX_IMAGE_BYTES,
  MAX_IMAGES,
  MAX_TOTAL_UNCOMPRESSED_BYTES,
  MAX_TOTAL_IMAGE_BYTES,
  REQUIRED_ENTRIES,
  WordDocxError,
  createDocument,
  createZip,
  documentEntries,
  inspectDocument,
  inspectEntries,
  imageMetadata,
  normalizeSpec,
  readZip,
  replaceDocumentText,
  replaceTextInEntries,
  xmlEscape
};
