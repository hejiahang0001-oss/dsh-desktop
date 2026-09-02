const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('tasks and subagents window is local-only, narrow, accessible, and packaged', () => {
  const main = read('electron/main.cjs');
  const preload = read('electron/tasks-subagents-preload.cjs');
  const renderer = read('assets/tasks-subagents.js');
  const page = read('tasks-subagents.html');
  const controller = read('electron/tasks-subagents.cjs');
  const manifest = JSON.parse(read('package.json'));

  assert.match(main, /tasksSubagentsIpcAllowed/);
  assert.match(main, /isTrustedMainFrameEvent\(\s*event,\s*tasksSubagentsWindow\?\.webContents,\s*tasksSubagentsUrlAllowed\s*\)/);
  assert.match(main, /label: '任务与子代理…'/);
  assert.match(main, /accelerator: 'CmdOrCtrl\+Shift\+A'/);
  assert.match(main, /--tasks-subagents-smoke-file=/);
  assert.match(main, /buttons: \['取消', '发送中断请求'\]/);
  assert.match(main, /defaultId: 0/);
  assert.match(main, /restored\?\.subagentAddress\?\.parentSessionId/);
  assert.match(main, /runTasksSubagentsSmoke/);
  assert.match(main, /const getCurrentWorkflow = async \(\) =>/);
  assert.match(main, /const workflow = await getCurrentWorkflow\(\)/);
  for (const channel of ['get-state', 'refresh', 'open', 'prompt', 'interrupt']) {
    assert.match(preload, new RegExp(`tasks-subagents:${channel}`));
  }
  assert.doesNotMatch(preload, /readFile|writeFile|shell|ipcRenderer\.send/);
  assert.match(renderer, /textContent/);
  assert.match(renderer, /api\.prompt\(item\.id, value\)/);
  assert.match(renderer, /api\.interrupt\(item\.id\)/);
  assert.match(renderer, /api\.open\(item\.id\)/);
  assert.match(renderer, /state: await api\.refresh\(\)/);
  assert.doesNotMatch(renderer, /innerHTML|eval\(/);
  assert.match(page, /aria-live="polite"/);
  assert.match(page, /role="status"/);
  assert.match(page, /普通会话分支不会出现在这里/);
  assert.match(page, /共享目录只提示、不自动迁移/);
  assert.match(page, /中断“已受理”不等于“已经停止”/);
  assert.match(controller, /subagent\.list/);
  assert.match(controller, /subagent\.prompt/);
  assert.match(controller, /subagent\.interrupt/);
  assert.match(controller, /session\.list/);
  assert.match(controller, /MAX_TREE_ENTRIES = 32/);
  assert.match(controller, /MAX_FOLLOWUP_LENGTH = 8000/);
  assert.match(controller, /entry\.mode === 'continuable'/);
  assert.match(controller, /catalog\?\.parentAvailable === true/);
  assert.match(controller, /这不代表任务已经完成/);
  assert.match(controller, /可能短暂仍显示为运行中/);
  assert.match(controller, /DEEPSEEK_API_KEY/);
  for (const asset of ['tasks-subagents.html', 'assets/tasks-subagents.css', 'assets/tasks-subagents.js']) {
    assert.ok(manifest.build.files.includes(asset), asset);
  }
});
