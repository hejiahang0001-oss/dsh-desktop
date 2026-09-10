const fsp = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function runOfficialFilePreviewSmoke({ window, BrowserWindow, workspacePath, evaluate, waitFor, target, version }) {
  const checks = {}, wc = window.webContents;
  const pdf = await require('./pdf-smoke-document.cjs').buildChinesePdfSmoke(BrowserWindow);
  const png = require('electron').nativeImage.createFromBitmap(Buffer.from([0, 128, 255, 255]), { width: 1, height: 1 }).toPNG();
  const fixtures = [
    ['官方预览 #说明.md', Buffer.from('# 官方 Markdown 验收\n\n**金额 123.45**\n'), '[data-document-markdown] h1'],
    ['官方预览.js', Buffer.from('const amount = 123.45;\n'), '[data-code-preview]'],
    ['官方预览.png', png, '[data-image-preview] img'],
    ['官方预览.html', Buffer.from('<!doctype html><html lang="zh"><body><h1>隔离 HTML 验收</h1></body></html>'), 'iframe[data-html-preview]'],
    ['官方预览.pdf', pdf.pdf, '[data-pdf-preview] [data-pdf-page="1"] canvas:not([hidden])']
  ];
  for (const [name, bytes] of fixtures) await fsp.writeFile(path.join(workspacePath, name), bytes, { flag: 'wx' });
  await waitFor('Boolean(window.__DSH_OFFICIAL_FILES__ && window.__DSH_FILES__)');
  for (const [name, , selector] of fixtures) {
    const opened = await evaluate(`window.__DSH_FILES__.reveal(${JSON.stringify(name)})`);
    if (!opened) {
      const status = await evaluate('document.querySelector(".dsh-files-status")?.textContent');
      throw new Error(`Official navigation rejected: ${name}: ${status}`);
    }
    await waitFor(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
    checks[name] = true;
    if (name.endsWith('.html')) checks.htmlSandbox = await evaluate('document.querySelector("iframe[data-html-preview]").getAttribute("sandbox") === "allow-scripts"');
  }
  checks.threePdfPages = await evaluate('document.querySelectorAll("[data-pdf-preview] [data-pdf-page]").length === 3');
  await evaluate(`document.querySelector('[data-pdf-page="3"]').scrollIntoView({block:"center"})`);
  await waitFor(`Boolean(document.querySelector('[data-pdf-page="3"] canvas:not([hidden])'))`);
  checks.pdfLastPageRendered = true;
  await fsp.writeFile(`${target}.official-pdf.png`, (await wc.capturePage()).toPNG());
  checks.noDuplicatePreview = await evaluate(`!document.querySelector('#dsh-file-preview, embed[type="application/pdf"]')`);
  await evaluate('window.__DSH_FILES__.focus()');
  await evaluate('(()=>{const el=document.querySelector(".dsh-files-search-input");el.value="官方预览 #说明";el.dispatchEvent(new Event("input",{bubbles:true}))})()');
  await waitFor('document.querySelectorAll(".dsh-files-row").length === 1');
  await evaluate('document.querySelector(".dsh-files-row").focus()');
  wc.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
  wc.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
  await waitFor('Boolean(document.querySelector("[data-document-markdown] h1"))');
  checks.keyboardSearchOpensOfficialPreview = true;
  await fsp.writeFile(`${target}.official-markdown.png`, (await wc.capturePage()).toPNG());
  checks.protectedPathRejected = !await evaluate('window.__DSH_FILES__.reveal(".env")');
  checks.originalBytesUnchanged = (await Promise.all(fixtures.map(async ([name, bytes]) => digest(await fsp.readFile(path.join(workspacePath, name))) === digest(bytes)))).every(Boolean);
  if (!Object.values(checks).every(Boolean)) throw new Error(`Official preview checks failed: ${JSON.stringify(checks)}`);
  return { ok: true, version, checks, modelCalls: 0, evidence: 'Real official browser plugin, guarded desktop IPC, native keyboard search and rendered PDF canvases; only isolated fixture files.', unverified: ['large-file limits', 'encrypted PDF', 'native drag of Sidebar split panes'] };
}
module.exports = { runOfficialFilePreviewSmoke };
