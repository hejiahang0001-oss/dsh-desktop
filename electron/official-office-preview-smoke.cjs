const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createOfficePreviewFixtures } = require('./office-preview-fixtures.cjs');

async function runOfficialOfficePreviewSmoke({ window, workspacePath, evaluate, waitFor, target }) {
  const { app } = require('electron');
  const skillsRoot = app.isPackaged ? path.join(process.resourcesPath, 'skills') : path.join(app.getAppPath(), 'resources/skills');
  const fixtures = await createOfficePreviewFixtures(workspacePath, skillsRoot);
  // Scope every assertion to the visible Office body; an old PDF tab cannot
  // accidentally satisfy this test while the new native conversion is pending.
  const body = `([...document.querySelectorAll('[data-office-font-notice]')].map(el=>el.parentElement)
    .find(el=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0}))`;
  const results = [];
  for (const fixture of fixtures) {
    if (!await evaluate(`window.__DSH_FILES__.reveal(${JSON.stringify(fixture.name)})`)) {
      throw new Error(`Official Office navigation rejected: ${fixture.name}`);
    }
    await waitFor(`Boolean([...document.querySelectorAll('[role="tab"][aria-selected="true"]')]
      .some(el=>el.textContent.includes(${JSON.stringify(fixture.name)})))`);
    await waitFor(`Boolean(${body}?.querySelector('[data-pdf-page="1"] canvas:not([hidden])'))`);
    await waitFor(`Boolean(${body}?.textContent.replace(/\\s/g,'').includes(${JSON.stringify(fixture.marker)}))`);
    const pages = await evaluate(`${body}.querySelectorAll('[data-pdf-page]').length`);
    if (pages !== fixture.expectedPages) throw new Error(`Office pagination mismatch: ${fixture.name}: ${pages}`);
    for (let page = 1; page <= pages; page += 1) {
      // Tall portrait pages must be aligned at the top; centering can produce
      // an all-white screenshot while clipping the page's actual text.
      await evaluate(`${body}.querySelector('[data-pdf-page="${page}"]').scrollIntoView({block:'start'})`);
      await waitFor(`Boolean(${body}?.querySelector('[data-pdf-page="${page}"] canvas:not([hidden])'))`);
      await waitFor(`Boolean(${body}?.querySelector('[data-pdf-page="${page}"]')?.textContent.replace(/\\s/g,'')
        .includes(${JSON.stringify(fixture.pageMarkers[page - 1])}))`);
      await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      await fs.writeFile(`${target}.office-${fixture.format}-${page}.png`, (await window.webContents.capturePage()).toPNG());
    }
    const after = createHash('sha256').update(await fs.readFile(path.join(workspacePath, fixture.name))).digest('hex');
    if (after !== fixture.sha256) throw new Error(`Office preview modified its source: ${fixture.name}`);
    const fontNotice = await evaluate(`${body}.querySelector('[data-office-font-notice]').textContent`);
    results.push({ ...fixture, pages, sourceUnchanged: true, fontNotice });
  }
  return { ok: true, results, modelCalls: 0, unverified: ['legacy binary Office formats', 'another Windows computer', 'large/hostile document conversion limits'] };
}

module.exports = { runOfficialOfficePreviewSmoke };
