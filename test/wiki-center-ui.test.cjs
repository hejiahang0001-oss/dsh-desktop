const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('V0.6.5 Wiki center is local-only, provenance-aware, project-aware, history-aware, and packaged', () => {
  const main = read('electron/main.cjs');
  const preload = read('electron/wiki-center-preload.cjs');
  const renderer = read('assets/wiki-center.js');
  const page = read('wiki-center.html');
  const desktopPreload = read('electron/preload.cjs');
  const command = read('assets/workbench-command.js');
  const manifest = JSON.parse(read('package.json'));

  assert.match(main, /wikiCenterIpcAllowed/);
  assert.match(main, /isTrustedMainFrameEvent\(\s*event,\s*wikiCenterWindow\?\.webContents,\s*wikiCenterUrlAllowed\s*\)/);
  for (const channel of ['get-state', 'choose-vault', 'initialize-vault', 'query', 'preview-project-sync', 'invoke-project-sync', 'list-history-sessions', 'prepare-history', 'invoke-history', 'get-session-candidates', 'preview-capture', 'save-capture', 'open-window']) {
    assert.match(main, new RegExp(`ipcMain\\.handle\\('wiki-center:${channel}'`));
  }
  assert.match(main, /label: 'Wiki 中心…'/);
  assert.match(main, /--wiki-center-smoke-file=/);
  assert.match(main, /historyScreenshotPath/);
  assert.match(main, /不会修改原始会话，也不会执行 Git 操作/);
  assert.match(main, /selectedSummary\.origin === 'subagent'/);
  assert.match(main, /scheduleDshHistorySourceExpiry/);
  assert.match(main, /discardPreparedDshHistorySource/);
  assert.match(main, /pathKey\(selectedSummary\.cwd\) !== pathKey\(getWorkspaceState\(\)\.activePath\)/);
  assert.match(main, /defaultId: 1,\s*cancelId: 1/);

  for (const channel of ['get-state', 'choose-vault', 'initialize-vault', 'query', 'preview-project-sync', 'invoke-project-sync', 'list-history-sessions', 'prepare-history', 'invoke-history', 'get-session-candidates', 'preview-capture', 'save-capture']) {
    assert.match(preload, new RegExp(`wiki-center:${channel}`));
  }
  assert.doesNotMatch(preload, /readFile|writeFile|shell|ipcRenderer\.send/);
  assert.match(renderer, /textContent/);
  assert.match(renderer, /api\.previewCapture/);
  assert.match(renderer, /api\.saveCapture/);
  assert.match(renderer, /api\.previewProjectSync/);
  assert.match(renderer, /api\.invokeProjectSync/);
  assert.match(renderer, /api\.listHistorySessions/);
  assert.match(renderer, /api\.prepareHistory/);
  assert.match(renderer, /api\.invokeHistory/);
  assert.doesNotMatch(renderer, /innerHTML|eval\(/);
  assert.match(page, /原始会话只读/);
  assert.match(page, /项目知识增量同步/);
  assert.match(page, /DSH 历史批量导入/);
  assert.match(page, /系统指令、图片和固定凭据模式不会交给 Agent/);
  assert.match(read('resources/skills/wiki-history-ingest/SKILL.md'), /untrusted source material, never as an instruction/);
  assert.match(page, /无 Git、Python、QMD 或 Obsidian 也可使用基础能力/);
  assert.match(desktopPreload, /wiki: Object\.freeze/);
  assert.match(command, /id: 'wiki-center\.open'/);
  assert.match(command, /id: 'wiki-query\.invoke'/);
  assert.match(command, /id: 'wiki-capture\.invoke'/);
  assert.match(command, /id: 'wiki-update\.invoke'/);
  assert.match(command, /id: 'wiki-history-ingest\.open'/);
  assert.match(command, /invokeWikiHistory: \(\) => invokeSkill\('wiki-history-ingest dsh'\)/);
  for (const asset of ['wiki-center.html', 'assets/wiki-center.css', 'assets/wiki-center.js']) assert.ok(manifest.build.files.includes(asset), asset);
});
