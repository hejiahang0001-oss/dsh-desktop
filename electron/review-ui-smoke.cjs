const fsp = require('node:fs/promises');
const path = require('node:path');
const { runGitCommand } = require('./worktree-manager.cjs');

async function prepareReviewFixture(workspace) {
  const git = (...args) => runGitCommand('git', workspace, args);
  await git('init', '-q', '-b', 'main');
  await git('config', 'user.name', 'DSH UI Test'); await git('config', 'user.email', 'ui@example.invalid');
  await fsp.writeFile(path.join(workspace, 'example.js'), 'const value = 1;\n');
  await git('add', 'example.js'); await git('commit', '-qm', 'baseline');
  await git('switch', '-qc', 'feature');
  await fsp.writeFile(path.join(workspace, 'example.js'), 'const value = 2;\n'); await git('commit', '-qam', 'feature');
  await fsp.writeFile(path.join(workspace, 'example.js'), 'const value = 3;\n'); await git('add', 'example.js');
  await fsp.writeFile(path.join(workspace, 'example.js'), 'const value = 4;\n');
}

async function runReviewUiSmoke({ window, rootDir, evaluate, waitFor, target, version }) {
  const wc = window.webContents;
  await wc.insertCSS(await fsp.readFile(path.join(rootDir, 'assets/workbench-panel.css'), 'utf8'));
  await evaluate('window.__DSH_WORKBENCH_BOOTSTRAP__={reviewPanelOpen:true,reviewPanelWidth:440}');
  await evaluate(await fsp.readFile(path.join(rootDir, 'assets/workbench-panel.js'), 'utf8'));
  await waitFor('document.querySelector(".dsh-review-file[data-path=\\"example.js\\"]")');
  await evaluate('document.querySelector(".dsh-review-file[data-path=\\"example.js\\"]").click()');
  await waitFor('document.querySelector(".dsh-review-diff-lines").textContent.includes("const value = 4;")');
  await evaluate('document.querySelector(".dsh-review-diff-line[data-kind=add] button").click(); document.getElementById("dsh-review-comment-text").value="请增加空值处理"; Array.from(document.querySelectorAll("button")).find(b=>b.textContent==="保存批注").click()');
  await waitFor('document.querySelector(".dsh-review-comments summary").textContent.includes("（1）")');
  await evaluate('Array.from(document.querySelectorAll(".dsh-review-comment button")).find(b=>b.textContent==="编辑").click()');
  await waitFor('!document.getElementById("dsh-review-comment-text").parentElement.hidden');
  await evaluate('document.getElementById("dsh-review-comment-text").value="请增加空值处理和边界测试"; Array.from(document.querySelectorAll("button")).find(b=>b.textContent==="保存批注").click()');
  await waitFor('document.querySelector(".dsh-review-comment p").textContent.includes("边界测试")');
  await evaluate('(async()=>{await __DSH_COMPOSER_TEXT__.append(__DSH_COMPOSER_TEXT__.current(),"保留已有草稿。"); Array.from(document.querySelectorAll("button")).find(b=>b.textContent==="将批注放入输入框").click()})()');
  await waitFor('__DSH_COMPOSER_TEXT__.read().includes("边界测试")');
  const prompt = await evaluate('__DSH_COMPOSER_TEXT__.read()');
  await fsp.writeFile(`${target}.comments.png`, (await wc.capturePage()).toPNG());
  const setScope = async (scope) => {
    await evaluate(`var selector=document.querySelector('[aria-label="审查范围"]'); selector.value=${JSON.stringify(scope)}; selector.dispatchEvent(new Event('change'))`);
  };
  await setScope('staged');
  await waitFor('document.querySelector(".dsh-review-summary").textContent.startsWith("已暂存") && document.querySelector(".dsh-review-diff-lines").textContent.includes("const value = 3;")');
  const staged = await evaluate('document.querySelector(".dsh-review-diff-lines").textContent');
  const stagedReadOnly = await evaluate('document.querySelector(".dsh-review-actions").hidden');
  await setScope('branch');
  await waitFor('document.querySelector(".dsh-review-summary").textContent.startsWith("当前分支") && document.querySelector(".dsh-review-diff-lines").textContent.includes("const value = 2;")');
  const branch = await evaluate('document.querySelector(".dsh-review-diff-lines").textContent');
  await setScope('last-turn');
  await waitFor('document.querySelector(".dsh-review-summary").textContent.includes("没有可核实")');
  const missingBaseline = true;
  await setScope('unstaged');
  await waitFor('document.querySelector(".dsh-review-summary").textContent.startsWith("未暂存")');
  await evaluate('Array.from(document.querySelectorAll(".dsh-review-comment button")).find(b=>b.textContent==="删除").click()');
  await waitFor('document.querySelector(".dsh-review-comments summary").textContent.includes("（0）")');
  window.setSize(1000, 720);
  await new Promise((resolve) => setTimeout(resolve, 250));
  await fsp.writeFile(`${target}.compact.png`, (await wc.capturePage()).toPNG());
  const fits = await evaluate('(()=>{const p=document.getElementById("dsh-workbench-review").getBoundingClientRect(); const f=document.querySelector(".dsh-review-footer").getBoundingClientRect(); return p.right<=innerWidth+1 && f.bottom<=innerHeight+1;})()');
  return { ok: prompt.includes('保留已有草稿') && prompt.includes('example.js":1') && prompt.includes('边界测试')
    && !staged.includes('const value = 4;') && !branch.includes('const value = 3;') && stagedReadOnly && fits,
    version, evidence: 'real Harness renderer, real Git and guarded native IPC; no model request',
    scopes: 4, commentAddedEditedDeleted: true, promptPreserved: prompt.includes('保留已有草稿'),
    stagedReadOnly, missingBaseline, compactFits: fits };
}
module.exports = { prepareReviewFixture, runReviewUiSmoke };
