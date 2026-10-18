const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { buildChinesePdfSmoke } = require('./pdf-smoke-document.cjs');
const { isSessionId, pathKey } = require('./harness-workspace-sync.cjs');

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const pendingRail = '[role="group"][aria-label="待发送附件"], [role="group"][aria-label="Pending attachments"]';

async function switchAttachmentWorkspace({ selected, workspacePath, otherPath, origin, api, evaluate, waitFor, hoverAt }) {
  assert.ok(isSessionId(selected.sessionId));
  assert.equal(typeof hoverAt, 'function', 'Attachment navigation needs native pointer hover');
  const current = `JSON.parse(localStorage.getItem('dsh.sessions.current')||'{}').sessionId`;
  const rail = `document.querySelector(${JSON.stringify(pendingRail)})`;
  const content = id => `Array.from(document.querySelectorAll('[data-conversation-content]')).filter(el=>el.getAttribute('data-conversation-session')===${JSON.stringify(id)} && el.getClientRects().length)`;
  const verifyUniqueSession = async (directory, expected) => {
    // create is the official idempotent workspace lookup; an unexpected creation is a refusal.
    const resolved = await api(origin, 'workspace.create', { path: directory });
    assert.equal(resolved.created, false, 'Attachment workspace must already exist');
    const workspace = resolved.workspace;
    assert.equal(workspace.workspaceId, expected.workspaceId);
    assert.equal(pathKey(workspace.path), pathKey(directory));
    assert.deepEqual(workspace.sessionIds, [expected.sessionId], 'Attachment workspace must contain only the exact fixture Session');
    const list = await api(origin, 'session.list', {});
    const matches = list.items.filter(item => item.sessionId === expected.sessionId);
    assert.equal(matches.length, 1);
    assert.equal(pathKey(matches[0].cwd), pathKey(directory), 'Attachment Session cwd mismatch');
    assert.notEqual(matches[0].origin, 'subagent');
    assert.equal(matches[0].blank, true, 'Attachment fixture must remain unsent');
    assert.equal(matches[0].running, false);
    assert.ok(typeof workspace.title === 'string' && workspace.title.length > 0);
    return workspace;
  };
  const original = await verifyUniqueSession(workspacePath, selected);
  await waitFor(`${current} === ${JSON.stringify(selected.sessionId)}`);
  const originalDraft = await evaluate('window.__DSH_COMPOSER_TEXT__.read()');
  assert.equal(typeof originalDraft, 'string');
  const other = await api(origin, 'workspace.create', { path: otherPath });
  assert.equal(other.created, true, 'Other attachment workspace must be a fresh fixture');
  assert.equal(pathKey(other.workspace.path), pathKey(otherPath));
  assert.deepEqual(other.workspace.sessionIds, []);
  assert.notEqual(other.workspace.workspaceId, selected.workspaceId);
  assert.notEqual(other.workspace.title, original.title);
  // alpha2 New Session deliberately creates a fresh ID; do not pre-create or assume reuse.
  const newLabels = JSON.stringify([`在“${other.workspace.title}”中新建会话`, `New session in ${other.workspace.title}`]);
  // Official rowActions are display:none until the workspace row is actually hovered.
  const newRows = `Array.from(document.querySelectorAll('[role="treeitem"][aria-expanded]')).filter(row=>row.getClientRects().length && Array.from(row.querySelectorAll('button')).some(b=>${newLabels}.includes(b.getAttribute('aria-label'))))`;
  await waitFor(`${newRows}.length === 1`);
  const point = await evaluate(`(()=>{const row=${newRows}[0];row.scrollIntoView({block:'nearest',inline:'nearest'});const r=row.getBoundingClientRect();if(r.width<=0||r.height<=0)throw new Error('Workspace row is not visible');return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
  assert.ok(Number.isSafeInteger(point.x) && Number.isSafeInteger(point.y) && point.x >= 0 && point.y >= 0);
  await hoverAt(point);
  const newButtons = `Array.from(document.querySelectorAll('[role="treeitem"][aria-expanded] button')).filter(b=>b.getClientRects().length && ${newLabels}.includes(b.getAttribute('aria-label')))`;
  await waitFor(`${newButtons}.length === 1`);
  await evaluate(`${newButtons}[0].click()`);
  await waitFor(`typeof (${current}) === 'string' && (${current}) !== ${JSON.stringify(selected.sessionId)}`);
  const otherId = await evaluate(current); assert.ok(isSessionId(otherId));
  await verifyUniqueSession(otherPath, { workspaceId: other.workspace.workspaceId, sessionId: otherId });
  await waitFor(`${content(otherId)}.length === 1`);
  const emptyOther = `(${current}) === ${JSON.stringify(otherId)} && !${rail} && window.__DSH_COMPOSER_TEXT__.read() === ''`;
  assert.equal(await evaluate(emptyOther), true, 'Other Session must have no draft or attachments before workspace selection');
  // Hero workspace selection carries the CURRENT draft. Only use it from empty B,
  // after rechecking A has exactly one candidate; retain the exact original-ID gate.
  const beforeReturn = await verifyUniqueSession(workspacePath, selected);
  assert.equal(beforeReturn.title, original.title);
  const chips = `${content(otherId)}.flatMap(el=>Array.from(el.querySelectorAll('button[aria-haspopup="menu"]'))).filter(b=>b.getClientRects().length && ['选择工作区','Choose workspace'].includes(b.getAttribute('aria-label')))`;
  await waitFor(`${chips}.length === 1`);
  assert.equal(await evaluate(emptyOther), true, 'Other Session changed before workspace selection');
  await evaluate(`${chips}[0].click()`);
  const entries = `Array.from(document.querySelectorAll('[role="menu"] button[role="menuitem"]')).filter(b=>b.getClientRects().length && !b.disabled && b.textContent.trim()===${JSON.stringify(original.title)})`;
  await waitFor(`${entries}.length === 1`);
  assert.equal(await evaluate(emptyOther), true, 'Other Session changed while workspace picker was open');
  await evaluate(`${entries}[0].click()`);
  await waitFor(`${current} === ${JSON.stringify(selected.sessionId)}`);
  await waitFor(`${content(selected.sessionId)}.length === 1 && ${rail}?.children.length === 4`);
  assert.equal(await evaluate('window.__DSH_COMPOSER_TEXT__.read()'), originalDraft, 'Original attachment draft changed');
  return { otherSessionEmpty: true, originalSessionRestored: true, originalDraftRestored: true };
}

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
    // Fresh no-Key profiles can show onboarding after an asynchronous session switch.
    await evaluate('Array.from(document.querySelectorAll("button")).find(b=>["稍后配置","Set up later"].includes(b.textContent.trim()))?.click()');
    await waitFor('!Array.from(document.querySelectorAll("button")).some(b=>["稍后配置","Set up later"].includes(b.textContent.trim()) && b.getClientRects().length)');
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
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  await fsp.writeFile(`${target}.official-mixed.png`, (await wc.capturePage()).toPNG());

  const otherPath = path.join(smokeRoot, 'official-other-workspace'); await fsp.mkdir(otherPath, { recursive: true });
  Object.assign(checks, await switchAttachmentWorkspace({ selected, workspacePath, otherPath, origin, api, evaluate, waitFor,
    hoverAt: point => wc.sendInputEvent({ type: 'mouseMove', ...point }) }));
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

module.exports = { runOfficialAttachmentSmoke, verifyStoredOfficeCopies, switchAttachmentWorkspace };
