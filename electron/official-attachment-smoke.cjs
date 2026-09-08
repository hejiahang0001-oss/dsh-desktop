const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { buildChinesePdfSmoke } = require('./pdf-smoke-document.cjs');

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const pendingRail = '[role="group"][aria-label="待发送附件"], [role="group"][aria-label="Pending attachments"]';

async function verifyStoredOfficeCopies({ files, harnessHome, workspacePath, word, excel }) {
  const inspected = [];
  for (const file of files) {
    const sha256 = digest(file.bytes);
    const stored = path.join(harnessHome, 'attachments', 'v1', 'files', sha256.slice(0, 2), sha256, file.name);
    const bytes = await fsp.readFile(stored);
    if (digest(bytes) !== sha256) throw new Error(`Official attachment bytes changed: ${file.name}`);
    const copy = path.join(workspacePath, `official-copy-${file.name}`);
    await fsp.copyFile(stored, copy, fs.constants.COPYFILE_EXCL);
    const inspect = file.name.endsWith('.xlsx') ? excel.inspectWorkbook : file.name.endsWith('.docx') ? word.inspectDocument : null;
    if (inspect) {
      let outsideRejected = false;
      try { await inspect({ workspace: workspacePath, inputPath: stored, strict: true }); }
      catch (error) { if (error.code !== 'outside-workspace') throw error; outsideRejected = true; }
      if (!outsideRejected) throw new Error('Office input unexpectedly escaped the workspace boundary');
      const result = await inspect({ workspace: workspacePath, inputPath: copy, strict: true });
      const structureValid = file.name.endsWith('.xlsx') ? result.sheetCount > 0 : result.valid === true;
      if (!structureValid || result.safety?.passed !== true) throw new Error(`Strict Office inspection failed: ${file.name}`);
      inspected.push({ name: file.name, sha256, strict: true, outsideRejected });
    } else if (!bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new Error('PDF attachment signature changed');
    if (digest(await fsp.readFile(copy)) !== sha256 || digest(await fsp.readFile(stored)) !== sha256
      || digest(await fsp.readFile(file.path)) !== sha256) throw new Error(`Attachment copy changed an original: ${file.name}`);
  }
  return inspected;
}

async function runOfficialAttachmentSmoke({ window, BrowserWindow, nativeImage, runtime, smokeRoot, workspacePath, selected, origin, api, evaluate, waitFor, target }) {
  const wc = window.webContents, checks = {};
  const word = require(runtime.docxToolPath), excel = require(runtime.xlsxToolPath);
  const pdf = await buildChinesePdfSmoke(BrowserWindow);
  const fixtures = [
    ['官方表格.xlsx', word.createZip(excel.workbookEntries(excel.normalizeSpec({ sheets: [{ name: '数据', rows: [['项目', '金额'], ['测试', 123]] }] })))],
    ['官方文档.docx', word.createZip(word.documentEntries(word.normalizeSpec({ title: '官方附件验证', sections: [{ kind: 'paragraph', text: '这是隔离测试文件。' }] })))],
    ['官方资料.pdf', pdf.pdf]
  ];
  const sourceDirectory = await fsp.mkdtemp(path.join(smokeRoot, 'official-attachment-fixtures-'));
  const files = [];
  for (const [name, bytes] of fixtures) {
    const file = path.join(sourceDirectory, name); await fsp.writeFile(file, bytes, { flag: 'wx' });
    files.push({ name, bytes, path: file });
  }
  const imagePath = path.join(sourceDirectory, '官方混拖图片.png');
  const imageBytes = nativeImage.createFromBitmap(Buffer.from([0, 0, 255, 255]), { width: 1, height: 1 }).toPNG();
  await fsp.writeFile(imagePath, imageBytes, { flag: 'wx' });
  const rail = () => `document.querySelector(${JSON.stringify(pendingRail)})`;
  const readyFile = (name) => `(()=>{const card=Array.from(${rail()}?.querySelectorAll('[title]')||[]).find(el=>el.title===${JSON.stringify(name)});return Boolean(card)&&!/上传中|上传失败|Uploading|Upload failed/.test(card.textContent)})()`;
  const drop = async (paths, screenshot = false) => {
    const point = await evaluate('(()=>{const r=document.querySelector("[data-composer-card]").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()');
    const data = { items: [], files: paths, dragOperationsMask: 1 };
    for (const type of ['dragEnter', 'dragOver']) await wc.debugger.sendCommand('Input.dispatchDragEvent', { type, ...point, data });
    await waitFor('Array.from(document.querySelectorAll("[role=status]")).some(el=>/文件或图片拖动到此处即可添加|Drag files or images here/.test(el.textContent))');
    if (!await evaluate('!document.querySelector(".dsh-document-drop-hint")')) throw new Error('A second desktop drag overlay is still mounted');
    if (screenshot) {
      await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      await fsp.writeFile(`${target}.official-drag.png`, (await wc.capturePage()).toPNG());
    }
    await wc.debugger.sendCommand('Input.dispatchDragEvent', { type: 'drop', ...point, data });
    await waitFor('!Array.from(document.querySelectorAll("[role=status]")).some(el=>/文件或图片拖动到此处即可添加|Drag files or images here/.test(el.textContent))');
  };
  await drop(files.map((file) => file.path), true);
  for (const file of files) await waitFor(readyFile(file.name));
  checks.threeOfficialFilesReady = await evaluate(`${rail()}?.children.length === 3`);
  checks.noWorkspaceReferenceFromDrop = !await evaluate('window.__DSH_COMPOSER_TEXT__.read().includes("参考资料")');
  await evaluate(`Array.from(${rail()}.querySelectorAll('button')).find(b=>['移除文件 官方文档.docx','Remove file 官方文档.docx'].includes(b.getAttribute('aria-label'))).click()`);
  await waitFor(`${rail()}?.children.length === 2`);
  checks.removeKeepsOtherFiles = await evaluate(`${readyFile(files[0].name)} && ${readyFile(files[2].name)}`);
  await drop([files[1].path, imagePath]);
  await waitFor(`${rail()}?.children.length === 4 && ${rail()}?.querySelectorAll('img').length === 1`);
  await waitFor(readyFile(files[1].name));
  checks.mixedFileAndImageDrop = true;
  await fsp.writeFile(`${target}.official-mixed.png`, (await wc.capturePage()).toPNG());

  const otherPath = path.join(smokeRoot, 'official-other-workspace'); await fsp.mkdir(otherPath, { recursive: true });
  const other = await api(origin, 'workspace.create', { path: otherPath });
  await api(origin, 'session.create', { workspaceId: other.workspace.workspaceId });
  const openWorkspace = async (label) => {
    const row = `Array.from(document.querySelectorAll('[role=treeitem][aria-expanded]')).find(row=>Array.from(row.querySelectorAll('span')).some(span=>span.textContent===${JSON.stringify(label)}))`;
    await waitFor(`Boolean(${row})`);
    await evaluate(`Array.from((${row}).querySelectorAll('button')).at(-1).click()`);
  };
  await openWorkspace(path.basename(otherPath));
  await waitFor(`JSON.parse(localStorage.getItem('dsh.sessions.current')||'{}').sessionId !== ${JSON.stringify(selected.sessionId)}`);
  checks.otherSessionEmpty = await evaluate(`!${rail()}`);
  await openWorkspace(path.basename(workspacePath));
  await waitFor(`JSON.parse(localStorage.getItem('dsh.sessions.current')||'{}').sessionId === ${JSON.stringify(selected.sessionId)}`);
  await waitFor(`${rail()}?.children.length === 4`);
  checks.switchRestoresExactAttachments = await evaluate(`${rail()}?.querySelector('img')?.alt === '官方混拖图片.png'`);
  for (const file of files) await waitFor(readyFile(file.name));
  // Image submission needs a vision model; this keyless smoke verifies mixed intake only.
  await evaluate(`Array.from(${rail()}.querySelectorAll('button')).find(b=>['移除图片 官方混拖图片.png','Remove image 官方混拖图片.png'].includes(b.getAttribute('aria-label'))).click()`);
  await waitFor(`${rail()}?.children.length === 3`);
  const inspected = await verifyStoredOfficeCopies({ files, harnessHome: path.join(smokeRoot, 'harness'), workspacePath, word, excel });
  checks.strictOfficeCopies = inspected.length === 2;
  checks.originalFilesUnchanged = files.every((file) => digest(fs.readFileSync(file.path)) === digest(file.bytes))
    && digest(await fsp.readFile(imagePath)) === digest(imageBytes);
  checks.onlyOfficialDropFeedback = true;
  checks.threePageChinesePdf = pdf.pages === 3 && pdf.embeddedFonts;
  if (!Object.values(checks).every(Boolean)) throw new Error(`Official attachment checks failed: ${JSON.stringify(checks)}`);
  return { ok: true, checks, inspected, formats: ['xlsx', 'docx', 'pdf'], image: 'png',
    evidence: 'Electron CDP disk-file drag, official uploads and immutable stored bytes, session switch, strict workspace copies; no model call',
    unverified: ['in-flight upload cancellation and retry', 'vision model submission', 'attachment persistence across app restart'] };
}

module.exports = { runOfficialAttachmentSmoke, verifyStoredOfficeCopies };
