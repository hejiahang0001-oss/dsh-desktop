const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const assert = require('node:assert/strict');
const { createOfficePreviewFixtures } = require('./office-preview-fixtures.cjs');
const { previewExpression, finishOfficialOnboarding } = require('./official-office-preview-contract.cjs');

function sendKey(webContents, keyCode, modifiers = []) {
  webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
  webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
}

function clickPoint(webContents, point) {
  assert.ok(point, 'Official preview action must be visible');
  webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
  webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
}

async function runOfficialOfficePreviewSmoke({ window, workspacePath, evaluate, waitFor, target }) {
  const { app } = require('electron');
  const skillsRoot = app.isPackaged ? path.join(process.resourcesPath, 'skills') : path.join(app.getAppPath(), 'resources/skills');
  const fixtures = await createOfficePreviewFixtures(workspacePath, skillsRoot);
  const onboarding = await finishOfficialOnboarding({ evaluate });
  const results = [];
  for (const fixture of fixtures) {
    if (!await evaluate(`window.__DSH_FILES__.reveal(${JSON.stringify(fixture.name)})`)) {
      throw new Error(`Official Office navigation rejected: ${fixture.name}`);
    }
    const probe = (page = 1, action = 'inspect') => previewExpression(fixture.name, page, action);
    let stage = 'active-preview', currentPage = 1;
    try {
      await waitFor(`(${probe()}).ready`);
      const screenshots = [];
      const capture = async (suffix) => {
        await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
        const screenshot = `${target}.office-${fixture.format}-${suffix}.png`;
        await fs.writeFile(screenshot, (await window.webContents.capturePage()).toPNG());
        screenshots.push(screenshot);
      };
      let observation;
      if (fixture.format === 'xlsx') {
        stage = 'spreadsheet-render';
        await waitFor(`(() => { const p=${probe()}; return p.kind==='spreadsheet' && p.canvasVisible && p.occlusion.clear && p.bitmap.ink>0
          && p.spreadsheet.sheets.includes('中文汇总'); })()`);
        observation = await evaluate(probe());
        assert.deepEqual(observation.spreadsheet.sheets, ['中文汇总']);
        assert.equal(observation.pages, 0, 'XLSX uses the official spreadsheet renderer');
        assert.equal(observation.spreadsheet.editingToolbar, false);
        assert.equal(observation.spreadsheet.formulaReadOnly, true);
        assert.ok(observation.spreadsheet.formulaWarning, 'Formula accuracy notice must remain available');
        clickPoint(window.webContents, observation.spreadsheet.overlayPoint);
        await waitFor(`(${probe()}).spreadsheet.selection==='A1' && (${probe()}).spreadsheet.formula===${JSON.stringify(fixture.marker)}`);
        const cells = [];
        const checkCell = async (address, formula, display) => {
          stage = `spreadsheet-cell-${address}`;
          await waitFor(`(${probe()}).spreadsheet.selection===${JSON.stringify(address)} && (${probe()}).spreadsheet.formula===${JSON.stringify(formula)}`);
          sendKey(window.webContents, 'c', ['control']);
          await waitFor(`JSON.stringify((${probe()}).spreadsheet.copied)===${JSON.stringify(JSON.stringify([display]))}`);
          // FortuneSheet restores focus asynchronously after its hidden copy
          // helper. Typing into that helper would not exercise read-only cells.
          await waitFor(`(${probe()}).spreadsheet.keyboardTargetReady`);
          cells.push({ address, formula, display });
        };
        await checkCell('A1', fixture.marker, fixture.marker);
        sendKey(window.webContents, 'Down'); sendKey(window.webContents, 'Down'); sendKey(window.webContents, 'Right');
        await checkCell('B3', '100', '100');
        sendKey(window.webContents, 'Down'); await checkCell('B4', '23.45', '23.45');
        sendKey(window.webContents, 'Down'); await checkCell('B5', '=SUM(B3:B4)', '123.45');
        for (const key of ['9', '9', '9']) {
          sendKey(window.webContents, key);
          window.webContents.sendInputEvent({ type: 'char', keyCode: key });
        }
        await checkCell('B5', '=SUM(B3:B4)', '123.45');
        await capture('sheet-1');
        observation = { ...(await evaluate(probe())), cells, readOnlyInputPreserved: true };
      } else {
        const pageResults = [];
        for (let page = 1; page <= fixture.expectedPages; page += 1) {
          stage = `pdf-page-${page}`; currentPage = page;
          await waitFor(`(${probe()}).kind==='pdf' && (${probe()}).pages===${fixture.expectedPages}`);
          await evaluate(probe(page, 'scroll'));
          const marker = fixture.pageMarkers[page - 1];
          const values = fixture.format === 'docx' && page === 1 ? ['123.45'] : fixture.format === 'pptx' && page === 2 ? ['100', '23.45'] : [];
          await waitFor(`(() => { const p=${probe(page)}; return p.ready && p.canvasVisible && p.occlusion.clear && p.bitmap.ink>0
            && p.text.includes(${JSON.stringify(marker)}) && ${JSON.stringify(values)}.every(value=>p.text.includes(value)); })()`);
          const result = await evaluate(probe(page));
          pageResults.push({ page, marker, values, bitmap: result.bitmap, canvasVisible: result.canvasVisible, occlusion: result.occlusion });
          await capture(page);
        }
        observation = await evaluate(probe(fixture.expectedPages));
        if (observation.fontWarning) {
          stage = 'font-details';
          clickPoint(window.webContents, observation.fontWarning.point);
          await waitFor(`(${probe()}).fontWarning?.expanded==='true'`);
          const controls = (await evaluate(probe())).fontWarning.controls;
          await waitFor(`(() => { const panel=document.getElementById(${JSON.stringify(controls)}); return Boolean(panel
            && panel.getClientRects().length && getComputedStyle(panel).visibility!=='hidden' && panel.querySelectorAll('li').length); })()`);
          const details = await evaluate(`(() => { const panel=document.getElementById(${JSON.stringify(controls)}); return {
            visible: Boolean(panel && panel.getClientRects().length && getComputedStyle(panel).visibility!=='hidden'),
            fonts: [...(panel?.querySelectorAll('li')||[])].map(el=>el.textContent) }; })()`);
          assert.equal(details.visible, true); assert.ok(details.fonts.length > 0);
          sendKey(window.webContents, 'Escape');
          await waitFor(`(${probe()}).fontWarning?.expanded==='false'`);
          assert.equal((await evaluate(probe())).fontWarning.focused, true);
          observation.fontWarning.details = details;
        }
        observation.pageResults = pageResults;
      }
      const after = createHash('sha256').update(await fs.readFile(path.join(workspacePath, fixture.name))).digest('hex');
      assert.equal(after, fixture.sha256, `Office preview modified its source: ${fixture.name}`);
      results.push({ ...fixture, observation, screenshots, sourceUnchanged: true });
    } catch (error) {
      const failure = { file: fixture.name, stage, error: error.message.slice(0, 1000), completed: results };
      try { failure.observation = await evaluate(probe(currentPage)); } catch (probeError) { failure.probeError = probeError.message; }
      await fs.writeFile(`${target}.office-failure.json`, JSON.stringify(failure, null, 2));
      await fs.writeFile(`${target}.office-failure.png`, (await window.webContents.capturePage()).toPNG());
      throw new Error(`Official preview failed: ${fixture.name}, ${stage}; see Office failure evidence`, { cause: error });
    }
  }
  return { ok: true, onboarding, results, modelCalls: 0,
    unverified: ['legacy binary Office formats', 'another Windows computer', 'large/hostile document conversion limits', 'spreadsheet formula recalculation (official preview uses saved values)'] };
}

module.exports = { runOfficialOfficePreviewSmoke };
