const fsp = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { previewExpression, finishOfficialOnboarding } = require('./official-office-preview-contract.cjs');
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function runOfficialFilePreviewSmoke({ window, BrowserWindow, workspacePath, evaluate, waitFor, target, version }) {
  await finishOfficialOnboarding({ evaluate });
  const checks = {}, wc = window.webContents;
  let currentFile = '';
  try {
    const pdf = await require('./pdf-smoke-document.cjs').buildChinesePdfSmoke(BrowserWindow);
    const png = require('electron').nativeImage.createFromBitmap(Buffer.from([0, 128, 255, 255]), { width: 1, height: 1 }).toPNG();
    const fixtures = [
      ['官方预览 #说明.md', Buffer.from('# 官方 Markdown 验收\n\n**金额 123.45**\n'), '[data-document-markdown] h1'],
      ['官方预览.js', Buffer.from('const amount = 123.45;\n'), '[data-code-preview]'],
      ['官方预览.png', png, '[data-image-preview] img'],
      ['官方预览.html', Buffer.from('<!doctype html><html lang="zh"><body><h1>隔离 HTML 验收</h1></body></html>'), 'iframe[data-html-preview]'],
      ['官方预览.pdf', pdf.pdf, '[data-pdf-preview] [data-pdf-page="1"] canvas']
    ];
    for (const [name, bytes] of fixtures) await fsp.writeFile(path.join(workspacePath, name), bytes, { flag: 'wx' });
    await waitFor('Boolean(window.__DSH_OFFICIAL_FILES__ && window.__DSH_FILES__)');
    for (const [name, , selector] of fixtures) {
      currentFile = name;
      const opened = await evaluate(`window.__DSH_FILES__.reveal(${JSON.stringify(name)})`);
      if (!opened) {
        const status = await evaluate('document.querySelector(".dsh-files-status")?.textContent');
        throw new Error(`Official navigation rejected: ${name}: ${status}`);
      }
      await waitFor(`(${previewExpression(name, 1, 'inspect', selector)}).selectorVisible`);
      checks[name] = true;
      if (name.endsWith('.html')) checks.htmlSandbox = await evaluate(`(${previewExpression(name)}).htmlSandbox === 'allow-scripts'`);
    }
    checks.threePdfPages = await evaluate(`(${previewExpression('官方预览.pdf')}).pages === 3`);
    await evaluate(previewExpression('官方预览.pdf', 3, 'scroll'));
    await waitFor(`(() => { const p=${previewExpression('官方预览.pdf', 3)}; return p.ready && p.canvasVisible && p.occlusion.clear && p.bitmap.ink>0; })()`);
    checks.pdfLastPageRendered = true;
    await fsp.writeFile(`${target}.official-pdf.png`, (await wc.capturePage()).toPNG());
    checks.noDuplicatePreview = await evaluate(`!document.querySelector('#dsh-file-preview, embed[type="application/pdf"]')`);
    const office = await require('./official-office-preview-smoke.cjs').runOfficialOfficePreviewSmoke({ window, workspacePath, evaluate, waitFor, target });
    checks.officeNativePreviews = office.ok;
    await evaluate('window.__DSH_FILES__.focus()');
    await evaluate('(()=>{const el=document.querySelector(".dsh-files-search-input");el.value="官方预览 #说明";el.dispatchEvent(new Event("input",{bubbles:true}))})()');
    await waitFor('document.querySelectorAll(".dsh-files-row").length === 1');
    await evaluate('document.querySelector(".dsh-files-row").focus()');
    currentFile = '官方预览 #说明.md';
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
    await waitFor(`(${previewExpression('官方预览 #说明.md', 1, 'inspect', '[data-document-markdown] h1')}).selectorVisible`);
    checks.keyboardSearchOpensOfficialPreview = true;
    await fsp.writeFile(`${target}.official-markdown.png`, (await wc.capturePage()).toPNG());
    checks.protectedPathRejected = !await evaluate('window.__DSH_FILES__.reveal(".env")');
    checks.originalBytesUnchanged = (await Promise.all(fixtures.map(async ([name, bytes]) => digest(await fsp.readFile(path.join(workspacePath, name))) === digest(bytes)))).every(Boolean);
    if (!Object.values(checks).every(Boolean)) throw new Error(`Official preview checks failed: ${JSON.stringify(checks)}`);
    return { ok: true, version, checks, office, modelCalls: 0, evidence: 'Real official browser plugin, guarded desktop IPC, native keyboard search and rendered PDF/Office canvases; only isolated fixture files.', unverified: ['large-file limits', 'encrypted PDF', 'native drag of Sidebar split panes'] };
  } catch (error) {
    const failure = { currentFile, checks, error: error.message.slice(0, 1000) };
    try { failure.observation = await evaluate(previewExpression(currentFile)); } catch (probeError) { failure.probeError = probeError.message; }
    await fsp.writeFile(`${target}.official-preview-failure.json`, JSON.stringify(failure, null, 2));
    await fsp.writeFile(`${target}.official-preview-failure.png`, (await wc.capturePage()).toPNG());
    throw new Error(`Official file preview failed: ${currentFile}; see preview failure evidence`, { cause: error });
  }
}
module.exports = { runOfficialFilePreviewSmoke };
