const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const read = (p) => fs.readFileSync(p, 'utf8');
test('background task UI is native-only, bounded, text-rendered, accessible and packaged', () => {
  const main = read('electron/main.cjs'), preload = read('electron/tasks-subagents-preload.cjs'), ui = read('assets/background-tasks.js'), html = read('tasks-subagents.html');
  assert.match(main, /tasksSubagentsIpcAllowed\(event\)/); assert.match(preload, /background-action/);
  assert.doesNotMatch(preload, /readFile|writeFile|shell|executeJavaScript/);
  assert.match(ui, /textContent/); assert.doesNotMatch(ui, /innerHTML|eval\(/);
  assert.match(html, /aria-controls="background-task-panel"/); assert.match(html, /maxlength="8000"/);
  assert.match(html, /完全退出后不执行/); assert.match(main, /backgroundScheduleDescription\(input.schedule\)/);
  assert.match(main, /await backgroundTasks\?\.stop\(\)/); assert.match(main, /继续后台运行/);
  assert.match(main, /后台记录不能安全加载，已禁用调度/);
  assert.ok(JSON.parse(read('package.json')).build.files.includes('assets/background-tasks.js'));
});
