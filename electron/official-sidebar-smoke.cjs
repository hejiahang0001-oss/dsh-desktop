const fsp = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function runOfficialSidebarSmoke({ window, workspacePath, evaluate, waitFor, target }) {
  const checks = {}, wc = window.webContents;
  const fixtures = [['官方侧栏 一.txt', '官方文件面板验证一\n金额 123.45\n'], ['官方侧栏 二.txt', '官方文件面板验证二\n金额 678.90\n']];
  for (const [name, content] of fixtures) await fsp.writeFile(path.join(workspacePath, name), content, { flag: 'wx' });
  await evaluate('document.querySelector("[data-sidebar-right-expand]")?.click()');
  await waitFor('Boolean(document.querySelector("[data-sidebar-right-panel][data-sidebar-right-open]"))');
  await evaluate('document.querySelector("[data-sidebar-right-guide-entry=files]")?.click()');
  await waitFor('Boolean(document.querySelector("[data-files-state=tree]"))');
  // present may already have populated the official directory cache before
  // these isolated fixtures were created. Exercise its public refresh control.
  await evaluate('document.querySelector("[data-files-reload]").click()');
  const fileRow = (name) => `Array.from(document.querySelectorAll('[data-files-entry=file]')).find(row=>row.textContent.trim()===${JSON.stringify(name)})`;
  const fileTab = `Array.from(document.querySelectorAll('[data-dockkit-tab]')).find(tab=>tab.querySelector('[data-dockkit-tab-title]')?.textContent.trim()==='文件')`;
  for (const [index, [name, content]] of fixtures.entries()) {
    if (index) { await evaluate(`${fileTab}.click()`); await waitFor('Boolean(document.querySelector("[data-files-state=tree]"))'); }
    await waitFor(`Boolean(${fileRow(name)})`);
    await evaluate(`${fileRow(name)}.querySelector('button').click()`);
    await waitFor(`document.querySelector('[data-textpreview-state=text]')?.textContent.includes(${JSON.stringify(content.split('\n')[0])})`);
  }
  checks.clickOpensText = true;
  checks.twoFileTabs = await evaluate(`Array.from(document.querySelectorAll('[data-dockkit-tab-title]')).filter(tab=>${JSON.stringify(fixtures.map(([name]) => name))}.includes(tab.textContent.trim())).length === 2`);
  checks.noDuplicateDirectoryBrowser = await evaluate('!document.querySelector("#dsh-workbench-files [aria-expanded]")');
  const sizes = window.getContentSize();
  await evaluate('document.querySelector("[data-sidebar-right-mode=fullscreen]").click()');
  await waitFor('Boolean(document.querySelector("[data-sidebar-right-panel=fullscreen]"))');
  checks.fullscreen = true;
  await fsp.writeFile(`${target}.official-sidebar-fullscreen.png`, (await wc.capturePage()).toPNG());
  await evaluate('document.querySelector("[data-sidebar-right-mode=push]").click()');
  await waitFor('Boolean(document.querySelector("[data-sidebar-right-panel=push]"))');
  window.setContentSize(1100, 760);
  // The desktop review-width transition can outlive two animation frames.
  // Verify actual hit testing after resizing, not an intermediate screenshot.
  await waitFor(`(()=>{const controls=Array.from(document.querySelectorAll('[data-sidebar-right-panel] [data-sidebar-right-mode],[data-sidebar-right-panel] [data-sidebar-right-toggle]'));return controls.length>0&&controls.every(e=>{const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))})})()`);
  checks.compactBounds = await evaluate(`(()=>{const el=document.querySelector('[data-sidebar-right-panel]');const r=el.getBoundingClientRect();return r.left>=-1&&r.right<=innerWidth+1&&r.top>=-1&&r.bottom<=innerHeight+1})()`);
  const geometry = await evaluate(`(()=>{const panel=document.querySelector('[data-sidebar-right-panel]');const describe=e=>({tag:e.tagName,id:e.id,cls:e.className,rect:e.getBoundingClientRect().toJSON(),position:getComputedStyle(e).position,width:getComputedStyle(e).width});const ancestors=[];for(let e=panel;e;e=e.parentElement)ancestors.push(describe(e));return{ancestors,controls:Array.from(panel.querySelectorAll('[data-sidebar-right-mode],[data-sidebar-right-toggle]')).map(e=>{const r=e.getBoundingClientRect();return{...describe(e),visible:e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}})}})()`);
  await fsp.writeFile(`${target}.sidebar-geometry.json`, JSON.stringify(geometry, null, 2));
  checks.compactControlsVisible = geometry.controls.length > 0 && geometry.controls.every(control => control.visible);
  await fsp.writeFile(`${target}.official-sidebar-compact.png`, (await wc.capturePage()).toPNG());
  window.setContentSize(...sizes);
  await evaluate('document.querySelector("[data-sidebar-right-toggle]").click()');
  await waitFor('!document.querySelector("[data-sidebar-right-panel][data-sidebar-right-open]")');
  checks.closeReturnsToComposer = await evaluate('Boolean(document.querySelector("[data-composer-card]"))');
  checks.originalFilesUnchanged = (await Promise.all(fixtures.map(async ([name, content]) => sha(await fsp.readFile(path.join(workspacePath, name))) === sha(Buffer.from(content))))).every(Boolean);
  if (!Object.values(checks).every(Boolean)) throw new Error(`Official Sidebar checks failed: ${JSON.stringify(checks)}`);
  return { ok: true, checks, modelCalls: 0, unverified: ['native keyboard activation', 'split-pane dragging', 'large-file deep paging'] };
}
module.exports = { runOfficialSidebarSmoke };
