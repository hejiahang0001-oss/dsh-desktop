'use strict';

const { DOMParser } = require('@xmldom/xmldom');
const path = require('node:path');
const fs = require('node:fs/promises');
const { createHash } = require('node:crypto');

const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CONTENT_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const SHEET_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const MAX_XML_NODES = 500_000;
const MAX_EXPANDED_BYTES = 96 * 1024 * 1024;
const ACTIVE = /(?:vba|macroenabled|activex|oleobject|attachedtemplate|afchunk|webextension|customui|externalLink|connections|querytable)/i;
const fail = (code, message) => Object.assign(new Error(message), { code });
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

const validPartName = (name) => typeof name === 'string' && name.length <= 1024
  && !/[\\:\u0000-\u001f\u007f%?#]/u.test(name)
  && name.split('/').every((part) => part && part !== '.' && part !== '..' && !/[. ]$/.test(part)
    && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));

const inspectPackageSafety = (entries, { readZip, inspectEmbeddedWorkbook, inspectSpreadsheetNode, depth = 0, budget = { bytes: 0 } } = {}) => {
  const issues = new Set();
  const aliases = new Set();
  const reject = (reason) => issues.add(reason);
  const mainParts = ['word/document.xml', 'xl/workbook.xml', 'ppt/presentation.xml'].filter((name) => entries.has(name));
  if (mainParts.length !== 1) reject('ambiguous-document-format');
  for (const [name, data] of entries) {
    budget.bytes += data.length;
    if (budget.bytes > MAX_EXPANDED_BYTES) { reject('expanded-size-limit'); break; }
    if (!validPartName(name) || aliases.has(name.toLowerCase())) reject('ambiguous-part-path');
    aliases.add(name.toLowerCase());
    if (ACTIVE.test(name) || /(?:^|\/)embeddings\/(?![^/]+\.xlsx$)/i.test(name)) reject('active-content');
    if (/\.xlsx$/i.test(name)) {
      if (depth !== 0 || mainParts[0] !== 'ppt/presentation.xml' || !/^ppt\/embeddings\/[^/]+\.xlsx$/i.test(name) || !readZip || !inspectEmbeddedWorkbook) reject('unsupported-embedded-package');
      else {
        try {
          const nested = readZip(data);
          if (!nested.has('xl/workbook.xml')) reject('invalid-embedded-workbook');
          const inspection = inspectPackageSafety(nested, { readZip, depth: depth + 1, budget });
          for (const issue of inspection.issues) reject(`embedded-${issue}`);
          inspectEmbeddedWorkbook(nested);
        } catch { reject('invalid-embedded-workbook'); }
      }
    }
    if (!/\.(?:xml|rels)$/i.test(name)) continue;
    let xml;
    try { xml = new TextDecoder('utf-8', { fatal: true }).decode(data); }
    catch { reject('unsupported-xml-encoding'); continue; }
    if (/[\u0000]/u.test(xml) || /<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)) { reject('xml-declaration-or-entity'); continue; }
    let document;
    try { document = new DOMParser({ onError: () => { throw new Error('invalid XML'); } }).parseFromString(xml, 'application/xml'); }
    catch { reject('invalid-xml'); continue; }
    const root = document.documentElement;
    const relationships = /\.rels$/i.test(name);
    const contentTypes = name === '[Content_Types].xml';
    if (relationships && (root.localName !== 'Relationships' || root.namespaceURI !== REL_NS)) reject('invalid-relationships');
    if (contentTypes && (root.localName !== 'Types' || root.namespaceURI !== CONTENT_NS)) reject('invalid-content-types');
    const ids = new Set();
    const stack = [root];
    let nodes = 0;
    while (stack.length) {
      const node = stack.pop();
      if (++nodes > MAX_XML_NODES) { reject('xml-node-limit'); break; }
      for (let child = node.lastChild; child; child = child.previousSibling) stack.push(child);
      if (node.nodeType !== 1) continue;
      if (relationships && node !== root) {
        if (node.parentNode !== root || node.namespaceURI !== REL_NS || node.localName !== 'Relationship') { reject('invalid-relationships'); continue; }
        const id = node.getAttribute('Id');
        const type = node.getAttribute('Type') || '';
        const target = node.getAttribute('Target') || '';
        const mode = node.getAttribute('TargetMode') || '';
        if (!id || ids.has(id) || !type || !target) reject('invalid-relationships');
        ids.add(id);
        if (mode && mode !== 'Internal') reject('external-relationship');
        if (ACTIVE.test(type)) reject('active-relationship');
        if (/[\\:\u0000-\u0020\u007f%?#]/u.test(target) || target.startsWith('//')) { reject('unsafe-relationship-target'); continue; }
        const base = name === '_rels/.rels' ? '' : path.posix.dirname(path.posix.dirname(name));
        const resolved = target.startsWith('/') ? target.slice(1) : path.posix.normalize(path.posix.join(base, target));
        if (!validPartName(resolved) || !entries.has(resolved)) reject('missing-or-outside-relationship-target');
        if (type.endsWith('/package') && !(depth === 0 && /^ppt\/embeddings\/[^/]+\.xlsx$/i.test(resolved))) reject('unsupported-embedded-package');
      }
      if (contentTypes && node !== root) {
        if (node.parentNode !== root || node.namespaceURI !== CONTENT_NS || !['Default', 'Override'].includes(node.localName)) reject('invalid-content-types');
        if (ACTIVE.test(node.getAttribute('ContentType') || '')) reject('active-content-type');
      }
      if (node.namespaceURI === SHEET_NS && inspectSpreadsheetNode) {
        try { inspectSpreadsheetNode(node); } catch { reject('unsafe-spreadsheet-content'); }
      }
      if (node.namespaceURI === WORD_NS) {
        if (['altChunk', 'object', 'control'].includes(node.localName)) reject('active-word-content');
        if (node.localName === 'instrText' || node.localName === 'fldSimple') {
          const instruction = node.localName === 'instrText' ? node.textContent : node.getAttributeNS(WORD_NS, 'instr');
          // Supported generated fields are page counters only; split or disguised instructions fail closed.
          if (!/^\s*(?:PAGE|NUMPAGES|SECTIONPAGES)(?:\s+\\\*\s+(?:MERGEFORMAT|ARABIC))?\s*$/i.test(instruction || '')) reject('unsupported-word-field');
        }
      }
    }
  }
  return { passed: issues.size === 0, issues: [...issues].sort() };
};

const assertSafeInspection = (inspection, ErrorType) => {
  if (inspection.safety?.passed) return;
  const message = `Office 安全检查未通过：${inspection.safety?.issues.join('、') || '未验证'}。原文件保持不变；请移除宏、外部链接或不支持的活动内容后另存再试。`;
  throw ErrorType ? new ErrorType('strict-validation-failed', message) : fail('strict-validation-failed', message);
};

const assertWorkspacePath = (workspace, target) => {
  const relative = path.relative(workspace, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw fail('outside-workspace', '文件必须位于当前工作区内。');
  const parts = relative.split(path.sep);
  if (parts.some((part) => /[:\u0000-\u001f\u007f]|[. ]$/u.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw fail('invalid-path', '文件路径包含不支持的 Windows 名称。');
  if (parts.some((part) => /^(?:\.env|\.credentials|credentials|secrets?|id_(?:rsa|dsa|ecdsa|ed25519))(?:\.|$)|^(?:\.npmrc|\.pypirc|\.netrc)$|\.(?:pem|key|pfx|p12)$/i.test(part))) throw fail('sensitive-path', 'Office 工具不能读取或写入凭据等敏感路径。');
};

const readReceiptFile = async (workspace, target) => {
  assertWorkspacePath(workspace, target);
  let current = workspace;
  for (const part of ['', ...path.relative(workspace, target).split(path.sep)]) {
    current = part ? path.join(current, part) : current;
    const info = await fs.lstat(current);
    if (info.isSymbolicLink() || (current !== target && !info.isDirectory())) throw fail('reparse-path', '文件或目录身份已变化；请重新检查。');
  }
  const handle = await fs.open(target, 'r');
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > MAX_EXPANDED_BYTES) throw fail('invalid-output', '交付文件大小无效。');
    const data = await handle.readFile();
    const after = await handle.stat();
    const currentInfo = await fs.lstat(target);
    if (currentInfo.isSymbolicLink() || before.ino !== currentInfo.ino || before.dev !== currentInfo.dev || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw fail('delivery-changed', '文件在校验期间变化；请重新检查，不能沿用旧结果。');
    return { path: path.relative(workspace, target).replaceAll('\\', '/'), bytes: data.length, sha256: digest(data) };
  } finally { await handle.close(); }
};

const deliveryReceipt = async (workspace, output, expected, backup = '') => {
  const file = await readReceiptFile(workspace, output);
  if (file.sha256 !== digest(expected)) throw fail('delivery-changed', '磁盘文件与已验证产物不同；已保留当前文件和回退副本，请重新检查。');
  const rollback = backup ? await readReceiptFile(workspace, backup) : null;
  return { ...file, format: path.extname(output).slice(1).toUpperCase(), validation: 'structure-and-safety', visualValidation: 'not-performed', overwritten: Boolean(backup), rollback };
};

module.exports = { validPartName, inspectPackageSafety, assertSafeInspection, assertWorkspacePath, deliveryReceipt };
